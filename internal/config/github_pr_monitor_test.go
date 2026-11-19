package config

import (
	"strings"
	"testing"

	"github.com/gastownhall/gascity/internal/fsys"
)

func TestParseGitHubPRMonitors(t *testing.T) {
	cfg, err := Parse([]byte(`
[workspace]
name = "test"

[[github.pr_monitor]]
name = "sample-main"
owner = "sample-org"
repo = "sample-repo"
base_branches = ["main", "release"]
rig = "sample"
authors = ["octocat", "hubot"]
notify = ["addr-a", "addr-b"]
repair_route = "route-a"
webhook_secret_env = "SAMPLE_GITHUB_WEBHOOK_SECRET"
webhook_secret_key = "sample-main"
poll_interval = "2m"
merge_queue = "repair"
`))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(cfg.GitHub.PRMonitors) != 1 {
		t.Fatalf("len(GitHub.PRMonitors) = %d, want 1", len(cfg.GitHub.PRMonitors))
	}
	got := cfg.GitHub.PRMonitors[0]
	if got.Name != "sample-main" {
		t.Errorf("Name = %q, want sample-main", got.Name)
	}
	if got.Owner != "sample-org" || got.Repo != "sample-repo" {
		t.Errorf("repo = %s/%s, want sample-org/sample-repo", got.Owner, got.Repo)
	}
	if len(got.BaseBranches) != 2 || got.BaseBranches[0] != "main" || got.BaseBranches[1] != "release" {
		t.Errorf("BaseBranches = %v, want [main release]", got.BaseBranches)
	}
	if got.Rig != "sample" {
		t.Errorf("Rig = %q, want sample", got.Rig)
	}
	if len(got.Authors) != 2 || got.Authors[0] != "octocat" || got.Authors[1] != "hubot" {
		t.Errorf("Authors = %v, want [octocat hubot]", got.Authors)
	}
	if len(got.Notify) != 2 || got.Notify[0] != "addr-a" || got.Notify[1] != "addr-b" {
		t.Errorf("Notify = %v, want [addr-a addr-b]", got.Notify)
	}
	if got.RepairRoute != "route-a" {
		t.Errorf("RepairRoute = %q, want route-a", got.RepairRoute)
	}
	if got.WebhookSecretEnv != "SAMPLE_GITHUB_WEBHOOK_SECRET" {
		t.Errorf("WebhookSecretEnv = %q, want SAMPLE_GITHUB_WEBHOOK_SECRET", got.WebhookSecretEnv)
	}
	if got.WebhookSecretKey != "sample-main" {
		t.Errorf("WebhookSecretKey = %q, want sample-main", got.WebhookSecretKey)
	}
	if got.PollInterval != "2m" {
		t.Errorf("PollInterval = %q, want 2m", got.PollInterval)
	}
	if got.MergeQueuePolicy != "repair" {
		t.Errorf("MergeQueuePolicy = %q, want repair", got.MergeQueuePolicy)
	}
}

