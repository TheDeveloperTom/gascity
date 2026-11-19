package config

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
)

const defaultGitHubMergeQueuePolicy = "observe"

// defaultGitHubRepairWorkflow is the formula attached to repair beads when a
// monitor does not configure an explicit repair_workflow. It carries the
// standard polecat branch/test/push/refinery steps.
const defaultGitHubRepairWorkflow = "mol-polecat-work"

// GitHubConfig groups GitHub-facing repository monitor declarations.
type GitHubConfig struct {
	// PRMonitors declares GitHub pull-request readiness monitors.
	PRMonitors []GitHubPRMonitor `toml:"pr_monitor,omitempty"`
}

// GitHubPRMonitor declares how one repository/base-branch set is monitored
// and where durable repair work should be routed when readiness fails.
type GitHubPRMonitor struct {
	// Name is the stable monitor identity used by patches and diagnostics.
	Name string `toml:"name" jsonschema:"required"`
	// Owner is the GitHub repository owner or organization.
	Owner string `toml:"owner" jsonschema:"required"`
	// Repo is the GitHub repository name.
	Repo string `toml:"repo" jsonschema:"required"`
	// BaseBranches lists the base branches this monitor owns.
	BaseBranches []string `toml:"base_branches" jsonschema:"required"`
	// Rig is the Gas City rig that owns repair work for this repository.
	Rig string `toml:"rig" jsonschema:"required"`
	// Authors is an optional fail-closed allow-list of GitHub author logins.
	// When empty, the monitor acts on every open PR against the monitored
	// repo/base branches (the historical behavior). When non-empty, the monitor
	// acts ONLY on PRs whose author login exactly (case-sensitively) matches an
	// allowed value; a PR with an unresolved or empty author is skipped. This
	// lets an operator scope the native monitor to their own PRs so it cannot
	// mint repair beads for other contributors' pull requests.
	Authors []string `toml:"authors,omitempty"`
	// Notify lists session or mail recipients for readiness notifications.
	Notify []string `toml:"notify,omitempty"`
	// RepairRoute is the operator-supplied route target for repair work.
	RepairRoute string `toml:"repair_route" jsonschema:"required"`
	// RepairWorkflow is the formula attached to repair beads created for this
	// monitor. Empty defaults to the standard polecat repair workflow so routed
	// repair work carries the branch/test/push/refinery steps instead of
	// sitting as a raw routed task.
	RepairWorkflow string `toml:"repair_workflow,omitempty"`
	// RepairKinds is an optional allow-list of failure kinds that mint repair
	// beads under `gc github pr backfill --create-repair-beads`. Valid values
	// are "checks_failed", "merge_conflict", "behind_base" and "blocked". When
	// empty, every actionable PR mints a repair bead (the historical behavior).
	// When non-empty, only actionable PRs whose failure kind is listed mint or
	// refresh a repair bead; the others are still reported as actionable. Set
	// ["merge_conflict", "checks_failed"] to keep repair agents off PRs that are
	// merely behind their base or blocked while checks run. Unions with the
	// backfill --failure-kind flag.
	RepairKinds []string `toml:"repair_kinds,omitempty"`
	// HeadRefPrefixes is an optional allow-list of PR head-branch prefixes
	// that may mint repair beads under `gc github pr backfill
	// --create-repair-beads`. When empty, every actionable PR may mint a repair
	// bead (the historical behavior). When non-empty, only actionable PRs whose
	// head ref starts with one of the prefixes (case-sensitive) mint or refresh
	// a repair bead; the others are still reported as actionable and counted as
	// skipped_repairs. A PR with an empty head ref matches no prefix. Use it
	// when one GitHub login opens both automated and hand-made PRs, so authors
	// cannot tell them apart, e.g. ["devwork/task/alice/"]. Unions with the
	// backfill --head-ref-prefix flag.
	HeadRefPrefixes []string `toml:"head_ref_prefixes,omitempty"`
	// RepairVars adds formula vars to the repair workflow attached to a newly
	// created repair bead. Keys are formula var names; values are templates
	// whose {{name}} placeholders are filled from the pull request: bead_id,
	// bead, title, pr, repo (owner/name), owner, branch (head ref), base (base
	// ref), head_sha, failure_kind, repair_route, rig and monitor. When empty,
	// the workflow gets only bead_id, bead, title, pr, repo and branch (the
	// historical behavior). An entry overrides a built-in var of the same name.
	// Example: { base = "{{base}}", implementation_target = "{{repair_route}}" }.
	// The backfill --repair-var flag adds or overrides entries per invocation.
	RepairVars map[string]string `toml:"repair_vars,omitempty"`
	// WebhookSecretEnv is the environment variable containing the webhook
	// HMAC secret. The secret value itself must not be stored in city.toml.
	WebhookSecretEnv string `toml:"webhook_secret_env,omitempty"`
	// WebhookSecretKey is an optional stable key for identifying the webhook
	// secret during rotation. When omitted, WebhookSecretEnv is the key.
	WebhookSecretKey string `toml:"webhook_secret_key,omitempty"`
	// PollInterval optionally enables bounded polling/backfill cadence.
	PollInterval string `toml:"poll_interval,omitempty"`
	// MergeQueuePolicy controls merge-queue signal handling. Empty defaults
	// to "observe"; valid values are "ignore", "observe", and "repair".
	MergeQueuePolicy string `toml:"merge_queue,omitempty" jsonschema:"enum=ignore,enum=observe,enum=repair"`
}

