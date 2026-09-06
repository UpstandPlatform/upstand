package containers

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/UpstandPlatform/upstand/apps/monitoring/database"
)

func snapshotFixture() map[string]any {
	samples := make([]map[string]any, 0, 2)
	for _, name := range []string{"web-api-1", "web-api-2"} {
		samples = append(samples, map[string]any{"containerId": name, "name": name, "cpuPercent": 12.5, "memoryUsageBytes": 2048, "memoryLimitBytes": 4096, "memoryPercent": 50, "networkRxBytes": 123, "networkTxBytes": 456, "blockReadBytes": 78, "blockWriteBytes": 90})
	}
	return map[string]any{"collectedAt": time.Now().UTC(), "containers": samples}
}

func TestControlPlaneCollectionPersistsEveryReplicaAndReportsRecovery(t *testing.T) {
	var failed atomic.Bool
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		timestamp := r.Header.Get("X-Upstand-Metrics-Timestamp")
		mac := hmac.New(sha256.New, []byte("test-metrics-key"))
		_, _ = mac.Write([]byte("GET|" + snapshotPath + "|" + timestamp))
		if r.Method != "GET" || r.URL.Path != snapshotPath || r.URL.RawQuery != "" || r.Header.Get("X-Upstand-Metrics-Signature") != hex.EncodeToString(mac.Sum(nil)) || strings.Contains(r.Header.Get("Authorization"), "test-metrics-key") {
			t.Error("invalid signed snapshot request")
			w.WriteHeader(401)
			return
		}
		if failed.Load() {
			w.WriteHeader(503)
			return
		}
		_ = json.NewEncoder(w).Encode(snapshotFixture())
	}))
	defer server.Close()
	t.Setenv("METRICS_CONFIG", `{"server":{"token":"test-metrics-key","urlCallback":"`+server.URL+`/api/monitoring/alerts?ignored=true","refreshRate":25},"containers":{"source":"control-plane","refreshRate":25}}`)
	t.Setenv("DB_PATH", filepath.Join(t.TempDir(), "metrics.db"))
	db, err := database.InitDB()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cm, err := NewContainerMonitor(db)
	if err != nil {
		t.Fatal(err)
	}
	if cm.Healthy() {
		t.Fatal("unstarted collection must not be healthy")
	}
	if err := cm.Start(); err != nil {
		t.Fatal(err)
	}
	defer cm.Stop()
	if !cm.Healthy() {
		t.Fatal("successful collection must be healthy")
	}
	samples, err := db.GetLastNContainerMetrics("", 10)
	if err != nil || len(samples) != 2 {
		t.Fatalf("replica metrics missing: count=%d error=%v", len(samples), err)
	}
	for _, sample := range samples {
		if sample.CPU != 12.5 || sample.Memory.Used != 2048 || sample.Memory.UsedUnit != "B" || sample.Network.Output != 456 || sample.BlockIO.Write != 90 {
			t.Fatalf("incorrect persisted telemetry: %+v", sample)
		}
	}
	failed.Store(true)
	cm.collectMetrics()
	if cm.Healthy() {
		t.Fatal("collection failure must degrade health")
	}
	samples, _ = db.GetLastNContainerMetrics("", 10)
	if len(samples) != 2 {
		t.Fatal("failed collection must not invent metrics")
	}
	failed.Store(false)
	cm.collectMetrics()
	if !cm.Healthy() || requests.Load() != 3 {
		t.Fatal("collection did not recover")
	}
	cm.mu.Lock()
	cm.lastCollected = time.Now().Add(-5 * time.Minute)
	cm.mu.Unlock()
	if cm.Healthy() {
		t.Fatal("stale collection must degrade health")
	}
}

func TestControlPlaneSnapshotRejectsUntrustedResponses(t *testing.T) {
	for _, scenario := range []string{"unauthorized", "redirect", "oversized", "invalid-json", "missing-containers", "stale", "negative"} {
		t.Run(scenario, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch scenario {
				case "unauthorized":
					w.WriteHeader(401)
				case "redirect":
					w.Header().Set("Location", "/unexpected")
					w.WriteHeader(302)
				case "oversized":
					_, _ = w.Write([]byte(strings.Repeat("x", snapshotBodyLimit+1)))
				case "invalid-json":
					_, _ = w.Write([]byte("not json"))
				case "missing-containers":
					_ = json.NewEncoder(w).Encode(map[string]any{"collectedAt": time.Now()})
				default:
					fixture := snapshotFixture()
					if scenario == "stale" {
						fixture["collectedAt"] = time.Now().Add(-2 * time.Minute)
					}
					if scenario == "negative" {
						fixture["containers"].([]map[string]any)[0]["cpuPercent"] = -1
					}
					_ = json.NewEncoder(w).Encode(fixture)
				}
			}))
			defer server.Close()
			if _, err := fetchControlPlaneMetrics(context.Background(), server.URL, "test-key"); err == nil {
				t.Fatal("invalid snapshot accepted")
			}
		})
	}
}
