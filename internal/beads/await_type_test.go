package beads

import (
	"encoding/json"
	"strings"
	"testing"

	beadslib "github.com/steveyegge/beads"
)

// A gate bd created (`bd gate create --type=human`) carries its type only in
// bd's await_type column, not in gc.gate_type metadata. The API serializes beads.Bead, so a mapping that
// drops await_type hides every such human gate from the dashboard.

func TestBdIssueToBeadCarriesAwaitType(t *testing.T) {
	var issue bdIssue
	raw := `{"id":"gc-gate","title":"approve?","status":"open","issue_type":"gate","await_type":"human"}`
	if err := json.Unmarshal([]byte(raw), &issue); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	if got := issue.toBead().AwaitType; got != "human" {
		t.Fatalf("toBead().AwaitType = %q, want %q", got, "human")
	}

	var plain bdIssue
	if err := json.Unmarshal([]byte(`{"id":"dw-1","issue_type":"task"}`), &plain); err != nil {
		t.Fatal(err)
	}
	if got := plain.toBead().AwaitType; got != "" {
		t.Fatalf("toBead().AwaitType (absent) = %q, want empty", got)
	}
}

func TestBeadFromNativeIssueCarriesAwaitType(t *testing.T) {
	bead, err := beadFromNativeIssue(&beadslib.Issue{
		ID:        "gc-gate",
		Title:     "approve?",
		Status:    beadslib.StatusOpen,
		IssueType: beadslib.IssueType("gate"),
		AwaitType: "human",
	})
	if err != nil {
		t.Fatalf("beadFromNativeIssue: %v", err)
	}
	if bead.AwaitType != "human" {
		t.Fatalf("AwaitType = %q, want %q", bead.AwaitType, "human")
	}
}

func TestBeadWireCarriesAwaitTypeOnlyWhenSet(t *testing.T) {
	gate, err := json.Marshal(Bead{ID: "gc-gate", Type: "gate", AwaitType: "human"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(gate), `"await_type":"human"`) {
		t.Fatalf("gate wire = %s, want await_type", gate)
	}
	var back Bead
	if err := json.Unmarshal(gate, &back); err != nil || back.AwaitType != "human" {
		t.Fatalf("round trip AwaitType = %q (err %v), want human", back.AwaitType, err)
	}
	task, err := json.Marshal(Bead{ID: "dw-1", Type: "task"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(task), "await_type") {
		t.Fatalf("task wire = %s, want no await_type", task)
	}
}
