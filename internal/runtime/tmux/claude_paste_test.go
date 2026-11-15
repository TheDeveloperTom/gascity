package tmux

import (
	"context"
	"strings"
	"testing"
	"time"
)

// claudeLiteralCalls sends text to a pane whose GC_PROVIDER is provider and
// returns the tmux commands the send ran after the provider lookup.
func claudeLiteralCalls(t *testing.T, provider, text string) [][]string {
	t.Helper()
	fe := &fakeExecutor{outs: []string{"GC_PROVIDER=" + provider}}
	tm := NewTmuxWithConfig(DefaultConfig())
	tm.exec = fe
	if err := tm.sendKeysLiteralWithRetry(context.Background(), "%1", text, time.Second); err != nil {
		t.Fatalf("sendKeysLiteralWithRetry() = %v, want nil", err)
	}
	var sent [][]string
	for _, call := range fe.calls {
		joined := "\x00" + strings.Join(call, "\x00") + "\x00"
		if strings.Contains(joined, "\x00show-environment\x00") {
			continue
		}
		sent = append(sent, call)
	}
	return sent
}

func assertBracketedPaste(t *testing.T, calls [][]string) {
	t.Helper()
	if len(calls) != 2 {
		t.Fatalf("tmux calls = %#v, want load-buffer then paste-buffer", calls)
	}
	hasArg := func(call []string, arg string) bool {
		return strings.Contains("\x00"+strings.Join(call, "\x00")+"\x00", "\x00"+arg+"\x00")
	}
	if !hasArg(calls[0], "load-buffer") || !hasArg(calls[1], "paste-buffer") {
		t.Fatalf("tmux calls = %#v, want load-buffer then paste-buffer", calls)
	}
	if !hasArg(calls[1], "-p") {
		t.Fatalf("paste-buffer call = %v, want a bracketed paste (-p)", calls[1])
	}
}

func assertTyped(t *testing.T, calls [][]string) {
	t.Helper()
	if len(calls) != 1 {
		t.Fatalf("tmux calls = %#v, want one literal send-keys", calls)
	}
	joined := strings.Join(calls[0], " ")
	if !strings.Contains(joined, "send-keys") || !strings.Contains(joined, "-l") {
		t.Fatalf("call = %v, want literal send-keys", calls[0])
	}
}

// discordEnvelope is shaped like the Discord pack's human-message envelope
// the Mayor lost the head of (2026-11-15, 13:45Z): 26 lines, about 1.3 KB.
func discordEnvelope() string {
	lines := []string{"<discord-event>", "version: 1", "kind: discord_human_message"}
	for len(strings.Join(lines, "\n")) < 1250 {
		lines = append(lines, "field: "+strings.Repeat("v", 40))
	}
	lines = append(lines, "reply_tool: gc discord reply-current --conversation-id 1 --reply-to 2 --body-file <path>", "</discord-event>")
	return strings.Join(lines, "\n")
}

// TestClaudeMultilineMessageArrivesAsOnePaste is the live defect (Mayor,
// 2026-11-15): typed with send-keys -l, a 1.3 KB envelope reaches Claude Code
// as several terminal reads; Claude reads each as its own unbracketed paste
// and keeps only the last, so the Mayor's prompt began mid reply_tool line.
// A bracketed paste reaches it whole.
func TestClaudeMultilineMessageArrivesAsOnePaste(t *testing.T) {
	assertBracketedPaste(t, claudeLiteralCalls(t, "claude", discordEnvelope()))
}

// TestClaudeShortMultilineMessageArrivesAsOnePaste: Claude Code collapses a
// typed multi-line burst into a paste anyway, so even a short one goes as a
// bracketed paste and never depends on how the terminal splits it.
func TestClaudeShortMultilineMessageArrivesAsOnePaste(t *testing.T) {
	assertBracketedPaste(t, claudeLiteralCalls(t, "claude", "<discord-event>\nversion: 1\n</discord-event>"))
}

// TestClaudeLongSingleLineMessageArrivesAsOnePaste: a 2.5 KB line typed into
// Claude Code kept only its last ~1 KB too, so length alone routes to paste.
func TestClaudeLongSingleLineMessageArrivesAsOnePaste(t *testing.T) {
	assertBracketedPaste(t, claudeLiteralCalls(t, "claude", strings.Repeat("0123456789", 250)))
}

// TestClaudeShortSingleLineMessageIsStillTyped: one short line fits in one
// terminal read, so it is still typed.
func TestClaudeShortSingleLineMessageIsStillTyped(t *testing.T) {
	assertTyped(t, claudeLiteralCalls(t, "claude", "status update"))
}

// TestOtherProviderShortMultilineMessageIsStillTyped: the paste routing is
// Claude's and Codex's; other providers keep typed delivery.
func TestOtherProviderShortMultilineMessageIsStillTyped(t *testing.T) {
	assertTyped(t, claudeLiteralCalls(t, "gemini", "line one\nline two"))
}
