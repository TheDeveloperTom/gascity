package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gastownhall/gascity/internal/beadmeta"
	"github.com/gastownhall/gascity/internal/beads"
	"github.com/gastownhall/gascity/internal/config"
	"github.com/gastownhall/gascity/internal/formula"
	"github.com/gastownhall/gascity/internal/githubmonitor"
	"github.com/gastownhall/gascity/internal/molecule"
	"github.com/spf13/cobra"
)

type githubPRLister interface {
	ListOpenPullRequests(context.Context, string, string) ([]githubmonitor.PullRequest, error)
}

var (
	newGitHubPRBackfillClient = func(token string) githubPRLister {
		return githubmonitor.NewGraphQLClient(token)
	}
	resolveGitHubTokenForBackfill = resolveGitHubToken
	openGitHubPRRepairStore       = func(cityPath, scopeRoot string) (beads.Store, error) {
		return openStoreAtForCity(scopeRoot, cityPath)
	}
	// attachGitHubPRRepairWorkflow instantiates the configured repair workflow
	// on a freshly created repair bead. It is a package var so tests can stub
	// the molecule instantiation without on-disk formulas.
	attachGitHubPRRepairWorkflow = defaultAttachGitHubPRRepairWorkflow
	// nudgeGitHubPRRepairWorker notifies an already-assigned repair worker that
	// the PR's failures changed, instead of duplicating work. Package var for
	// the same testability reason.
	nudgeGitHubPRRepairWorker = defaultNudgeGitHubPRRepairWorker
)

type githubPRBackfillOptions struct {
	monitorName    string
	jsonOutput     bool
	includeClean   bool
	timeout        time.Duration
	actionableOnly bool
	createRepairs  bool
	// authors is an additional fail-closed author allow-list supplied for this
	// invocation. It unions with each monitor's configured authors; when the
	// combined set is non-empty, only PRs whose author login matches exactly
	// (case-sensitively) are acted on.
	authors []string
	// failureKinds is an additional repair-kind allow-list supplied for this
	// invocation. It unions with each monitor's configured repair_kinds; when
	// the combined set is non-empty, only actionable PRs whose failure kind is
	// listed mint or refresh a repair bead. Empty keeps the historical
	// behavior (every actionable PR mints a bead).
	failureKinds []string
	// headRefPrefixes is an additional head-branch prefix allow-list supplied
	// for this invocation. It unions with each monitor's configured
	// head_ref_prefixes; when the combined list is non-empty, only actionable
	// PRs whose head ref starts with a listed prefix mint or refresh a repair
	// bead. Empty keeps the historical behavior.
	headRefPrefixes []string
	// repairVars holds NAME=TEMPLATE entries supplied for this invocation. They
	// add to (and override) each monitor's configured repair_vars for the
	// workflow attached to a newly created repair bead.
	repairVars []string
}

type githubPRBackfillResult struct {
	SchemaVersion     string                 `json:"schema_version"`
	CityPath          string                 `json:"city_path"`
	MonitorCount      int                    `json:"monitor_count"`
	ResultCount       int                    `json:"result_count"`
	ActionableCount   int                    `json:"actionable_count"`
	Results           []githubmonitor.Result `json:"results"`
	RepairBeads       []githubPRRepairBead   `json:"repair_beads,omitempty"`
	ExistingRepairs   int                    `json:"existing_repairs,omitempty"`
	CreatedRepairs    int                    `json:"created_repairs,omitempty"`
	UpdatedRepairs    int                    `json:"updated_repairs,omitempty"`
	DispatchedRepairs int                    `json:"dispatched_repairs,omitempty"`
	// SkippedRepairs counts actionable PRs that minted no repair bead because
	// their failure kind is outside the repair-kind allow-list or their head
	// ref matches no head-ref prefix.
	SkippedRepairs int `json:"skipped_repairs,omitempty"`
}

type githubPRRepairBead struct {
	ID         string `json:"id"`
	PR         int    `json:"pr"`
	URL        string `json:"url,omitempty"`
	Created    bool   `json:"created"`
	Updated    bool   `json:"updated,omitempty"`
	Dispatched bool   `json:"dispatched,omitempty"`
	Route      string `json:"route,omitempty"`
	Workflow   string `json:"workflow,omitempty"`
}

