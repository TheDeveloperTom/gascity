package workspacesvc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/beads"
	"github.com/gastownhall/gascity/internal/config"
	"github.com/gastownhall/gascity/internal/runtime"
)

// blockingInstance serves a long-lived request (an SSE stream) until release closes.
type blockingInstance struct {
	entered chan struct{}
	release chan struct{}
}

func (b *blockingInstance) Status() Status { return Status{ServiceName: "stream", State: "ready"} }

func (b *blockingInstance) HandleHTTP(_ http.ResponseWriter, _ *http.Request, _ string) bool {
	close(b.entered)
	<-b.release
	return true
}

func (b *blockingInstance) Tick(context.Context, time.Time) {}

func (b *blockingInstance) Close() error { return nil }

// A proxied request that stays open (an SSE stream through /svc/...) must not hold the
// manager lock: otherwise the next writer (Tick installing or restarting an instance)
// waits forever, and because sync.RWMutex blocks new readers behind a waiting writer,
// every later List/Get/route call hangs too. Seen live 16.11: GET /v0/city/<c>/services
// hung >120 s while a dashboard stream was open.
func TestManagerOpenStreamDoesNotBlockWritersOrList(t *testing.T) {
	rt := &testRuntime{
		cityPath: t.TempDir(),
		cityName: "test-city",
		cfg: &config.City{
			Services: []config.Service{{
				Name:     "stream",
				Workflow: config.ServiceWorkflowConfig{Contract: "missing.contract"},
			}},
		},
		sp:    runtime.NewFake(),
		store: beads.NewMemStore(),
	}
	mgr := NewManager(rt)
	if err := mgr.Reload(); err != nil {
		t.Fatalf("Reload: %v", err)
	}

	inst := &blockingInstance{entered: make(chan struct{}), release: make(chan struct{})}
	mgr.mu.Lock()
	mgr.entries["stream"].inst = inst
	mgr.mu.Unlock()
	defer close(inst.release)

	go func() {
		req := httptest.NewRequest(http.MethodGet, "/svc/stream/v1/stream", nil)
		mgr.AuthorizeAndServeHTTP("stream", httptest.NewRecorder(), req, nil)
	}()
	select {
	case <-inst.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("stream request never reached the instance")
	}

	done := make(chan struct{})
	go func() {
		mgr.mu.Lock() // a writer, as Tick/Restart/Reload take it
		mgr.mu.Unlock()
		_ = mgr.List()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("an open proxied stream blocks manager writers and List (lock held across HandleHTTP)")
	}
}
