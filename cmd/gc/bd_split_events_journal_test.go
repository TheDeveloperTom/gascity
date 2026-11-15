package main

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/gastownhall/gascity/internal/bdflags"
)

// The bd events journal (bd_events_journal) is read-only to `bd events tail`:
// it prints the records after a seq and, with --follow, keeps printing new ones
// as they commit. A live board follows each store with it. On a split city gc
// bd forwards exactly that read; every other `events` form (export, prune, the
// bare verb) and every flag of tail besides --follow and --since stays refused.

// eventsTailAllowedForms are the journal reads gc bd forwards on a split city.
var eventsTailAllowedForms = [][]string{
	{"events", "tail", "--follow", "--since", "42", "--json"},
	{"events", "tail", "--since", "0", "--json"},
	{"events", "tail", "--since=7", "--follow"},
	{"--json", "events", "tail", "--follow", "--since", "1"},
	{"events", "tail", "--json"},
	{"events", "tail"},
}

func TestGcBdSplitAdmitsEventsJournalTail(t *testing.T) {
	for _, inv := range bdflags.Inventories() {
		for _, argv := range eventsTailAllowedForms {
			res := resolveBdSplitCommand(inv, argv, "/scope")
			if res.refusal != "" || res.path != "events tail" {
				t.Errorf("%s: gc bd %s: path=%q refusal=%q, want it forwarded as events tail", inv.Name, strings.Join(argv, " "), res.path, res.refusal)
			}
		}
	}
	// Through the whole split gate: forwarded unchanged, no judge rewrites it.
	deps := bdClassGuardDeps{inventory: func() (*bdflags.Inventory, error) { return bdflags.InventoryByName("bd-1.3.2"), nil }}
	for _, argv := range eventsTailAllowedForms {
		g := bdClassFlipGuard(splitGuardTestCity(), t.TempDir(), argv, deps)
		if g.refusal != "" || !slices.Equal(g.args, argv) {
			t.Errorf("gc bd %s on a split city: refusal=%q args=%v", strings.Join(argv, " "), g.refusal, g.args)
		}
	}
}

func TestGcBdSplitRefusesEveryOtherEventsForm(t *testing.T) {
	cases := []struct {
		argv []string
		want string // a substring of the refusal
	}{
		{[]string{"events"}, "gc bd events: refused on this split city: not vetted"},
		{[]string{"events", "export"}, "gc bd events export: refused on this split city: not vetted"},
		{[]string{"events", "export", "--limit", "5", "--json"}, "gc bd events export: refused on this split city: not vetted"},
		{[]string{"events", "prune", "--before", "10"}, "gc bd events prune: refused on this split city: not vetted"},
		{[]string{"events", "prune"}, "gc bd events prune: refused on this split city: not vetted"},
		{[]string{"events", "tail", "--limit", "5"}, "--limit is not allowed here (not vetted for this command)"},
		{[]string{"events", "tail", "--follow", "--since", "1", "--limit", "0"}, "--limit is not allowed here (not vetted for this command)"},
		// tail has no prune/compact/truncate flag: bd itself would reject one.
		{[]string{"events", "tail", "--before", "10"}, "refused on this split city"},
		{[]string{"events", "tail", "--prune"}, "refused on this split city"},
		{[]string{"events", "tail", "--truncate"}, "refused on this split city"},
		{[]string{"events", "tail", "--compact"}, "refused on this split city"},
		// Store redirects stay refused on the allowed form.
		{[]string{"events", "tail", "--follow", "--db", "elsewhere"}, "--db is not allowed here"},
		{[]string{"events", "tail", "--since", "1", "--database", "hq"}, "--database is not allowed here"},
		{[]string{"-C", "/elsewhere", "events", "tail", "--follow"}, "--directory is not allowed here"},
		{[]string{"events", "tail", "--global"}, "--global is not allowed here"},
	}
	for _, inv := range bdflags.Inventories() {
		for _, c := range cases {
			res := resolveBdSplitCommand(inv, c.argv, "/scope")
			if res.refusal == "" {
				t.Errorf("%s: gc bd %s was forwarded (path %q)", inv.Name, strings.Join(c.argv, " "), res.path)
				continue
			}
			if !strings.Contains(res.refusal, c.want) {
				t.Errorf("%s: gc bd %s refusal = %q, want it to contain %q", inv.Name, strings.Join(c.argv, " "), res.refusal, c.want)
			}
			if !strings.Contains(res.refusal, "Nothing was written.") {
				t.Errorf("%s: gc bd %s refusal does not say nothing was written: %q", inv.Name, strings.Join(c.argv, " "), res.refusal)
			}
		}
	}
}

