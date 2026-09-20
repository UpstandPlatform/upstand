package containers

import (
	"testing"
	"time"
)

func TestHealthyKeepsRecentSampleDuringTransientCollectionFailure(t *testing.T) {
	monitor := &ContainerMonitor{
		lastCollected:    time.Now().Add(-time.Second),
		collectionFailed: true,
		staleAfter:       time.Minute,
	}

	if !monitor.Healthy() {
		t.Fatal("recent successful collection should remain healthy during a transient failure")
	}
}

func TestHealthyFailsAfterSampleBecomesStale(t *testing.T) {
	monitor := &ContainerMonitor{
		lastCollected: time.Now().Add(-2 * time.Minute),
		staleAfter:    time.Minute,
	}

	if monitor.Healthy() {
		t.Fatal("stale collection should fail health")
	}
}