// AllowedAuthorSet returns the trimmed, deduped set of allowed author logins
// for this monitor. Keys are compared case-sensitively at enforcement time. An
// empty result means "no author restriction" (act on all PRs); a non-empty
// result means the monitor is fail-closed to exactly these logins.
func (m GitHubPRMonitor) AllowedAuthorSet() map[string]bool {
	if len(m.Authors) == 0 {
		return nil
	}
	set := make(map[string]bool, len(m.Authors))
	for _, login := range m.Authors {
		login = strings.TrimSpace(login)
		if login != "" {
			set[login] = true
		}
	}
	if len(set) == 0 {
		return nil
	}
	return set
}

// gitHubPRFailureKinds lists the failure kinds the PR readiness classifier
// emits (internal/githubmonitor FailureKind* constants). Kept here because the
// config package cannot import githubmonitor; a githubmonitor test pins the
// two lists together.
var gitHubPRFailureKinds = []string{"checks_failed", "merge_conflict", "behind_base", "blocked"}

// GitHubPRFailureKinds returns the failure kinds accepted by repair_kinds and
// `gc github pr backfill --failure-kind`.
func GitHubPRFailureKinds() []string {
	return append([]string(nil), gitHubPRFailureKinds...)
}

// IsGitHubPRFailureKind reports whether kind is a known PR failure kind. The
// match is exact (case-sensitive, untrimmed).
func IsGitHubPRFailureKind(kind string) bool {
	for _, known := range gitHubPRFailureKinds {
		if kind == known {
			return true
		}
	}
	return false
}

// RepairKindSet returns the trimmed, deduped set of failure kinds allowed to
// mint repair beads for this monitor. An empty result means "no restriction"
// (every actionable failure kind mints a bead).
func (m GitHubPRMonitor) RepairKindSet() map[string]bool {
	set := make(map[string]bool, len(m.RepairKinds))
	for _, kind := range m.RepairKinds {
		kind = strings.TrimSpace(kind)
		if kind != "" {
			set[kind] = true
		}
	}
	if len(set) == 0 {
		return nil
	}
	return set
}

// HeadRefPrefixList returns the trimmed, deduped head-ref prefixes allowed to
// mint repair beads for this monitor, in configured order. A nil result means
// "no restriction" (every head ref may mint a bead).
func (m GitHubPRMonitor) HeadRefPrefixList() []string {
	var out []string
	seen := make(map[string]bool, len(m.HeadRefPrefixes))
	for _, prefix := range m.HeadRefPrefixes {
		prefix = strings.TrimSpace(prefix)
		if prefix == "" || seen[prefix] {
			continue
		}
		seen[prefix] = true
		out = append(out, prefix)
	}
	return out
}

// gitHubPRRepairVarPlaceholders lists the {{name}} placeholders a repair_vars
// template may use. cmd/gc fills exactly these from the pull request.
var gitHubPRRepairVarPlaceholders = []string{
	"bead_id", "bead", "title", "pr", "repo", "owner", "branch", "base",
	"head_sha", "failure_kind", "repair_route", "rig", "monitor",
}