// eventsJournalHeadQuery reads the journal's head: the last seq bd assigned
// (beads issueops.nextEventSeq), which prune never lowers. bd 1.3.2 has no
// `events head` subcommand, so the head is read through the vetted `gc bd sql`
// read path.
const eventsJournalHeadQuery = "SELECT next_seq FROM bd_events_seq WHERE id = 0"

func TestGcBdSplitAdmitsEventsJournalHeadRead(t *testing.T) {
	argv := []string{"sql", "--json", eventsJournalHeadQuery}
	deps := bdClassGuardDeps{inventory: func() (*bdflags.Inventory, error) { return bdflags.InventoryByName("bd-1.3.2"), nil }}
	if g := bdClassFlipGuard(splitGuardTestCity(), t.TempDir(), argv, deps); g.refusal != "" || !slices.Equal(g.args, argv) {
		t.Fatalf("gc bd %q on a split city: refusal=%q args=%v", argv, g.refusal, g.args)
	}
	if msg, blind := bdSQLRelocatedClassRefusal(splitGuardTestCity(), argv); blind {
		t.Fatalf("gc bd %q was refused as a relocated-class read: %s", argv, msg)
	}
}

// TestGcBdSplitEventsTailRoutesByScope runs the journal follower and the head
// read through doBd on a split city with one rig: with --rig they reach the
// rig's bd scope, with no scope flag (and with --city) the city's, and bd gets
// the argv unchanged.
func TestGcBdSplitEventsTailRoutesByScope(t *testing.T) {
	_, cityDir := bdSQLRefusalCityDir(t, bdSQLRefusalSplitStorage+`
[[rigs]]
name = "devwork"
path = "devwork"
prefix = "dw"
`)
	setCwd(t, t.TempDir())
	rigDir := filepath.Join(cityDir, "devwork")
	if err := os.MkdirAll(filepath.Join(rigDir, ".beads"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rigDir, ".beads", "metadata.json"), []byte(`{"database":"dolt","backend":"dolt","dolt_mode":"embedded","dolt_database":"dw"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rigDir, ".beads", "config.yaml"), []byte("issue_prefix: dw\ndolt.auto-start: false\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	binDir := t.TempDir()
	capture := filepath.Join(t.TempDir(), "bd-scope.txt")
	stub := "#!/bin/sh\ncase \"$1\" in version) echo 'bd version 1.3.2 (test)'; exit 0 ;; esac\n" +
		"printf 'args=%s|BEADS_DIR=%s\\n' \"$*\" \"${BEADS_DIR:-}\" >> \"${SCOPE_CAPTURE}\"\nexit 0\n"
	if err := os.WriteFile(filepath.Join(binDir, "bd"), []byte(stub), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("SCOPE_CAPTURE", capture)
	t.Setenv("GC_RIG", "")

	cases := []struct {
		gcArgs   []string
		bdArgs   string
		beadsDir string
	}{
		{[]string{"--rig", "devwork", "events", "tail", "--follow", "--since", "5", "--json"}, "events tail --follow --since 5 --json", filepath.Join(rigDir, ".beads")},
		{[]string{"--rig", "devwork", "sql", "--json", eventsJournalHeadQuery}, "sql --json " + eventsJournalHeadQuery, filepath.Join(rigDir, ".beads")},
		{[]string{"events", "tail", "--follow", "--since", "0", "--json"}, "events tail --follow --since 0 --json", filepath.Join(cityDir, ".beads")},
		{[]string{"--city", cityDir, "events", "tail", "--since", "3", "--json"}, "events tail --since 3 --json", filepath.Join(cityDir, ".beads")},
		{[]string{"sql", "--json", eventsJournalHeadQuery}, "sql --json " + eventsJournalHeadQuery, filepath.Join(cityDir, ".beads")},
	}
	for _, c := range cases {
		if err := os.Remove(capture); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		var stdout, stderr bytes.Buffer
		if code := doBd(c.gcArgs, &stdout, &stderr); code != 0 {
			t.Fatalf("gc bd %s: exit %d; stderr=%q", strings.Join(c.gcArgs, " "), code, stderr.String())
		}
		data, err := os.ReadFile(capture)
		if err != nil {
			t.Fatalf("gc bd %s: bd was not run: %v", strings.Join(c.gcArgs, " "), err)
		}
		var line string
		for _, l := range strings.Split(strings.TrimSpace(string(data)), "\n") {
			if strings.HasPrefix(l, "args="+c.bdArgs+"|") {
				line = l
			}
		}
		if line == "" {
			t.Fatalf("gc bd %s: bd never got %q; it got %q", strings.Join(c.gcArgs, " "), c.bdArgs, string(data))
		}
		_, gotDir, _ := strings.Cut(line, "|BEADS_DIR=")
		if !samePath(gotDir, c.beadsDir) {
			t.Errorf("gc bd %s: BEADS_DIR = %q, want %q", strings.Join(c.gcArgs, " "), gotDir, c.beadsDir)
		}
	}
}
