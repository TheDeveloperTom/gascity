package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/gastownhall/gascity/internal/beadmeta"
	"github.com/gastownhall/gascity/internal/beads"
	"github.com/gastownhall/gascity/internal/beads/splittest"
	"github.com/gastownhall/gascity/internal/config"
	"github.com/gastownhall/gascity/internal/githubmonitor"
)

// The GitHub monitor's one call into molecule instantiation, held to the same
// class-routing invariant oneshot_class_routes_test.go holds `gc formula cook`
// to. It needs its own file because nothing else reaches this path: the one
// existing test of the monitor replaces attachGitHubPRRepairWorkflow with a
// stub, so the real function could route every repair workflow into the wrong
// ledger with the whole suite green.

// attachRepairWorkflowFixture stands up a city plus the work store the monitor
// itself would be holding, and — on the split arm — the class binding a
// graph-class molecule belongs in.
func attachRepairWorkflowFixture(t *testing.T, split bool) (string, beads.Store, beads.Store) {
	t.Helper()
	cityDir := oneShotCookCity(t)
	var graph beads.Store
	if split {
		graph = splittest.NewClassStore(t, config.BeadClassGraph)
		seedCLIStorageRoutes(t, cityDir, messagingSplitRoutes(graph))
	} else {
		seedCLIStorageRoutes(t, cityDir, nil)
	}
	work, err := openStoreAtForCity(cityDir, cityDir)
	if err != nil {
		t.Fatalf("open work store: %v", err)
	}
	t.Cleanup(func() { _ = work.Close("test cleanup") })
	return cityDir, graph, work
}

// attachRepairWorkflow drives defaultAttachGitHubPRRepairWorkflow the way the
// monitor does: a PR bead already on the work ledger, a workflow the monitor's
// config names, and the graph leg derived through the same cliGraphStore seam
// the command root uses (cmd_github.go's attachGitHubPRRepairWorkflow(store,
// cliGraphStore(store, cfg, cityPath), ...)) — handing in a store the caller
// would never produce would make the routing assertions the fixture's, not the
// monitor's.
func attachRepairWorkflow(t *testing.T, cityDir string, work beads.Store, workflow string) beads.Bead {
	t.Helper()
	parent, err := work.Create(beads.Bead{Title: "PR needs repair", Type: "task"})
	if err != nil {
		t.Fatalf("creating the PR bead: %v", err)
	}
	cfg := &config.City{FormulaLayers: config.FormulaLayers{City: []string{filepath.Join(cityDir, "formulas")}}}
	rig := config.Rig{Path: cityDir}
	monitor := config.GitHubPRMonitor{RepairWorkflow: workflow}
	result := githubmonitor.Result{Owner: "gastownhall", Repo: "gascity", Number: 42, HeadRefName: "fix/x"}
	if err := defaultAttachGitHubPRRepairWorkflow(work, cliGraphStore(work, cfg, cityDir), cfg, rig, monitor, parent, result); err != nil {
		t.Fatalf("attaching repair workflow %q: %v", workflow, err)
	}
	return parent
}

// wispRootIn returns the wisp root a repair workflow materialized into store,
// or nil. gc.kind=wisp is coordclass.Classify's first arm, which is what makes
// a root-only repair workflow graph class.
func wispRootIn(t *testing.T, store beads.Store) *beads.Bead {
	t.Helper()
	for _, b := range allBeads(t, store) {
		if b.Metadata[beadmeta.KindMetadataKey] == beadmeta.KindWisp {
			return &b
		}
	}
	return nil
}

// TestAttachGitHubPRRepairWorkflowWispLandsInGraphStoreOnSplitCity is the
// producer half. `gc github` opens one work store for the rig it watches and
// hands it to the attach; a repair workflow that compiles root-only carries
// gc.kind=wisp, so on a split city it belongs in the binding. Materialized
// through the work store instead, it is exactly the stranded-infrastructure-bead
// shape that refuses boot.
func TestAttachGitHubPRRepairWorkflowWispLandsInGraphStoreOnSplitCity(t *testing.T) {
	cityDir, graph, work := attachRepairWorkflowFixture(t, true)

	parent := attachRepairWorkflow(t, cityDir, work, "vapor-work")

	if wispRootIn(t, graph) == nil {
		t.Fatal("the repair workflow's wisp root is not resident in the graph binding; the monitor materialized it through the work store it was handed")
	}
	for _, b := range allBeads(t, work) {
		if b.ID == parent.ID {
			continue
		}
		if kind := b.Metadata[beadmeta.KindMetadataKey]; kind != "" {
			t.Errorf("work store holds repair-workflow bead %s (gc.kind=%q); on a split city boot refuses on it", b.ID, kind)
		}
	}
}

// TestAttachGitHubPRRepairWorkflowPouredMoleculeStaysOnTheWorkStore is the
// direction a blanket "route the monitor's molecules to the binding" fix would
// break: a POURED v1 repair workflow is work class end to end, and relocating it
// hides the repair steps from `gc hook` and every other work-scope reader.
func TestAttachGitHubPRRepairWorkflowPouredMoleculeStaysOnTheWorkStore(t *testing.T) {
	cityDir, graph, work := attachRepairWorkflowFixture(t, true)

	attachRepairWorkflow(t, cityDir, work, "legacy-work")

	if got := len(allBeads(t, graph)); got != 0 {
		t.Errorf("the graph binding holds %d bead(s) from a work-class repair workflow; its steps are now invisible to every work-scope reader", got)
	}
	if got := len(allBeads(t, work)); got < 2 {
		t.Errorf("the work store holds %d bead(s), want the PR bead plus the materialized molecule", got)
	}
}

