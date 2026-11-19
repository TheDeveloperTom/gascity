package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gastownhall/gascity/internal/beads"
	"github.com/gastownhall/gascity/internal/config"
	"github.com/gastownhall/gascity/internal/githubmonitor"
)

type fakeGitHubPRLister struct {
	prs []githubmonitor.PullRequest
	err error
}

func (f fakeGitHubPRLister) ListOpenPullRequests(context.Context, string, string) ([]githubmonitor.PullRequest, error) {
	return f.prs, f.err
}

// stubGitHubPRLister is a pointer-backed lister whose PR set can be mutated
// between backfill runs to simulate evolving GitHub state.
type stubGitHubPRLister struct {
	prs []githubmonitor.PullRequest
}

func (s *stubGitHubPRLister) ListOpenPullRequests(context.Context, string, string) ([]githubmonitor.PullRequest, error) {
	return s.prs, nil
}

// stubGitHubRepairWorkflowAttach replaces the workflow-attach seam with a
// recorder so repair-bead tests stay hermetic (no on-disk formulas). The
// returned slice pointer accumulates the workflow name attached per create.
func stubGitHubRepairWorkflowAttach(t *testing.T) *[]string {
	t.Helper()
	old := attachGitHubPRRepairWorkflow
	calls := []string{}
	attachGitHubPRRepairWorkflow = func(_ beads.Store, _ beads.GraphStore, _ *config.City, _ config.Rig, monitor config.GitHubPRMonitor, _ beads.Bead, _ githubmonitor.Result) error {
		calls = append(calls, monitor.RepairWorkflowOrDefault())
		return nil
	}
	t.Cleanup(func() { attachGitHubPRRepairWorkflow = old })
	return &calls
}