// GitHubPRRepairVarPlaceholders returns the placeholder names accepted in
// repair_vars templates and the backfill --repair-var flag.
func GitHubPRRepairVarPlaceholders() []string {
	return append([]string(nil), gitHubPRRepairVarPlaceholders...)
}

var (
	gitHubPRRepairVarName        = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	gitHubPRRepairVarPlaceholder = regexp.MustCompile(`\{\{[^{}]*\}\}`)
)

// ValidateGitHubPRRepairVar checks one repair_vars entry: the name must be a
// formula var name and every {{...}} in the template must be a known
// placeholder, written exactly as {{name}}.
func ValidateGitHubPRRepairVar(name, template string) error {
	if !gitHubPRRepairVarName.MatchString(name) {
		return fmt.Errorf("invalid var name %q (want a formula var name: letters, digits, underscore)", name)
	}
	for _, match := range gitHubPRRepairVarPlaceholder.FindAllString(template, -1) {
		if !slices.Contains(gitHubPRRepairVarPlaceholders, match[2:len(match)-2]) {
			return fmt.Errorf("unknown placeholder %q (valid: {{%s}})", match, strings.Join(gitHubPRRepairVarPlaceholders, "}}, {{"))
		}
	}
	return nil
}

// MergeQueuePolicyOrDefault returns the normalized merge-queue policy.
func (m GitHubPRMonitor) MergeQueuePolicyOrDefault() string {
	policy := strings.TrimSpace(strings.ToLower(m.MergeQueuePolicy))
	if policy == "" {
		return defaultGitHubMergeQueuePolicy
	}
	return policy
}

// RepairWorkflowOrDefault returns the configured repair workflow formula name,
// or the default polecat repair workflow when unset.
func (m GitHubPRMonitor) RepairWorkflowOrDefault() string {
	if wf := strings.TrimSpace(m.RepairWorkflow); wf != "" {
		return wf
	}
	return defaultGitHubRepairWorkflow
}

// WebhookSecretKeyOrDefault returns the configured secret key or the env var
// name when no explicit key is configured.
func (m GitHubPRMonitor) WebhookSecretKeyOrDefault() string {
	if key := strings.TrimSpace(m.WebhookSecretKey); key != "" {
		return key
	}
	return strings.TrimSpace(m.WebhookSecretEnv)
}

