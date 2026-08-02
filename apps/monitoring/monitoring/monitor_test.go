package monitoring

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func resetHealthStateForTest() {
	healthState.Lock()
	defer healthState.Unlock()
	healthState.lastCollectedAt = ""
	healthState.lastCollected = time.Time{}
	healthState.collectionError = ""
	healthState.staleAfter = 2 * time.Minute
}

func TestHealthReportsStartingBeforeCollection(t *testing.T) {
	resetHealthStateForTest()
	t.Cleanup(resetHealthStateForTest)

	status, lastCollectedAt, healthError := Health()
	if status != "starting" || lastCollectedAt != "" || healthError == "" {
		t.Fatalf("unexpected starting health: %q %q %q", status, lastCollectedAt, healthError)
	}
}

func TestHealthReportsStaleCollection(t *testing.T) {
	resetHealthStateForTest()
	t.Cleanup(resetHealthStateForTest)
	healthState.Lock()
	healthState.lastCollected = time.Now().Add(-time.Hour)
	healthState.lastCollectedAt = healthState.lastCollected.UTC().Format(time.RFC3339Nano)
	healthState.collectionError = ""
	healthState.staleAfter = time.Second
	healthState.Unlock()

	status, _, healthError := Health()
	if status != "degraded" || healthError != "collection is stale" {
		t.Fatalf("unexpected stale health: %q %q", status, healthError)
	}
}

func TestSendAlertUsesBoundedHTTPClientAndJSON(t *testing.T) {
	previousClient := alertHTTPClient
	t.Cleanup(func() { alertHTTPClient = previousClient })
	alertHTTPClient = &http.Client{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("content type = %q, want application/json", got)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	err := sendAlert(server.URL, AlertPayload{ServerID: "server-1", Type: "CPU"})
	if err != nil {
		t.Fatalf("sendAlert returned error: %v", err)
	}
}

func TestSendAlertDoesNotReturnUpstreamBody(t *testing.T) {
	previousClient := alertHTTPClient
	t.Cleanup(func() { alertHTTPClient = previousClient })
	alertHTTPClient = &http.Client{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("sensitive upstream response"))
	}))
	t.Cleanup(server.Close)

	err := sendAlert(server.URL, AlertPayload{ServerID: "server-1", Type: "Memory"})
	if err == nil {
		t.Fatal("sendAlert returned nil for non-200 response")
	}
	if got := err.Error(); got != "received non-OK response status: 502 Bad Gateway" {
		t.Fatalf("unexpected error: %s", got)
	}
}

func TestHealthDoesNotExposeCollectionErrorDetails(t *testing.T) {
	t.Cleanup(func() { RecordCollection(nil) })
	RecordCollection(fmt.Errorf("database password=secret host=internal-db"))

	status, _, healthError := Health()
	if status != "degraded" {
		t.Fatalf("status = %q, want degraded", status)
	}
	if healthError != "collection failed" {
		t.Fatalf("health error = %q, want generic message", healthError)
	}
}