func TestGitHubPRBackfillCommandReportsActionableResults(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	oldToken := resolveGitHubTokenForBackfill
	oldClient := newGitHubPRBackfillClient
	resolveGitHubTokenForBackfill = func(context.Context) (string, error) { return "token", nil }
	newGitHubPRBackfillClient = func(token string) githubPRLister {
		if token != "token" {
			t.Fatalf("token = %q, want test token", token)
		}
		return fakeGitHubPRLister{prs: []githubmonitor.PullRequest{
			{
				Number:           2560,
				Title:            "Deploy",
				URL:              "https://github.com/partcleda/partcl/pull/2560",
				BaseRefName:      "main",
				HeadRefName:      "fix",
				HeadSHA:          "abc123",
				MergeStateStatus: "BLOCKED",
				Checks:           []githubmonitor.Check{{Name: "deploy", Status: "COMPLETED", Conclusion: "FAILURE"}},
			},
		}}
	}
	t.Cleanup(func() {
		resolveGitHubTokenForBackfill = oldToken
		newGitHubPRBackfillClient = oldClient
	})

	var stdout, stderr bytes.Buffer
	code := run([]string{"--city", cityPath, "github", "pr", "backfill", "partcl-main", "--json"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("run code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}
	var payload struct {
		MonitorCount    int `json:"monitor_count"`
		ResultCount     int `json:"result_count"`
		ActionableCount int `json:"actionable_count"`
		Results         []githubmonitor.Result
		OK              bool `json:"ok"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		t.Fatalf("decode stdout %q: %v", stdout.String(), err)
	}
	if !payload.OK {
		t.Fatal("ok = false, want true")
	}
	if payload.MonitorCount != 1 || payload.ResultCount != 1 || payload.ActionableCount != 1 {
		t.Fatalf("counts = monitors %d results %d actionable %d, want 1/1/1", payload.MonitorCount, payload.ResultCount, payload.ActionableCount)
	}
	if got := payload.Results[0]; got.Number != 2560 || got.State != githubmonitor.StateFailed || got.RepairRoute != "partcl/polecat" {
		t.Fatalf("result = %#v, want failing PR routed to partcl/polecat", got)
	}
}

func TestGitHubPRBackfillCommandCreatesDedupedRepairBeads(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	store := beads.NewMemStore()
	oldToken := resolveGitHubTokenForBackfill
	oldClient := newGitHubPRBackfillClient
	oldStore := openGitHubPRRepairStore
	resolveGitHubTokenForBackfill = func(context.Context) (string, error) { return "token", nil }
	newGitHubPRBackfillClient = func(string) githubPRLister {
		return fakeGitHubPRLister{prs: []githubmonitor.PullRequest{
			{
				Number:           2560,
				Title:            "Deploy",
				URL:              "https://github.com/partcleda/partcl/pull/2560",
				BaseRefName:      "main",
				HeadRefName:      "fix",
				HeadSHA:          "abc123",
				MergeStateStatus: "BLOCKED",
				Checks:           []githubmonitor.Check{{Name: "deploy", Status: "COMPLETED", Conclusion: "FAILURE"}},
			},
		}}
	}
	openGitHubPRRepairStore = func(string, string) (beads.Store, error) {
		return store, nil
	}
	attachCalls := stubGitHubRepairWorkflowAttach(t)
	t.Cleanup(func() {
		resolveGitHubTokenForBackfill = oldToken
		newGitHubPRBackfillClient = oldClient
		openGitHubPRRepairStore = oldStore
	})

	for i := 0; i < 2; i++ {
		var stdout, stderr bytes.Buffer
		code := run([]string{"--city", cityPath, "github", "pr", "backfill", "partcl-main", "--create-repair-beads", "--json"}, &stdout, &stderr)
		if code != 0 {
			t.Fatalf("run %d code = %d, stdout = %q, stderr = %q", i, code, stdout.String(), stderr.String())
		}
	}

	created, err := store.ListByMetadata(map[string]string{
		"source":          "github-pr-monitor",
		"github.owner":    "partcleda",
		"github.repo":     "partcl",
		"github.pr":       "2560",
		"github.head_sha": "abc123",
	}, 0)
	if err != nil {
		t.Fatalf("ListByMetadata: %v", err)
	}
	if len(created) != 1 {
		t.Fatalf("created repair beads = %#v, want one deduped bead", created)
	}
	if got := created[0].Metadata["gc.routed_to"]; got != "partcl/polecat" {
		t.Fatalf("gc.routed_to = %q, want partcl/polecat", got)
	}
	if !strings.Contains(created[0].Description, "deploy") {
		t.Fatalf("description = %q, want failed check detail", created[0].Description)
	}
	// The workflow attaches exactly once — on creation, not on the second
	// (update) pass over the same PR/head.
	if len(*attachCalls) != 1 {
		t.Fatalf("workflow attach calls = %v, want exactly one (create only)", *attachCalls)
	}
	if (*attachCalls)[0] != "mol-polecat-work" {
		t.Fatalf("attached workflow = %q, want mol-polecat-work default", (*attachCalls)[0])
	}
}

func TestGitHubPRBackfillCoalescesAcrossFailureKindTransition(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	store := beads.NewMemStore()
	lister := &stubGitHubPRLister{}
	oldToken := resolveGitHubTokenForBackfill
	oldClient := newGitHubPRBackfillClient
	oldStore := openGitHubPRRepairStore
	resolveGitHubTokenForBackfill = func(context.Context) (string, error) { return "token", nil }
	newGitHubPRBackfillClient = func(string) githubPRLister { return lister }
	openGitHubPRRepairStore = func(string, string) (beads.Store, error) { return store, nil }
	stubGitHubRepairWorkflowAttach(t)
	t.Cleanup(func() {
		resolveGitHubTokenForBackfill = oldToken
		newGitHubPRBackfillClient = oldClient
		openGitHubPRRepairStore = oldStore
	})

	// Pass 1: GitHub reports the PR as BLOCKED (failure_kind=blocked).
	lister.prs = []githubmonitor.PullRequest{{
		Number: 2601, Title: "Feature", URL: "https://github.com/partcleda/partcl/pull/2601",
		BaseRefName: "main", HeadRefName: "feat", HeadSHA: "deadbeef", MergeStateStatus: "BLOCKED",
	}}
	runGitHubBackfillOrFatal(t, cityPath)

	// Pass 2: same head SHA, but now a required check has failed
	// (failure_kind=checks_failed). This must update the existing bead, not
	// create a second one.
	lister.prs = []githubmonitor.PullRequest{{
		Number: 2601, Title: "Feature", URL: "https://github.com/partcleda/partcl/pull/2601",
		BaseRefName: "main", HeadRefName: "feat", HeadSHA: "deadbeef", MergeStateStatus: "BLOCKED",
		Checks: []githubmonitor.Check{{Name: "build", Status: "COMPLETED", Conclusion: "FAILURE"}},
	}}
	runGitHubBackfillOrFatal(t, cityPath)

	beadsForHead, err := store.ListByMetadata(map[string]string{
		"source":          "github-pr-monitor",
		"github.owner":    "partcleda",
		"github.repo":     "partcl",
		"github.pr":       "2601",
		"github.head_sha": "deadbeef",
	}, 0)
	if err != nil {
		t.Fatalf("ListByMetadata: %v", err)
	}
	if len(beadsForHead) != 1 {
		t.Fatalf("repair beads for PR/head = %d, want one coalesced bead across failure-kind transition", len(beadsForHead))
	}
	if got := beadsForHead[0].Metadata["github.failure_kind"]; got != githubmonitor.FailureKindChecksFailed {
		t.Fatalf("failure_kind = %q, want refreshed to %q", got, githubmonitor.FailureKindChecksFailed)
	}
	if got := beadsForHead[0].Metadata["github.failed_checks"]; !strings.Contains(got, "build") {
		t.Fatalf("failed_checks = %q, want refreshed build failure", got)
	}
}

func TestGitHubPRBackfillCreatesSeparateBeadForNewHeadSHA(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	store := beads.NewMemStore()
	lister := &stubGitHubPRLister{}
	oldToken := resolveGitHubTokenForBackfill
	oldClient := newGitHubPRBackfillClient
	oldStore := openGitHubPRRepairStore
	resolveGitHubTokenForBackfill = func(context.Context) (string, error) { return "token", nil }
	newGitHubPRBackfillClient = func(string) githubPRLister { return lister }
	openGitHubPRRepairStore = func(string, string) (beads.Store, error) { return store, nil }
	stubGitHubRepairWorkflowAttach(t)
	t.Cleanup(func() {
		resolveGitHubTokenForBackfill = oldToken
		newGitHubPRBackfillClient = oldClient
		openGitHubPRRepairStore = oldStore
	})

	base := githubmonitor.PullRequest{
		Number: 2601, Title: "Feature", URL: "https://github.com/partcleda/partcl/pull/2601",
		BaseRefName: "main", HeadRefName: "feat", MergeStateStatus: "DIRTY",
	}
	first := base
	first.HeadSHA = "sha-one"
	lister.prs = []githubmonitor.PullRequest{first}
	runGitHubBackfillOrFatal(t, cityPath)

	// A force-push changes the head SHA: stale-commit failures should not be
	// merged into a fresh bead, so a new bead is keyed on the new SHA.
	second := base
	second.HeadSHA = "sha-two"
	lister.prs = []githubmonitor.PullRequest{second}
	runGitHubBackfillOrFatal(t, cityPath)

	all, err := store.ListByMetadata(map[string]string{
		"source":       "github-pr-monitor",
		"github.owner": "partcleda",
		"github.repo":  "partcl",
		"github.pr":    "2601",
	}, 0)
	if err != nil {
		t.Fatalf("ListByMetadata: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("repair beads = %d, want one per distinct head SHA (2)", len(all))
	}
}

func TestGitHubPRBackfillDispatchesWorkflowOnCreateOnly(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	store := beads.NewMemStore()
	lister := &stubGitHubPRLister{prs: []githubmonitor.PullRequest{{
		Number: 2560, Title: "Deploy", URL: "https://github.com/partcleda/partcl/pull/2560",
		BaseRefName: "main", HeadRefName: "fix", HeadSHA: "abc123", MergeStateStatus: "DIRTY",
	}}}
	oldToken := resolveGitHubTokenForBackfill
	oldClient := newGitHubPRBackfillClient
	oldStore := openGitHubPRRepairStore
	resolveGitHubTokenForBackfill = func(context.Context) (string, error) { return "token", nil }
	newGitHubPRBackfillClient = func(string) githubPRLister { return lister }
	openGitHubPRRepairStore = func(string, string) (beads.Store, error) { return store, nil }
	attachCalls := stubGitHubRepairWorkflowAttach(t)
	t.Cleanup(func() {
		resolveGitHubTokenForBackfill = oldToken
		newGitHubPRBackfillClient = oldClient
		openGitHubPRRepairStore = oldStore
	})

	// First pass creates and dispatches.
	var stdout, stderr bytes.Buffer
	if code := run([]string{"--city", cityPath, "github", "pr", "backfill", "partcl-main", "--create-repair-beads", "--json"}, &stdout, &stderr); code != 0 {
		t.Fatalf("run code = %d, stderr = %q", code, stderr.String())
	}
	var payload githubPRBackfillResult
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		t.Fatalf("decode %q: %v", stdout.String(), err)
	}
	if payload.CreatedRepairs != 1 || payload.DispatchedRepairs != 1 {
		t.Fatalf("created=%d dispatched=%d, want 1/1", payload.CreatedRepairs, payload.DispatchedRepairs)
	}
	if len(payload.RepairBeads) != 1 || !payload.RepairBeads[0].Dispatched || payload.RepairBeads[0].Workflow != "mol-polecat-work" {
		t.Fatalf("repair bead = %#v, want dispatched mol-polecat-work", payload.RepairBeads)
	}

	// Second pass over the same PR/head updates, does not re-dispatch.
	var stdout2, stderr2 bytes.Buffer
	if code := run([]string{"--city", cityPath, "github", "pr", "backfill", "partcl-main", "--create-repair-beads", "--json"}, &stdout2, &stderr2); code != 0 {
		t.Fatalf("run 2 code = %d, stderr = %q", code, stderr2.String())
	}
	var payload2 githubPRBackfillResult
	if err := json.Unmarshal(stdout2.Bytes(), &payload2); err != nil {
		t.Fatalf("decode %q: %v", stdout2.String(), err)
	}
	if payload2.CreatedRepairs != 0 || payload2.UpdatedRepairs != 1 || payload2.DispatchedRepairs != 0 {
		t.Fatalf("second pass created=%d updated=%d dispatched=%d, want 0/1/0", payload2.CreatedRepairs, payload2.UpdatedRepairs, payload2.DispatchedRepairs)
	}
	if len(*attachCalls) != 1 {
		t.Fatalf("attach calls = %v, want exactly one across both passes", *attachCalls)
	}
}

func runGitHubBackfillOrFatal(t *testing.T, cityPath string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	if code := run([]string{"--city", cityPath, "github", "pr", "backfill", "partcl-main", "--create-repair-beads", "--json"}, &stdout, &stderr); code != 0 {
		t.Fatalf("run code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}
}

func TestGitHubPRBackfillCommandFiltersCleanResultsByDefault(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	oldToken := resolveGitHubTokenForBackfill
	oldClient := newGitHubPRBackfillClient
	resolveGitHubTokenForBackfill = func(context.Context) (string, error) { return "token", nil }
	newGitHubPRBackfillClient = func(string) githubPRLister {
		return fakeGitHubPRLister{prs: []githubmonitor.PullRequest{
			{Number: 1, BaseRefName: "main", MergeStateStatus: "CLEAN"},
		}}
	}
	t.Cleanup(func() {
		resolveGitHubTokenForBackfill = oldToken
		newGitHubPRBackfillClient = oldClient
	})

	var stdout, stderr bytes.Buffer
	code := run([]string{"--city", cityPath, "github", "pr", "backfill", "--json"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("run code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}
	if strings.Contains(stdout.String(), `"number":1`) {
		t.Fatalf("stdout = %s, clean PR should be filtered by default", stdout.String())
	}
}

func TestGitHubPRBackfillAuthorFlagFailsClosedToAllowedAuthor(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	oldToken := resolveGitHubTokenForBackfill
	oldClient := newGitHubPRBackfillClient
	resolveGitHubTokenForBackfill = func(context.Context) (string, error) { return "token", nil }
	newGitHubPRBackfillClient = func(string) githubPRLister {
		return fakeGitHubPRLister{prs: []githubmonitor.PullRequest{
			// Allowed author, actionable.
			{Number: 1, Author: "alice", BaseRefName: "main", HeadSHA: "a1", MergeStateStatus: "DIRTY"},
			// Different author, actionable — must be skipped by --author.
			{Number: 2, Author: "bob", BaseRefName: "main", HeadSHA: "b2", MergeStateStatus: "DIRTY"},
			// Unresolved author, actionable — must fail closed and be skipped.
			{Number: 3, Author: "", BaseRefName: "main", HeadSHA: "c3", MergeStateStatus: "DIRTY"},
		}}
	}
	t.Cleanup(func() {
		resolveGitHubTokenForBackfill = oldToken
		newGitHubPRBackfillClient = oldClient
	})

	var stdout, stderr bytes.Buffer
	code := run([]string{"--city", cityPath, "github", "pr", "backfill", "--author", "alice", "--json"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("run code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}
	var payload struct {
		ResultCount     int `json:"result_count"`
		ActionableCount int `json:"actionable_count"`
		Results         []githubmonitor.Result
		OK              bool `json:"ok"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		t.Fatalf("decode stdout %q: %v", stdout.String(), err)
	}
	if !payload.OK {
		t.Fatal("ok = false, want true")
	}
	if payload.ResultCount != 1 || payload.ActionableCount != 1 {
		t.Fatalf("counts = results %d actionable %d, want 1/1 (only alice)", payload.ResultCount, payload.ActionableCount)
	}
	if payload.Results[0].Number != 1 || payload.Results[0].Author != "alice" {
		t.Fatalf("result = %#v, want alice's PR #1 only", payload.Results[0])
	}
}

func TestGitHubPRBackfillRejectsBlankAuthorFlag(t *testing.T) {
	for _, tc := range []struct {
		name    string
		authors []string
	}{
		{name: "empty", authors: []string{""}},
		{name: "whitespace", authors: []string{"  "}},
		{name: "empty alongside valid", authors: []string{"alice", ""}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cityPath := writeGitHubMonitorTestCity(t)
			oldToken := resolveGitHubTokenForBackfill
			oldClient := newGitHubPRBackfillClient
			oldStore := openGitHubPRRepairStore
			resolveGitHubTokenForBackfill = func(context.Context) (string, error) {
				t.Fatal("token resolved despite blank --author")
				return "", nil
			}
			newGitHubPRBackfillClient = func(string) githubPRLister {
				t.Fatal("GitHub client created despite blank --author")
				return nil
			}
			openGitHubPRRepairStore = func(string, string) (beads.Store, error) {
				t.Fatal("repair store opened despite blank --author")
				return nil, nil
			}
			t.Cleanup(func() {
				resolveGitHubTokenForBackfill = oldToken
				newGitHubPRBackfillClient = oldClient
				openGitHubPRRepairStore = oldStore
			})

			args := []string{"--city", cityPath, "github", "pr", "backfill", "--create-repair-beads"}
			for _, login := range tc.authors {
				args = append(args, "--author", login)
			}
			var stdout, stderr bytes.Buffer
			if code := run(args, &stdout, &stderr); code == 0 {
				t.Fatalf("run code = 0, want non-zero; stdout = %q", stdout.String())
			}
			if !strings.Contains(stderr.String(), "--author must not be empty") {
				t.Fatalf("stderr = %q, want --author must not be empty", stderr.String())
			}
		})
	}
}

func TestGitHubPRBackfillAuthorFlagCreatesNoRepairBeadForOtherAuthors(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	store := beads.NewMemStore()
	oldToken := resolveGitHubTokenForBackfill
	oldClient := newGitHubPRBackfillClient
	oldStore := openGitHubPRRepairStore
	resolveGitHubTokenForBackfill = func(context.Context) (string, error) { return "token", nil }
	newGitHubPRBackfillClient = func(string) githubPRLister {
		return fakeGitHubPRLister{prs: []githubmonitor.PullRequest{
			{Number: 1, Author: "alice", BaseRefName: "main", HeadSHA: "a1", MergeStateStatus: "DIRTY"},
			{Number: 2, Author: "bob", BaseRefName: "main", HeadSHA: "b2", MergeStateStatus: "DIRTY"},
			{Number: 3, Author: "", BaseRefName: "main", HeadSHA: "c3", MergeStateStatus: "DIRTY"},
		}}
	}
	openGitHubPRRepairStore = func(string, string) (beads.Store, error) { return store, nil }
	stubGitHubRepairWorkflowAttach(t)
	t.Cleanup(func() {
		resolveGitHubTokenForBackfill = oldToken
		newGitHubPRBackfillClient = oldClient
		openGitHubPRRepairStore = oldStore
	})

	var stdout, stderr bytes.Buffer
	code := run([]string{"--city", cityPath, "github", "pr", "backfill", "--author", "alice", "--create-repair-beads", "--json"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("run code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}

	created, err := store.ListByMetadata(map[string]string{"source": "github-pr-monitor"}, 0)
	if err != nil {
		t.Fatalf("ListByMetadata: %v", err)
	}
	if len(created) != 1 {
		t.Fatalf("repair beads = %d, want 1 (only alice's PR)", len(created))
	}
	if got := created[0].Metadata["github.pr"]; got != "1" {
		t.Fatalf("github.pr = %q, want 1", got)
	}
}

// failureKindFixturePRs is one PR per actionable shape that matters for the
// repair-kind filter: CI still running on a protected branch (BLOCKED, no
// failed check), merely behind base, a merge conflict, and a red check.
func failureKindFixturePRs() []githubmonitor.PullRequest {
	return []githubmonitor.PullRequest{
		{Number: 10, BaseRefName: "main", HeadSHA: "blocked10", MergeStateStatus: "BLOCKED",
			Checks: []githubmonitor.Check{{Name: "ci", Status: "IN_PROGRESS"}}},
		{Number: 11, BaseRefName: "main", HeadSHA: "behind11", MergeStateStatus: "BEHIND"},
		{Number: 12, BaseRefName: "main", HeadSHA: "dirty12", MergeStateStatus: "DIRTY"},
		{Number: 13, BaseRefName: "main", HeadSHA: "red13", MergeStateStatus: "BLOCKED",
			Checks: []githubmonitor.Check{{Name: "ci", Status: "COMPLETED", Conclusion: "FAILURE"}}},
	}
}

type failureKindBackfillPayload struct {
	ActionableCount int `json:"actionable_count"`
	CreatedRepairs  int `json:"created_repairs"`
	SkippedRepairs  int `json:"skipped_repairs"`
}

// runFailureKindBackfill runs backfill over failureKindFixturePRs and returns
// the decoded payload plus the PR numbers that got a repair bead.
func runFailureKindBackfill(t *testing.T, cityPath string, extraArgs ...string) (failureKindBackfillPayload, map[string]bool) {
	t.Helper()
	store := beads.NewMemStore()
	oldToken := resolveGitHubTokenForBackfill
	oldClient := newGitHubPRBackfillClient
	oldStore := openGitHubPRRepairStore
	resolveGitHubTokenForBackfill = func(context.Context) (string, error) { return "token", nil }
	newGitHubPRBackfillClient = func(string) githubPRLister {
		return fakeGitHubPRLister{prs: failureKindFixturePRs()}
	}
	openGitHubPRRepairStore = func(string, string) (beads.Store, error) { return store, nil }
	stubGitHubRepairWorkflowAttach(t)
	t.Cleanup(func() {
		resolveGitHubTokenForBackfill = oldToken
		newGitHubPRBackfillClient = oldClient
		openGitHubPRRepairStore = oldStore
	})

	args := append([]string{"--city", cityPath, "github", "pr", "backfill", "partcl-main", "--create-repair-beads", "--json"}, extraArgs...)
	var stdout, stderr bytes.Buffer
	if code := run(args, &stdout, &stderr); code != 0 {
		t.Fatalf("run code = %d, stdout = %q, stderr = %q", code, stdout.String(), stderr.String())
	}
	var payload failureKindBackfillPayload
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		t.Fatalf("decode stdout %q: %v", stdout.String(), err)
	}
	created, err := store.ListByMetadata(map[string]string{"source": "github-pr-monitor"}, 0)
	if err != nil {
		t.Fatalf("ListByMetadata: %v", err)
	}
	prs := map[string]bool{}
	for _, b := range created {
		prs[b.Metadata["github.pr"]] = true
	}
	return payload, prs
}

func assertRepairPRs(t *testing.T, got map[string]bool, want ...string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("repair beads for PRs %v, want exactly %v", got, want)
	}
	for _, pr := range want {
		if !got[pr] {
			t.Fatalf("repair beads for PRs %v, want exactly %v", got, want)
		}
	}
}

// TestBackfillFailureKindFilter pins the opt-in repair-kind filter: with
// --failure-kind merge_conflict --failure-kind checks_failed, only the
// conflicted and the red PR mint repair beads. The BEHIND and the
// BLOCKED-while-CI-runs PRs are still reported as actionable (the detector is
// unchanged) but get no bead.
func TestBackfillFailureKindFilter(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	payload, prs := runFailureKindBackfill(t, cityPath, "--failure-kind", "merge_conflict", "--failure-kind", "checks_failed")
	assertRepairPRs(t, prs, "12", "13")
	if payload.ActionableCount != 4 {
		t.Fatalf("actionable_count = %d, want 4 (detector unchanged by the filter)", payload.ActionableCount)
	}
	if payload.CreatedRepairs != 2 || payload.SkippedRepairs != 2 {
		t.Fatalf("created=%d skipped=%d, want 2/2", payload.CreatedRepairs, payload.SkippedRepairs)
	}
}

func TestBackfillFailureKindFilterBehindOnlyMintsNoBead(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	_, prs := runFailureKindBackfill(t, cityPath, "--failure-kind", "merge_conflict")
	assertRepairPRs(t, prs, "12")
}

// TestBackfillWithoutFailureKindKeepsHistoricalBehavior pins the default: no
// flag and no repair_kinds means every actionable PR mints a bead, as before.
func TestBackfillWithoutFailureKindKeepsHistoricalBehavior(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	payload, prs := runFailureKindBackfill(t, cityPath)
	assertRepairPRs(t, prs, "10", "11", "12", "13")
	if payload.SkippedRepairs != 0 {
		t.Fatalf("skipped_repairs = %d, want 0 with no filter", payload.SkippedRepairs)
	}
}

func TestBackfillMonitorRepairKindsFiltersRepairBeads(t *testing.T) {
	cityPath := writeGitHubMonitorTestCityWith(t, `repair_kinds = ["merge_conflict", "checks_failed"]`+"\n")
	_, prs := runFailureKindBackfill(t, cityPath)
	assertRepairPRs(t, prs, "12", "13")
}

// TestBackfillFailureKindUnionsWithMonitorRepairKinds mirrors --author: the
// flag unions with the monitor's configured list.
func TestBackfillFailureKindUnionsWithMonitorRepairKinds(t *testing.T) {
	cityPath := writeGitHubMonitorTestCityWith(t, `repair_kinds = ["merge_conflict"]`+"\n")
	_, prs := runFailureKindBackfill(t, cityPath, "--failure-kind", "checks_failed")
	assertRepairPRs(t, prs, "12", "13")
}

func TestBackfillRejectsInvalidFailureKindFlag(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{name: "unknown kind", args: []string{"--create-repair-beads", "--failure-kind", "behind"}, want: `unknown --failure-kind "behind"`},
		{name: "blank kind", args: []string{"--create-repair-beads", "--failure-kind", " "}, want: "--failure-kind must not be empty"},
		{name: "without create-repair-beads", args: []string{"--failure-kind", "merge_conflict"}, want: "--failure-kind requires --create-repair-beads"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cityPath := writeGitHubMonitorTestCity(t)
			oldToken := resolveGitHubTokenForBackfill
			oldClient := newGitHubPRBackfillClient
			resolveGitHubTokenForBackfill = func(context.Context) (string, error) {
				t.Fatal("token resolved despite invalid --failure-kind")
				return "", nil
			}
			newGitHubPRBackfillClient = func(string) githubPRLister {
				t.Fatal("GitHub client created despite invalid --failure-kind")
				return nil
			}
			t.Cleanup(func() {
				resolveGitHubTokenForBackfill = oldToken
				newGitHubPRBackfillClient = oldClient
			})
			args := append([]string{"--city", cityPath, "github", "pr", "backfill"}, tc.args...)
			var stdout, stderr bytes.Buffer
			if code := run(args, &stdout, &stderr); code == 0 {
				t.Fatalf("run code = 0, want non-zero; stdout = %q", stdout.String())
			}
			if !strings.Contains(stderr.String(), tc.want) {
				t.Fatalf("stderr = %q, want %q", stderr.String(), tc.want)
			}
		})
	}
}

func writeGitHubMonitorTestCity(t *testing.T) string {
	t.Helper()
	return writeGitHubMonitorTestCityWith(t, "")
}

// writeGitHubMonitorTestCityWith writes the standard monitor test city with
// extraMonitorTOML appended inside the [[github.pr_monitor]] block.
func writeGitHubMonitorTestCityWith(t *testing.T, extraMonitorTOML string) string {
	t.Helper()
	cityPath := t.TempDir()
	if err := os.MkdirAll(filepath.Join(cityPath, ".gc"), 0o755); err != nil {
		t.Fatalf("mkdir .gc: %v", err)
	}
	body := `[workspace]
name = "test-city"

[[rigs]]
name = "partcl"
path = "partcl"
prefix = "pa"

[[github.pr_monitor]]
name = "partcl-main"
owner = "partcleda"
repo = "partcl"
base_branches = ["main"]
rig = "partcl"
repair_route = "partcl/polecat"
notify = ["gastown.mayor"]
poll_interval = "2m"
merge_queue = "repair"
` + extraMonitorTOML
	if err := os.WriteFile(filepath.Join(cityPath, "city.toml"), []byte(body), 0o644); err != nil {
		t.Fatalf("write city.toml: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(cityPath, "partcl"), 0o755); err != nil {
		t.Fatalf("mkdir partcl: %v", err)
	}
	return cityPath
}

func TestGitHubPRBackfillCommandPropagatesRepairStoreError(t *testing.T) {
	cityPath := writeGitHubMonitorTestCity(t)
	oldToken := resolveGitHubTokenForBackfill
	oldClient := newGitHubPRBackfillClient
	oldStore := openGitHubPRRepairStore
	resolveGitHubTokenForBackfill = func(context.Context) (string, error) { return "token", nil }
	newGitHubPRBackfillClient = func(string) githubPRLister {
		return fakeGitHubPRLister{prs: []githubmonitor.PullRequest{{Number: 1, BaseRefName: "main", HeadSHA: "abc", MergeStateStatus: "DIRTY"}}}
	}
	openGitHubPRRepairStore = func(string, string) (beads.Store, error) {
		return nil, fmt.Errorf("store unavailable")
	}
	t.Cleanup(func() {
		resolveGitHubTokenForBackfill = oldToken
		newGitHubPRBackfillClient = oldClient
		openGitHubPRRepairStore = oldStore
	})

	var stdout, stderr bytes.Buffer
	code := run([]string{"--city", cityPath, "github", "pr", "backfill", "--create-repair-beads"}, &stdout, &stderr)
	if code == 0 {
		t.Fatalf("run code = 0, want failure")
	}
	if !strings.Contains(stderr.String(), "store unavailable") {
		t.Fatalf("stderr = %q, want store error", stderr.String())
	}
}