// ValidateGitHubPRMonitors checks GitHub PR readiness monitor declarations.
func ValidateGitHubPRMonitors(cfg *City) error {
	if cfg == nil || len(cfg.GitHub.PRMonitors) == 0 {
		return nil
	}

	rigs := make(map[string]bool, len(cfg.Rigs))
	for _, rig := range cfg.Rigs {
		rigs[rig.Name] = true
	}

	seenNames := make(map[string]int, len(cfg.GitHub.PRMonitors))
	seenRepoBase := make(map[string]string, len(cfg.GitHub.PRMonitors))
	for i, monitor := range cfg.GitHub.PRMonitors {
		ctx := fmt.Sprintf("github.pr_monitor[%d]", i)
		name := strings.TrimSpace(monitor.Name)
		if name == "" {
			return fmt.Errorf("%s: name is required", ctx)
		}
		if prev, ok := seenNames[name]; ok {
			return fmt.Errorf("%s %q: duplicate name also used by github.pr_monitor[%d]", ctx, name, prev)
		}
		seenNames[name] = i

		owner := strings.TrimSpace(monitor.Owner)
		if owner == "" {
			return fmt.Errorf("%s %q: owner is required", ctx, name)
		}
		repo := strings.TrimSpace(monitor.Repo)
		if repo == "" {
			return fmt.Errorf("%s %q: repo is required", ctx, name)
		}
		rig := strings.TrimSpace(monitor.Rig)
		if rig == "" {
			return fmt.Errorf("%s %q: rig is required", ctx, name)
		}
		if !rigs[rig] {
			return fmt.Errorf("%s %q: rig %q is not declared", ctx, name, rig)
		}
		if strings.TrimSpace(monitor.RepairRoute) == "" {
			return fmt.Errorf("%s %q: repair_route is required", ctx, name)
		}
		if len(monitor.BaseBranches) == 0 {
			return fmt.Errorf("%s %q: base_branches is required", ctx, name)
		}

		branchSeen := make(map[string]bool, len(monitor.BaseBranches))
		for _, base := range monitor.BaseBranches {
			base = strings.TrimSpace(base)
			if base == "" {
				return fmt.Errorf("%s %q: base_branches contains an empty branch", ctx, name)
			}
			baseKey := strings.ToLower(base)
			if branchSeen[baseKey] {
				return fmt.Errorf("%s %q: duplicate base branch %q", ctx, name, base)
			}
			branchSeen[baseKey] = true

			repoBaseKey := strings.ToLower(owner) + "/" + strings.ToLower(repo) + "@" + baseKey
			if prev, ok := seenRepoBase[repoBaseKey]; ok {
				return fmt.Errorf("%s %q: duplicate repo/base %s/%s@%s also monitored by %q",
					ctx, name, strings.ToLower(owner), strings.ToLower(repo), baseKey, prev)
			}
			seenRepoBase[repoBaseKey] = name
		}

		for _, recipient := range monitor.Notify {
			if strings.TrimSpace(recipient) == "" {
				return fmt.Errorf("%s %q: notify contains an empty recipient", ctx, name)
			}
		}
		for _, login := range monitor.Authors {
			if strings.TrimSpace(login) == "" {
				return fmt.Errorf("%s %q: authors contains an empty login", ctx, name)
			}
		}
		for _, kind := range monitor.RepairKinds {
			kind = strings.TrimSpace(kind)
			if kind == "" {
				return fmt.Errorf("%s %q: repair_kinds contains an empty kind", ctx, name)
			}
			if !IsGitHubPRFailureKind(kind) {
				return fmt.Errorf("%s %q: repair_kinds contains unknown failure kind %q (valid: %s)",
					ctx, name, kind, strings.Join(gitHubPRFailureKinds, ", "))
			}
		}
		for _, prefix := range monitor.HeadRefPrefixes {
			if strings.TrimSpace(prefix) == "" {
				return fmt.Errorf("%s %q: head_ref_prefixes contains an empty prefix", ctx, name)
			}
		}
		varNames := make([]string, 0, len(monitor.RepairVars))
		for varName := range monitor.RepairVars {
			varNames = append(varNames, varName)
		}
		slices.Sort(varNames)
		for _, varName := range varNames {
			if !gitHubPRRepairVarName.MatchString(varName) {
				return fmt.Errorf("%s %q: repair_vars: %w", ctx, name, ValidateGitHubPRRepairVar(varName, ""))
			}
			if err := ValidateGitHubPRRepairVar(varName, monitor.RepairVars[varName]); err != nil {
				return fmt.Errorf("%s %q: repair_vars.%s: %w", ctx, name, varName, err)
			}
		}
		if envName := strings.TrimSpace(monitor.WebhookSecretEnv); envName != "" && !envVarName.MatchString(envName) {
			return fmt.Errorf("%s %q: webhook_secret_env must be an environment variable name, got %q", ctx, name, monitor.WebhookSecretEnv)
		}
		if monitor.WebhookSecretKey != "" && strings.TrimSpace(monitor.WebhookSecretKey) == "" {
			return fmt.Errorf("%s %q: webhook_secret_key must not be blank", ctx, name)
		}
		if err := validateGitHubPRMonitorPollInterval(ctx, name, monitor.PollInterval); err != nil {
			return err
		}
		switch monitor.MergeQueuePolicyOrDefault() {
		case "ignore", "observe", "repair":
		default:
			return fmt.Errorf("%s %q: merge_queue must be \"ignore\", \"observe\", or \"repair\", got %q",
				ctx, name, monitor.MergeQueuePolicy)
		}
	}
	return nil
}

func validateGitHubPRMonitorPollInterval(ctx, name, value string) error {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	dur, err := time.ParseDuration(value)
	if err != nil {
		return fmt.Errorf("%s %q: poll_interval is not a valid duration: %w", ctx, name, err)
	}
	if dur <= 0 {
		return fmt.Errorf("%s %q: poll_interval must be positive: got %q", ctx, name, value)
	}
	return nil
}