// githubPRRepairOutcome reports what ensureGitHubPRRepairBead did for one PR.
type githubPRRepairOutcome struct {
	bead       beads.Bead
	created    bool
	updated    bool
	dispatched bool
	// dispatchErr records a non-fatal workflow-attach failure. The repair bead
	// still exists and stays routed; the controller can scale a worker without
	// the molecule, so callers surface this as a warning rather than aborting.
	dispatchErr error
}

func newGitHubCmd(stdout, stderr io.Writer) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "github",
		Short: "GitHub integration commands",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return cmd.Help()
		},
	}
	cmd.AddCommand(newGitHubPRCmd(stdout, stderr))
	return cmd
}

func newGitHubPRCmd(stdout, stderr io.Writer) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "pr",
		Short: "GitHub pull-request monitor commands",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return cmd.Help()
		},
	}
	cmd.AddCommand(newGitHubPRBackfillCmd(stdout, stderr))
	return cmd
}

func newGitHubPRBackfillCmd(stdout, stderr io.Writer) *cobra.Command {
	opts := githubPRBackfillOptions{
		timeout:        45 * time.Second,
		actionableOnly: true,
	}
	cmd := &cobra.Command{
		Use:   "backfill [monitor-name]",
		Short: "Query configured GitHub PR readiness monitors",
		Long: `Query configured GitHub PR readiness monitors.

The command reads [[github.pr_monitor]] entries from the resolved city
configuration, queries open pull requests from GitHub, and reports PRs that
need repair: failed checks, merge conflicts, blocked mergeability, or branches
behind their base. By default clean and pending-only PRs are omitted; pass
--all to include every observed PR.

With --create-repair-beads, every actionable PR mints a deduped repair bead
unless a repair-kind allow-list is set: --failure-kind (repeatable) unioned
with the monitor's repair_kinds. Then only PRs whose failure kind is listed
mint or refresh a bead; the rest are still reported and counted as
skipped_repairs. For example, --failure-kind merge_conflict --failure-kind
checks_failed keeps repair agents off PRs that are only behind their base or
blocked while checks run. A PR has exactly one failure kind, picked in this
order: checks_failed (any failed check), merge_conflict, behind_base,
checks_failed (UNSTABLE), blocked; so a conflicted PR with a failed check is
checks_failed, and both kinds must be listed to repair conflicts reliably.

A head-ref allow-list works the same way: --head-ref-prefix (repeatable)
unioned with the monitor's head_ref_prefixes. Then only PRs whose head branch
starts with a listed prefix mint or refresh a bead; the rest count as
skipped_repairs. Use it when one GitHub login opens both automated and
hand-made PRs, e.g. --head-ref-prefix devwork/task/alice/.

--repair-var NAME=TEMPLATE (repeatable) adds a formula var to the repair
workflow attached to a new repair bead, on top of the monitor's repair_vars.
TEMPLATE may use {{bead_id}}, {{bead}}, {{title}}, {{pr}}, {{repo}},
{{owner}}, {{branch}}, {{base}}, {{head_sha}}, {{failure_kind}},
{{repair_route}}, {{rig}} and {{monitor}}, e.g. --repair-var base={{base}}
--repair-var implementation_target={{repair_route}}.`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			if len(args) == 1 {
				opts.monitorName = args[0]
			}
			if opts.includeClean {
				opts.actionableOnly = false
			}
			if doGitHubPRBackfill(opts, stdout, stderr) != 0 {
				return errExit
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&opts.jsonOutput, "json", false, "emit JSON")
	cmd.Flags().BoolVar(&opts.includeClean, "all", false, "include clean and pending-only PRs")
	cmd.Flags().BoolVar(&opts.createRepairs, "create-repair-beads", false, "create deduped repair beads for actionable PRs")
	cmd.Flags().StringArrayVar(&opts.authors, "author", nil, "restrict to PRs by this GitHub author login (repeatable); fail-closed and unions with each monitor's configured authors")
	cmd.Flags().StringArrayVar(&opts.failureKinds, "failure-kind", nil, "with --create-repair-beads, mint repair beads only for this failure kind (checks_failed, merge_conflict, behind_base, blocked; repeatable); unions with each monitor's configured repair_kinds")
	cmd.Flags().StringArrayVar(&opts.headRefPrefixes, "head-ref-prefix", nil, "with --create-repair-beads, mint repair beads only for PRs whose head branch starts with this prefix (repeatable); unions with each monitor's configured head_ref_prefixes")
	cmd.Flags().StringArrayVar(&opts.repairVars, "repair-var", nil, "with --create-repair-beads, pass NAME=TEMPLATE as a formula var to the attached repair workflow (repeatable; TEMPLATE may use {{base}}, {{repair_route}}, {{pr}} …); adds to and overrides each monitor's configured repair_vars")
	cmd.Flags().DurationVar(&opts.timeout, "timeout", opts.timeout, "GitHub query timeout")
	return cmd
}

func doGitHubPRBackfill(opts githubPRBackfillOptions, stdout, stderr io.Writer) int {
	cityPath, err := resolveCity()
	if err != nil {
		fmt.Fprintf(stderr, "gc github pr backfill: %v\n", err) //nolint:errcheck // best-effort stderr
		return 1
	}
	cfg, prov, err := loadConfigCommandCityConfig(cityPath)
	if err != nil {
		fmt.Fprintf(stderr, "gc github pr backfill: %v\n", err) //nolint:errcheck // best-effort stderr
		return 1
	}
	if !opts.jsonOutput {
		for _, warning := range prov.Warnings {
			fmt.Fprintf(stderr, "gc github pr backfill: warning: %s\n", warning) //nolint:errcheck // best-effort stderr
		}
	}

	monitors, err := selectGitHubPRMonitors(cfg, opts.monitorName)
	if err != nil {
		fmt.Fprintf(stderr, "gc github pr backfill: %v\n", err) //nolint:errcheck // best-effort stderr
		return 1
	}
	for _, login := range opts.authors {
		if strings.TrimSpace(login) == "" {
			fmt.Fprintln(stderr, "gc github pr backfill: --author must not be empty") //nolint:errcheck // best-effort stderr
			return 1
		}
	}
	if len(opts.failureKinds) > 0 && !opts.createRepairs {
		fmt.Fprintln(stderr, "gc github pr backfill: --failure-kind requires --create-repair-beads") //nolint:errcheck // best-effort stderr
		return 1
	}
	for _, kind := range opts.failureKinds {
		kind = strings.TrimSpace(kind)
		if kind == "" {
			fmt.Fprintln(stderr, "gc github pr backfill: --failure-kind must not be empty") //nolint:errcheck // best-effort stderr
			return 1
		}
		if !config.IsGitHubPRFailureKind(kind) {
			fmt.Fprintf(stderr, "gc github pr backfill: unknown --failure-kind %q (valid: %s)\n", kind, strings.Join(config.GitHubPRFailureKinds(), ", ")) //nolint:errcheck // best-effort stderr
			return 1
		}
	}
	if len(opts.headRefPrefixes) > 0 && !opts.createRepairs {
		fmt.Fprintln(stderr, "gc github pr backfill: --head-ref-prefix requires --create-repair-beads") //nolint:errcheck // best-effort stderr
		return 1
	}
	for _, prefix := range opts.headRefPrefixes {
		if strings.TrimSpace(prefix) == "" {
			fmt.Fprintln(stderr, "gc github pr backfill: --head-ref-prefix must not be empty") //nolint:errcheck // best-effort stderr
			return 1
		}
	}
	if len(opts.repairVars) > 0 && !opts.createRepairs {
		fmt.Fprintln(stderr, "gc github pr backfill: --repair-var requires --create-repair-beads") //nolint:errcheck // best-effort stderr
		return 1
	}
	flagRepairVars, err := parseGitHubPRRepairVarFlags(opts.repairVars)
	if err != nil {
		fmt.Fprintf(stderr, "gc github pr backfill: %v\n", err) //nolint:errcheck // best-effort stderr
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()

	token, err := resolveGitHubTokenForBackfill(ctx)
	if err != nil {
		fmt.Fprintf(stderr, "gc github pr backfill: %v\n", err) //nolint:errcheck // best-effort stderr
		return 1
	}
	client := newGitHubPRBackfillClient(token)

	result := githubPRBackfillResult{
		SchemaVersion: "1",
		CityPath:      cityPath,
		MonitorCount:  len(monitors),
	}
	for _, monitor := range monitors {
		prs, err := client.ListOpenPullRequests(ctx, strings.TrimSpace(monitor.Owner), strings.TrimSpace(monitor.Repo))
		if err != nil {
			fmt.Fprintf(stderr, "gc github pr backfill: monitor %q: %v\n", monitor.Name, err) //nolint:errcheck // best-effort stderr
			return 1
		}
		evaluated := githubmonitor.EvaluatePullRequestsWithAllowedAuthors(monitor, prs, opts.authors)
		repairKinds := githubPRRepairKindSet(monitor, opts.failureKinds)
		headRefPrefixes := githubPRHeadRefPrefixes(monitor, opts.headRefPrefixes)
		monitor.RepairVars = mergeGitHubPRRepairVars(monitor.RepairVars, flagRepairVars)
		for _, prResult := range evaluated {
			if prResult.Actionable {
				result.ActionableCount++
				if opts.createRepairs && (!githubPRRepairKindAllowed(repairKinds, prResult.FailureKind) ||
					!githubPRHeadRefAllowed(headRefPrefixes, prResult.HeadRefName)) {
					result.SkippedRepairs++
				} else if opts.createRepairs {
					outcome, err := ensureGitHubPRRepairBead(cityPath, cfg, monitor, prResult)
					if err != nil {
						fmt.Fprintf(stderr, "gc github pr backfill: repair bead for %s/%s#%d: %v\n", prResult.Owner, prResult.Repo, prResult.Number, err) //nolint:errcheck // best-effort stderr
						return 1
					}
					if outcome.dispatchErr != nil {
						fmt.Fprintf(stderr, "gc github pr backfill: warning: repair workflow for %s/%s#%d not attached: %v\n", prResult.Owner, prResult.Repo, prResult.Number, outcome.dispatchErr) //nolint:errcheck // best-effort stderr
					}
					result.RepairBeads = append(result.RepairBeads, githubPRRepairBead{
						ID:         outcome.bead.ID,
						PR:         prResult.Number,
						URL:        prResult.URL,
						Created:    outcome.created,
						Updated:    outcome.updated,
						Dispatched: outcome.dispatched,
						Route:      prResult.RepairRoute,
						Workflow:   monitor.RepairWorkflowOrDefault(),
					})
					switch {
					case outcome.created:
						result.CreatedRepairs++
					case outcome.updated:
						result.ExistingRepairs++
						result.UpdatedRepairs++
					}
					if outcome.dispatched {
						result.DispatchedRepairs++
					}
				}
			}
			if opts.actionableOnly && !prResult.Actionable {
				continue
			}
			result.Results = append(result.Results, prResult)
		}
	}
	result.ResultCount = len(result.Results)
	sortGitHubPRBackfillResults(result.Results)

	if opts.jsonOutput {
		if writeCLIJSONLineOrExit(stdout, stderr, "gc github pr backfill", result) != 0 {
			return 1
		}
		return 0
	}
	writeGitHubPRBackfillText(stdout, result)
	return 0
}

// githubPRRepairKindSet unions a monitor's configured repair_kinds with the
// --failure-kind flag values. It returns nil when both are empty, which means
// "no repair-kind restriction" (the historical behavior).
func githubPRRepairKindSet(monitor config.GitHubPRMonitor, extra []string) map[string]bool {
	set := monitor.RepairKindSet()
	for _, kind := range extra {
		kind = strings.TrimSpace(kind)
		if kind == "" {
			continue
		}
		if set == nil {
			set = make(map[string]bool, len(extra))
		}
		set[kind] = true
	}
	return set
}

// githubPRRepairKindAllowed reports whether an actionable PR with failureKind
// may mint or refresh a repair bead. An empty allow-list allows every kind.
func githubPRRepairKindAllowed(allowed map[string]bool, failureKind string) bool {
	if len(allowed) == 0 {
		return true
	}
	return allowed[failureKind]
}

// githubPRHeadRefPrefixes unions a monitor's configured head_ref_prefixes with
// the --head-ref-prefix flag values. It returns nil when both are empty, which
// means "no head-ref restriction" (the historical behavior).
func githubPRHeadRefPrefixes(monitor config.GitHubPRMonitor, extra []string) []string {
	prefixes := monitor.HeadRefPrefixList()
	for _, prefix := range extra {
		prefix = strings.TrimSpace(prefix)
		if prefix != "" && !slices.Contains(prefixes, prefix) {
			prefixes = append(prefixes, prefix)
		}
	}
	return prefixes
}

// githubPRHeadRefAllowed reports whether an actionable PR whose head branch is
// headRef may mint or refresh a repair bead. An empty allow-list allows every
// head ref; otherwise the match is a case-sensitive prefix, and an empty head
// ref matches nothing (fail-closed).
func githubPRHeadRefAllowed(prefixes []string, headRef string) bool {
	if len(prefixes) == 0 {
		return true
	}
	if headRef == "" {
		return false
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(headRef, prefix) {
			return true
		}
	}
	return false
}

// parseGitHubPRRepairVarFlags parses --repair-var NAME=TEMPLATE values with
// the same rules as a monitor's repair_vars. A later flag for the same name
// wins.
func parseGitHubPRRepairVarFlags(values []string) (map[string]string, error) {
	if len(values) == 0 {
		return nil, nil
	}
	vars := make(map[string]string, len(values))
	for _, value := range values {
		name, template, ok := strings.Cut(value, "=")
		if !ok {
			return nil, fmt.Errorf("--repair-var %q: want NAME=TEMPLATE", value)
		}
		name = strings.TrimSpace(name)
		if err := config.ValidateGitHubPRRepairVar(name, template); err != nil {
			return nil, fmt.Errorf("--repair-var %q: %w", value, err)
		}
		vars[name] = template
	}
	return vars, nil
}

// mergeGitHubPRRepairVars returns the monitor's repair_vars with the flag
// entries laid over them. It returns the configured map untouched when there
// are no flag entries, so the default path carries no new map.
func mergeGitHubPRRepairVars(configured, flags map[string]string) map[string]string {
	if len(flags) == 0 {
		return configured
	}
	merged := make(map[string]string, len(configured)+len(flags))
	for k, v := range configured {
		merged[k] = v
	}
	for k, v := range flags {
		merged[k] = v
	}
	return merged
}

func ensureGitHubPRRepairBead(cityPath string, cfg *config.City, monitor config.GitHubPRMonitor, result githubmonitor.Result) (githubPRRepairOutcome, error) {
	if !result.Actionable {
		return githubPRRepairOutcome{}, errors.New("result is not actionable")
	}
	rig, ok := rigByName(cfg, strings.TrimSpace(monitor.Rig))
	if !ok {
		return githubPRRepairOutcome{}, fmt.Errorf("rig %q not found", monitor.Rig)
	}
	scopeRoot := resolveStoreScopeRoot(cityPath, rig.Path)
	store, err := openGitHubPRRepairStore(cityPath, scopeRoot)
	if err != nil {
		return githubPRRepairOutcome{}, err
	}

	// Dedupe by owner/repo/pr/head_sha only. The failure kind (blocked,
	// checks_failed, ...) transitions as GitHub re-evaluates the same commit,
	// so including it in the key would spawn a fresh bead per transition
	// (ga-kfufjq6). A changed head SHA is genuinely new work and keys a new bead.
	filters := githubPRRepairDedupeMetadata(result)
	existing, err := store.ListByMetadata(filters, 0)
	if err != nil {
		return githubPRRepairOutcome{}, fmt.Errorf("checking existing repair beads: %w", err)
	}
	if open := firstOpenRepairBead(existing); open != nil {
		updated, err := refreshGitHubPRRepairBead(store, *open, result)
		if err != nil {
			return githubPRRepairOutcome{}, err
		}
		// A worker already on this PR/head is nudged with the refreshed
		// failures rather than handed a duplicate bead.
		if assignee := strings.TrimSpace(updated.Assignee); assignee != "" {
			nudgeGitHubPRRepairWorker(cityPath, assignee, updated, result)
		}
		return githubPRRepairOutcome{bead: updated, updated: true}, nil
	}

	priority := 1
	created, err := store.Create(beads.Bead{
		Title:       githubPRRepairTitle(result),
		Type:        "task",
		Priority:    &priority,
		Description: githubPRRepairDescription(result),
		Labels:      []string{"github", "ci", "repair", "pr-monitor"},
		Metadata:    githubPRRepairMetadata(result),
	})
	if err != nil {
		return githubPRRepairOutcome{}, fmt.Errorf("creating repair bead: %w", err)
	}
	outcome := githubPRRepairOutcome{bead: created, created: true}
	// Attach the configured repair workflow so the routed bead carries the
	// standard branch/test/push/refinery steps instead of sitting as a raw
	// routed task (ga-y5yhvnk). Attach failure is non-fatal: the bead is
	// created and routed, so the pool scaler can still pick it up.
	if err := attachGitHubPRRepairWorkflow(store, cliGraphStore(store, cfg, cityPath), cfg, rig, monitor, created, result); err != nil {
		outcome.dispatchErr = err
		return outcome, nil
	}
	outcome.dispatched = true
	return outcome, nil
}

// firstOpenRepairBead returns the first non-closed bead, or nil. A closed
// repair bead must not suppress a fresh bead when the same PR/head regresses
// after the prior repair was completed.
func firstOpenRepairBead(candidates []beads.Bead) *beads.Bead {
	for i := range candidates {
		if candidates[i].Status != "closed" {
			return &candidates[i]
		}
	}
	return nil
}

// refreshGitHubPRRepairBead updates the volatile state (failure kind, checks,
// merge state, description, route) on an existing repair bead so one bead
// tracks the PR/head across GitHub re-evaluations.
func refreshGitHubPRRepairBead(store beads.Store, existing beads.Bead, result githubmonitor.Result) (beads.Bead, error) {
	metadata := githubPRRepairVolatileMetadata(result)
	metadata[beadmeta.RoutedToMetadataKey] = result.RepairRoute
	desc := githubPRRepairDescription(result)
	if err := store.Update(existing.ID, beads.UpdateOpts{
		Metadata:    metadata,
		Description: &desc,
	}); err != nil {
		return beads.Bead{}, fmt.Errorf("refreshing repair bead %s: %w", existing.ID, err)
	}
	existing.Description = desc
	if existing.Metadata == nil {
		existing.Metadata = make(map[string]string, len(metadata))
	}
	for k, v := range metadata {
		existing.Metadata[k] = v
	}
	return existing, nil
}

func githubPRRepairDedupeMetadata(result githubmonitor.Result) map[string]string {
	return map[string]string{
		"source":          "github-pr-monitor",
		"github.owner":    result.Owner,
		"github.repo":     result.Repo,
		"github.pr":       strconv.Itoa(result.Number),
		"github.head_sha": result.HeadSHA,
	}
}

// githubPRRepairVolatileMetadata holds the fields that change as GitHub
// re-evaluates the same PR/head; these are refreshed on every monitor pass.
func githubPRRepairVolatileMetadata(result githubmonitor.Result) map[string]string {
	return map[string]string{
		"github.failure_kind":       result.FailureKind,
		"github.monitor":            result.Monitor,
		"github.url":                result.URL,
		"github.base":               result.BaseRefName,
		"github.head":               result.HeadRefName,
		"github.merge_state_status": result.MergeStateStatus,
		"github.state":              result.State,
		"github.failed_checks":      strings.Join(result.FailedChecks, "\n"),
		"github.pending_checks":     strings.Join(result.PendingChecks, "\n"),
	}
}

func githubPRRepairMetadata(result githubmonitor.Result) map[string]string {
	metadata := githubPRRepairDedupeMetadata(result)
	for k, v := range githubPRRepairVolatileMetadata(result) {
		metadata[k] = v
	}
	metadata[beadmeta.RoutedToMetadataKey] = result.RepairRoute
	return metadata
}

// defaultAttachGitHubPRRepairWorkflow instantiates the monitor's repair
// workflow as a molecule attached to the repair bead, so routed repair work
// carries the standard polecat steps. The error is treated as non-fatal by the
// caller (the bead is already created and routed).
//
// Two stores because the classes differ: the repair bead is work class, while
// the attached workflow's class comes from the compiled recipe.
//
// On a converged city that therefore SPLITS the molecule from its parent: the
// root lands in the graph binding carrying opts.ParentID, the repair bead it
// names stays in the scope store, and the two are never in the same ledger.
// That is the contract working, not a leak — beads.Bead.ParentID is a weak
// city-scoped reference, so the link needs no lookup and neither store has to
// see the other's rows. What it costs is that Children(repairBead.ID) against
// the scope store does not return this molecule; a caller that wants the whole
// tree asks the residency resolver, which is the one component that holds both
// legs.
func defaultAttachGitHubPRRepairWorkflow(store beads.Store, graphStore beads.GraphStore, cfg *config.City, rig config.Rig, monitor config.GitHubPRMonitor, bead beads.Bead, result githubmonitor.Result) error {
	workflow := monitor.RepairWorkflowOrDefault()
	if workflow == "" {
		return nil
	}
	searchPaths := cfg.FormulaLayers.SearchPaths(strings.TrimSpace(rig.Name))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// Unwrapped: molecule.Instantiate asserts optional store capabilities, which
	// do not promote through the class wrapper.
	graph := graphStore.Store
	if graph == nil {
		graph = store
	}
	if _, err := cookOnClassRouted(ctx, store, graph, workflow, searchPaths, molecule.Options{
		ParentID:       bead.ID,
		IdempotencyKey: "github-pr-repair-workflow:" + bead.ID,
		Vars:           githubPRRepairWorkflowVars(monitor, bead, result),
	}); err != nil {
		return fmt.Errorf("instantiating repair workflow %q: %w", workflow, err)
	}
	return nil
}

// githubPRRepairWorkflowVars returns the formula vars for a repair workflow:
// the historical built-ins, then the monitor's repair_vars templates filled
// from the PR. With no repair_vars it returns exactly the built-ins.
func githubPRRepairWorkflowVars(monitor config.GitHubPRMonitor, bead beads.Bead, result githubmonitor.Result) map[string]string {
	vars := map[string]string{
		"bead_id": bead.ID,
		"bead":    bead.ID,
		"title":   bead.Title,
		"pr":      strconv.Itoa(result.Number),
		"repo":    result.Owner + "/" + result.Repo,
		"branch":  result.HeadRefName,
	}
	if len(monitor.RepairVars) == 0 {
		return vars
	}
	// Templates read the PR, never another template's output: each entry is
	// filled from this fixed context, so order and self-reference do not matter.
	fill := make(map[string]string, len(vars)+7)
	for k, v := range vars {
		fill[k] = v
	}
	fill["owner"] = result.Owner
	fill["base"] = result.BaseRefName
	fill["head_sha"] = result.HeadSHA
	fill["failure_kind"] = result.FailureKind
	fill["repair_route"] = strings.TrimSpace(monitor.RepairRoute)
	fill["rig"] = strings.TrimSpace(monitor.Rig)
	fill["monitor"] = strings.TrimSpace(monitor.Name)
	for name, template := range monitor.RepairVars {
		vars[strings.TrimSpace(name)] = formula.Substitute(template, fill)
	}
	return vars
}

// defaultNudgeGitHubPRRepairWorker best-effort notifies an assigned worker that
// a PR's failures changed. It shells out to `gc session nudge`; failures are
// ignored because the durable bead update is the source of truth.
func defaultNudgeGitHubPRRepairWorker(cityPath, assignee string, bead beads.Bead, result githubmonitor.Result) {
	msg := fmt.Sprintf("GitHub PR %s/%s#%d still needs repair (%s); refreshed failures on %s.",
		result.Owner, result.Repo, result.Number, result.FailureKind, bead.ID)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "gc", "--city", cityPath, "session", "nudge", assignee, msg)
	disableProductMetricsForChild(cmd)
	_ = cmd.Run() //nolint:errcheck // best-effort; the bead update is the durable record
}

func githubPRRepairTitle(result githubmonitor.Result) string {
	title := strings.TrimSpace(result.Title)
	if title == "" {
		title = result.URL
	}
	if title == "" {
		title = result.FailureKind
	}
	return fmt.Sprintf("Repair GitHub PR %s/%s#%d readiness: %s", result.Owner, result.Repo, result.Number, title)
}

func githubPRRepairDescription(result githubmonitor.Result) string {
	var b strings.Builder
	fmt.Fprintf(&b, "GitHub PR readiness monitor %q found actionable work.\n\n", result.Monitor)
	fmt.Fprintf(&b, "Repository: %s/%s\n", result.Owner, result.Repo)
	fmt.Fprintf(&b, "PR: #%d", result.Number)
	if result.URL != "" {
		fmt.Fprintf(&b, " %s", result.URL)
	}
	b.WriteString("\n")
	fmt.Fprintf(&b, "Base: %s\n", result.BaseRefName)
	if result.HeadRefName != "" {
		fmt.Fprintf(&b, "Head: %s\n", result.HeadRefName)
	}
	if result.HeadSHA != "" {
		fmt.Fprintf(&b, "Head SHA: %s\n", result.HeadSHA)
	}
	fmt.Fprintf(&b, "State: %s\n", result.State)
	if result.FailureKind != "" {
		fmt.Fprintf(&b, "Failure kind: %s\n", result.FailureKind)
	}
	if result.MergeStateStatus != "" {
		fmt.Fprintf(&b, "GitHub merge state: %s\n", result.MergeStateStatus)
	}
	if len(result.FailedChecks) > 0 {
		b.WriteString("\nFailed checks:\n")
		for _, check := range result.FailedChecks {
			fmt.Fprintf(&b, "- %s\n", check)
		}
	}
	if len(result.PendingChecks) > 0 {
		b.WriteString("\nPending checks:\n")
		for _, check := range result.PendingChecks {
			fmt.Fprintf(&b, "- %s\n", check)
		}
	}
	if result.RepairRoute != "" {
		fmt.Fprintf(&b, "\nRoute: %s\n", result.RepairRoute)
	}
	return b.String()
}

func selectGitHubPRMonitors(cfg *config.City, name string) ([]config.GitHubPRMonitor, error) {
	if cfg == nil || len(cfg.GitHub.PRMonitors) == 0 {
		return nil, errors.New("no github.pr_monitor entries are configured")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return append([]config.GitHubPRMonitor(nil), cfg.GitHub.PRMonitors...), nil
	}
	for _, monitor := range cfg.GitHub.PRMonitors {
		if strings.TrimSpace(monitor.Name) == name {
			return []config.GitHubPRMonitor{monitor}, nil
		}
	}
	return nil, fmt.Errorf("github.pr_monitor %q not found", name)
}

func sortGitHubPRBackfillResults(results []githubmonitor.Result) {
	slices.SortFunc(results, func(a, b githubmonitor.Result) int {
		if c := strings.Compare(a.Monitor, b.Monitor); c != 0 {
			return c
		}
		if c := strings.Compare(a.Repo, b.Repo); c != 0 {
			return c
		}
		return a.Number - b.Number
	})
}

func writeGitHubPRBackfillText(stdout io.Writer, result githubPRBackfillResult) {
	if len(result.Results) == 0 {
		fmt.Fprintf(stdout, "No actionable GitHub PR readiness problems found across %d monitor(s).\n", result.MonitorCount) //nolint:errcheck
		return
	}
	for _, pr := range result.Results {
		fmt.Fprintf(stdout, "%s %s/%s#%d %s", pr.Monitor, pr.Owner, pr.Repo, pr.Number, pr.State) //nolint:errcheck
		if pr.FailureKind != "" {
			fmt.Fprintf(stdout, " %s", pr.FailureKind) //nolint:errcheck
		}
		if pr.MergeStateStatus != "" {
			fmt.Fprintf(stdout, " merge=%s", pr.MergeStateStatus) //nolint:errcheck
		}
		if len(pr.FailedChecks) > 0 {
			fmt.Fprintf(stdout, " failed=%s", strings.Join(pr.FailedChecks, ",")) //nolint:errcheck
		}
		if len(pr.PendingChecks) > 0 {
			fmt.Fprintf(stdout, " pending=%s", strings.Join(pr.PendingChecks, ",")) //nolint:errcheck
		}
		if pr.RepairRoute != "" {
			fmt.Fprintf(stdout, " route=%s", pr.RepairRoute) //nolint:errcheck
		}
		if pr.URL != "" {
			fmt.Fprintf(stdout, " url=%s", pr.URL) //nolint:errcheck
		}
		fmt.Fprintln(stdout) //nolint:errcheck
	}
	if len(result.RepairBeads) > 0 {
		fmt.Fprintf(stdout, "Repair beads: %d created, %d updated, %d dispatched.\n", //nolint:errcheck
			result.CreatedRepairs, result.UpdatedRepairs, result.DispatchedRepairs)
		for _, rb := range result.RepairBeads {
			action := "existing"
			switch {
			case rb.Created:
				action = "created"
			case rb.Updated:
				action = "updated"
			}
			fmt.Fprintf(stdout, "  %s #%d %s", rb.ID, rb.PR, action) //nolint:errcheck
			if rb.Dispatched {
				fmt.Fprintf(stdout, " dispatched=%s", rb.Workflow) //nolint:errcheck
			}
			if rb.Route != "" {
				fmt.Fprintf(stdout, " route=%s", rb.Route) //nolint:errcheck
			}
			fmt.Fprintln(stdout) //nolint:errcheck
		}
	}
}

func resolveGitHubToken(ctx context.Context) (string, error) {
	for _, key := range []string{"GITHUB_TOKEN", "GH_TOKEN"} {
		if token := strings.TrimSpace(os.Getenv(key)); token != "" {
			return token, nil
		}
	}
	cmd := exec.CommandContext(ctx, "gh", "auth", "token")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("GitHub token not found in GITHUB_TOKEN/GH_TOKEN and `gh auth token` failed: %w", err)
	}
	token := strings.TrimSpace(string(out))
	if token == "" {
		return "", errors.New("GitHub token not found: `gh auth token` returned empty output")
	}
	return token, nil
}