// attachRepairVarsWorkflow writes a repair formula that declares base and
// implementation_target, attaches it through the real attach with the given
// monitor repair_vars, and returns the bead that carries the stamped
// gc.var.* inputs (the molecule root) plus every bead's title.
func attachRepairVarsWorkflow(t *testing.T, repairVars map[string]string) (map[string]string, []string) {
	t.Helper()
	cityDir, _, work := attachRepairWorkflowFixture(t, false)
	if err := os.WriteFile(filepath.Join(cityDir, "formulas", "pr-repair-vars.formula.toml"), []byte(`
formula = "pr-repair-vars"
version = 1

[vars.base]
default = "main"

[vars.implementation_target]
default = "formula-default-target"

[[steps]]
id = "repair"
title = "Repair PR {{pr}} into {{base}} as {{implementation_target}}"
`), 0o644); err != nil {
		t.Fatalf("write formula: %v", err)
	}
	parent, err := work.Create(beads.Bead{Title: "PR needs repair", Type: "task"})
	if err != nil {
		t.Fatalf("creating the PR bead: %v", err)
	}
	cfg := &config.City{FormulaLayers: config.FormulaLayers{City: []string{filepath.Join(cityDir, "formulas")}}}
	rig := config.Rig{Path: cityDir}
	monitor := config.GitHubPRMonitor{RepairWorkflow: "pr-repair-vars", RepairRoute: "partcl/polecat", RepairVars: repairVars}
	result := githubmonitor.Result{Owner: "gastownhall", Repo: "gascity", Number: 42, HeadRefName: "fix/x", BaseRefName: "integration/me/group"}
	if err := defaultAttachGitHubPRRepairWorkflow(work, cliGraphStore(work, cfg, cityDir), cfg, rig, monitor, parent, result); err != nil {
		t.Fatalf("attaching repair workflow: %v", err)
	}
	var rootVars map[string]string
	var titles []string
	for _, b := range allBeads(t, work) {
		titles = append(titles, b.Title)
		if b.Metadata[beadmeta.FormulaVarPrefix+"pr"] == "42" {
			rootVars = map[string]string{}
			for k, v := range b.Metadata {
				if strings.HasPrefix(k, beadmeta.FormulaVarPrefix) {
					rootVars[strings.TrimPrefix(k, beadmeta.FormulaVarPrefix)] = v
				}
			}
		}
	}
	if rootVars == nil {
		t.Fatalf("no bead carries gc.var.pr=42; titles = %v", titles)
	}
	return rootVars, titles
}

// TestAttachGitHubPRRepairWorkflowPassesRepairVars drives the real attach and
// formula instantiation: with repair_vars set, the PR's base ref and the
// monitor's repair route reach the formula as base and implementation_target.
func TestAttachGitHubPRRepairWorkflowPassesRepairVars(t *testing.T) {
	vars, titles := attachRepairVarsWorkflow(t, map[string]string{
		"base":                  "{{base}}",
		"implementation_target": "{{repair_route}}",
	})
	if vars["base"] != "integration/me/group" || vars["implementation_target"] != "partcl/polecat" {
		t.Fatalf("stamped vars = %v, want base=integration/me/group implementation_target=partcl/polecat", vars)
	}
	if !slices.Contains(titles, "Repair PR 42 into integration/me/group as partcl/polecat") {
		t.Fatalf("step titles = %v, want the PR base and repair route substituted", titles)
	}
}

// TestAttachGitHubPRRepairWorkflowWithoutRepairVarsKeepsFormulaDefaults is the
// default half: no repair_vars, so the formula's own defaults apply (the root
// stamps effective values, defaults included), exactly as before.
func TestAttachGitHubPRRepairWorkflowWithoutRepairVarsKeepsFormulaDefaults(t *testing.T) {
	vars, titles := attachRepairVarsWorkflow(t, nil)
	if vars["base"] != "main" || vars["implementation_target"] != "formula-default-target" {
		t.Fatalf("stamped vars = %v, want the formula defaults base=main implementation_target=formula-default-target", vars)
	}
	if !slices.Contains(titles, "Repair PR 42 into main as formula-default-target") {
		t.Fatalf("step titles = %v, want formula defaults", titles)
	}
}

// TestAttachGitHubPRRepairWorkflowStaysOnTheOneStoreOnSingleStoreCity is the
// compatibility half: a city that relocates nothing attaches into the one store
// it always used. Green before and after by design.
func TestAttachGitHubPRRepairWorkflowStaysOnTheOneStoreOnSingleStoreCity(t *testing.T) {
	cityDir, _, work := attachRepairWorkflowFixture(t, false)

	attachRepairWorkflow(t, cityDir, work, "vapor-work")

	if wispRootIn(t, work) == nil {
		t.Error("the repair workflow's wisp root is not in the one store a single-store city has")
	}
}