func TestValidateGitHubPRMonitorsRejectsMissingRepoAndRoute(t *testing.T) {
	for _, tc := range []struct {
		name    string
		monitor GitHubPRMonitor
		want    string
	}{
		{
			name: "missing owner",
			monitor: GitHubPRMonitor{
				Name:         "bad",
				Repo:         "sample-repo",
				BaseBranches: []string{"main"},
				Rig:          "sample",
				RepairRoute:  "route-a",
			},
			want: "owner is required",
		},
		{
			name: "missing repo",
			monitor: GitHubPRMonitor{
				Name:         "bad",
				Owner:        "sample-org",
				BaseBranches: []string{"main"},
				Rig:          "sample",
				RepairRoute:  "route-a",
			},
			want: "repo is required",
		},
		{
			name: "missing route",
			monitor: GitHubPRMonitor{
				Name:         "bad",
				Owner:        "sample-org",
				Repo:         "sample-repo",
				BaseBranches: []string{"main"},
				Rig:          "sample",
			},
			want: "repair_route is required",
		},
		{
			name: "empty author entry",
			monitor: GitHubPRMonitor{
				Name:         "bad",
				Owner:        "sample-org",
				Repo:         "sample-repo",
				BaseBranches: []string{"main"},
				Rig:          "sample",
				RepairRoute:  "route-a",
				Authors:      []string{"alice", "  "},
			},
			want: "authors contains an empty login",
		},
		{
			name: "empty repair kind entry",
			monitor: GitHubPRMonitor{
				Name:         "bad",
				Owner:        "sample-org",
				Repo:         "sample-repo",
				BaseBranches: []string{"main"},
				Rig:          "sample",
				RepairRoute:  "route-a",
				RepairKinds:  []string{"merge_conflict", "  "},
			},
			want: "repair_kinds contains an empty kind",
		},
		{
			name: "unknown repair kind",
			monitor: GitHubPRMonitor{
				Name:         "bad",
				Owner:        "sample-org",
				Repo:         "sample-repo",
				BaseBranches: []string{"main"},
				Rig:          "sample",
				RepairRoute:  "route-a",
				RepairKinds:  []string{"merge_conflict", "behind"},
			},
			want: `repair_kinds contains unknown failure kind "behind"`,
		},
		{
			name: "empty head ref prefix",
			monitor: GitHubPRMonitor{
				Name:            "bad",
				Owner:           "sample-org",
				Repo:            "sample-repo",
				BaseBranches:    []string{"main"},
				Rig:             "sample",
				RepairRoute:     "route-a",
				HeadRefPrefixes: []string{"devwork/task/", "  "},
			},
			want: "head_ref_prefixes contains an empty prefix",
		},
		{
			name: "repair var with invalid name",
			monitor: GitHubPRMonitor{
				Name:         "bad",
				Owner:        "sample-org",
				Repo:         "sample-repo",
				BaseBranches: []string{"main"},
				Rig:          "sample",
				RepairRoute:  "route-a",
				RepairVars:   map[string]string{"1base": "{{base}}"},
			},
			want: `repair_vars: invalid var name "1base"`,
		},
		{
			name: "repair var with unknown placeholder",
			monitor: GitHubPRMonitor{
				Name:         "bad",
				Owner:        "sample-org",
				Repo:         "sample-repo",
				BaseBranches: []string{"main"},
				Rig:          "sample",
				RepairRoute:  "route-a",
				RepairVars:   map[string]string{"base": "{{base_ref}}"},
			},
			want: `repair_vars.base: unknown placeholder "{{base_ref}}"`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := &City{
				Rigs: []Rig{{Name: "sample"}},
				GitHub: GitHubConfig{
					PRMonitors: []GitHubPRMonitor{tc.monitor},
				},
			}
			err := ValidateGitHubPRMonitors(cfg)
			if err == nil {
				t.Fatal("ValidateGitHubPRMonitors() = nil, want error")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("ValidateGitHubPRMonitors() = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestValidateGitHubPRMonitorsRejectsDuplicateRepoBase(t *testing.T) {
	cfg := &City{
		Rigs: []Rig{{Name: "sample"}},
		GitHub: GitHubConfig{
			PRMonitors: []GitHubPRMonitor{
				{
					Name:         "main",
					Owner:        "sample-org",
					Repo:         "sample-repo",
					BaseBranches: []string{"main", "release"},
					Rig:          "sample",
					RepairRoute:  "route-a",
				},
				{
					Name:         "main-again",
					Owner:        "SAMPLE-ORG",
					Repo:         "Sample-Repo",
					BaseBranches: []string{"main"},
					Rig:          "sample",
					RepairRoute:  "route-a",
				},
			},
		},
	}
	err := ValidateGitHubPRMonitors(cfg)
	if err == nil {
		t.Fatal("ValidateGitHubPRMonitors() = nil, want duplicate error")
	}
	if !strings.Contains(err.Error(), "duplicate repo/base") || !strings.Contains(err.Error(), "sample-org/sample-repo") {
		t.Fatalf("ValidateGitHubPRMonitors() = %v, want duplicate repo/base for sample-org/sample-repo", err)
	}
}

func TestValidateGitHubPRMonitorsAcceptsEnvBackedWebhookSecret(t *testing.T) {
	cfg := &City{
		Rigs: []Rig{{Name: "sample"}},
		GitHub: GitHubConfig{
			PRMonitors: []GitHubPRMonitor{
				{
					Name:             "main",
					Owner:            "sample-org",
					Repo:             "sample-repo",
					BaseBranches:     []string{"main"},
					Rig:              "sample",
					RepairRoute:      "route-a",
					WebhookSecretEnv: "SAMPLE_GITHUB_WEBHOOK_SECRET",
				},
			},
		},
	}
	if err := ValidateGitHubPRMonitors(cfg); err != nil {
		t.Fatalf("ValidateGitHubPRMonitors: %v", err)
	}

	cfg.GitHub.PRMonitors[0].WebhookSecretEnv = "bad-name"
	err := ValidateGitHubPRMonitors(cfg)
	if err == nil {
		t.Fatal("ValidateGitHubPRMonitors() = nil, want invalid env error")
	}
	if !strings.Contains(err.Error(), "webhook_secret_env") {
		t.Fatalf("ValidateGitHubPRMonitors() = %v, want webhook_secret_env error", err)
	}
}

func TestLoadWithIncludesMergesAndPatchesGitHubPRMonitors(t *testing.T) {
	fs := fsys.NewFake()
	fs.Files["/city/city.toml"] = []byte(`
include = ["github.toml"]

[workspace]
name = "test"

[[rigs]]
name = "sample"
path = "/sample"

[[github.pr_monitor]]
name = "release"
owner = "sample-org"
repo = "sample-repo"
base_branches = ["release"]
rig = "sample"
repair_route = "route-a"
merge_queue = "observe"

[[patches.github_pr_monitor]]
name = "main"
poll_interval = "5m"
notify = ["ops"]
merge_queue = "repair"
`)
	fs.Files["/city/github.toml"] = []byte(`
[[github.pr_monitor]]
name = "main"
owner = "sample-org"
repo = "sample-repo"
base_branches = ["main"]
rig = "sample"
repair_route = "route-a"
poll_interval = "1m"
merge_queue = "observe"
`)

	cfg, _, err := LoadWithIncludes(fs, "/city/city.toml")
	if err != nil {
		t.Fatalf("LoadWithIncludes: %v", err)
	}
	if len(cfg.GitHub.PRMonitors) != 2 {
		t.Fatalf("len(GitHub.PRMonitors) = %d, want 2", len(cfg.GitHub.PRMonitors))
	}
	var mainMonitor *GitHubPRMonitor
	for i := range cfg.GitHub.PRMonitors {
		if cfg.GitHub.PRMonitors[i].Name == "main" {
			mainMonitor = &cfg.GitHub.PRMonitors[i]
			break
		}
	}
	if mainMonitor == nil {
		t.Fatalf("main monitor missing: %#v", cfg.GitHub.PRMonitors)
	}
	if mainMonitor.PollInterval != "5m" {
		t.Errorf("patched PollInterval = %q, want 5m", mainMonitor.PollInterval)
	}
	if mainMonitor.MergeQueuePolicy != "repair" {
		t.Errorf("patched MergeQueuePolicy = %q, want repair", mainMonitor.MergeQueuePolicy)
	}
	if len(mainMonitor.Notify) != 1 || mainMonitor.Notify[0] != "ops" {
		t.Errorf("patched Notify = %v, want [ops]", mainMonitor.Notify)
	}
}

func TestGitHubPRMonitorAllowedAuthorSet(t *testing.T) {
	// No authors configured means no restriction (nil set).
	if got := (GitHubPRMonitor{}).AllowedAuthorSet(); got != nil {
		t.Fatalf("AllowedAuthorSet() = %v, want nil for no authors", got)
	}
	// Only blank entries collapse to no restriction rather than an empty gate
	// that would reject every PR.
	if got := (GitHubPRMonitor{Authors: []string{"", "  "}}).AllowedAuthorSet(); got != nil {
		t.Fatalf("AllowedAuthorSet() = %v, want nil for blank-only authors", got)
	}
	set := (GitHubPRMonitor{Authors: []string{" alice ", "bob", "alice"}}).AllowedAuthorSet()
	if len(set) != 2 || !set["alice"] || !set["bob"] {
		t.Fatalf("AllowedAuthorSet() = %v, want trimmed deduped {alice,bob}", set)
	}
	if set["Alice"] {
		t.Fatal("AllowedAuthorSet() must be case-sensitive; Alice should not match alice")
	}
}

func TestParseGitHubPRMonitorRepairKinds(t *testing.T) {
	cfg, err := Parse([]byte(`
[workspace]
name = "test"

[[rigs]]
name = "sample"
path = "sample"

[[github.pr_monitor]]
name = "sample-main"
owner = "sample-org"
repo = "sample-repo"
base_branches = ["main"]
rig = "sample"
repair_route = "route-a"
repair_kinds = ["merge_conflict", "checks_failed"]
`))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	got := cfg.GitHub.PRMonitors[0].RepairKinds
	if len(got) != 2 || got[0] != "merge_conflict" || got[1] != "checks_failed" {
		t.Fatalf("RepairKinds = %v, want [merge_conflict checks_failed]", got)
	}
	if err := ValidateGitHubPRMonitors(cfg); err != nil {
		t.Fatalf("ValidateGitHubPRMonitors() = %v, want nil for known kinds", err)
	}
}

func TestGitHubPRMonitorRepairKindSet(t *testing.T) {
	// No kinds configured means no restriction (nil set): every actionable
	// failure kind mints a repair bead, the historical behavior.
	if got := (GitHubPRMonitor{}).RepairKindSet(); got != nil {
		t.Fatalf("RepairKindSet() = %v, want nil for no kinds", got)
	}
	set := (GitHubPRMonitor{RepairKinds: []string{" merge_conflict ", "checks_failed", "merge_conflict"}}).RepairKindSet()
	if len(set) != 2 || !set["merge_conflict"] || !set["checks_failed"] {
		t.Fatalf("RepairKindSet() = %v, want trimmed deduped {merge_conflict,checks_failed}", set)
	}
}

func TestParseGitHubPRMonitorHeadRefPrefixesAndRepairVars(t *testing.T) {
	cfg, err := Parse([]byte(`
[workspace]
name = "test"

[[rigs]]
name = "sample"
path = "sample"

[[github.pr_monitor]]
name = "sample-main"
owner = "sample-org"
repo = "sample-repo"
base_branches = ["main"]
rig = "sample"
repair_route = "sample/implementer"
head_ref_prefixes = ["devwork/task/me/"]
repair_vars = { base = "{{base}}", implementation_target = "{{repair_route}}", devwork_repo = "{{repo}}", fixed = "literal" }
`))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	m := cfg.GitHub.PRMonitors[0]
	if len(m.HeadRefPrefixes) != 1 || m.HeadRefPrefixes[0] != "devwork/task/me/" {
		t.Fatalf("HeadRefPrefixes = %v, want [devwork/task/me/]", m.HeadRefPrefixes)
	}
	if m.RepairVars["base"] != "{{base}}" || m.RepairVars["implementation_target"] != "{{repair_route}}" ||
		m.RepairVars["devwork_repo"] != "{{repo}}" || m.RepairVars["fixed"] != "literal" {
		t.Fatalf("RepairVars = %v", m.RepairVars)
	}
	if err := ValidateGitHubPRMonitors(cfg); err != nil {
		t.Fatalf("ValidateGitHubPRMonitors() = %v, want nil", err)
	}
}

func TestGitHubPRMonitorHeadRefPrefixList(t *testing.T) {
	// No prefixes configured means no restriction (nil): every head ref may
	// mint a repair bead, the historical behavior.
	if got := (GitHubPRMonitor{}).HeadRefPrefixList(); got != nil {
		t.Fatalf("HeadRefPrefixList() = %v, want nil for no prefixes", got)
	}
	got := (GitHubPRMonitor{HeadRefPrefixes: []string{" devwork/task/me/ ", "fix/", "fix/"}}).HeadRefPrefixList()
	if len(got) != 2 || got[0] != "devwork/task/me/" || got[1] != "fix/" {
		t.Fatalf("HeadRefPrefixList() = %v, want trimmed deduped [devwork/task/me/ fix/]", got)
	}
}

func TestValidateGitHubPRRepairVar(t *testing.T) {
	for _, tc := range []struct {
		name, tmpl, want string
	}{
		{name: "base", tmpl: "{{base}}"},
		{name: "implementation_target", tmpl: "{{repair_route}}"},
		{name: "mixed", tmpl: "pr-{{pr}}-on-{{branch}}"},
		{name: "literal", tmpl: "x"},
		{name: "empty_value", tmpl: ""},
		{name: "", tmpl: "x", want: `invalid var name ""`},
		{name: "has-dash", tmpl: "x", want: `invalid var name "has-dash"`},
		{name: "base", tmpl: "{{ base }}", want: `unknown placeholder "{{ base }}"`},
		{name: "base", tmpl: "{{nope}}", want: `unknown placeholder "{{nope}}"`},
	} {
		err := ValidateGitHubPRRepairVar(tc.name, tc.tmpl)
		if tc.want == "" {
			if err != nil {
				t.Errorf("ValidateGitHubPRRepairVar(%q, %q) = %v, want nil", tc.name, tc.tmpl, err)
			}
			continue
		}
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("ValidateGitHubPRRepairVar(%q, %q) = %v, want %q", tc.name, tc.tmpl, err, tc.want)
		}
	}
}

func TestIsGitHubPRFailureKind(t *testing.T) {
	for _, kind := range []string{"checks_failed", "merge_conflict", "behind_base", "blocked"} {
		if !IsGitHubPRFailureKind(kind) {
			t.Errorf("IsGitHubPRFailureKind(%q) = false, want true", kind)
		}
	}
	for _, kind := range []string{"", "behind", "BLOCKED", "dirty"} {
		if IsGitHubPRFailureKind(kind) {
			t.Errorf("IsGitHubPRFailureKind(%q) = true, want false", kind)
		}
	}
}
