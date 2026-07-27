package config

import "testing"

func TestRuntimeConfigIsValueSnapshot(t *testing.T) {
	t.Setenv("METRICS_CONFIG", `{"server":{"serverId":"local","serverType":"Upstand","token":"test-token","urlCallback":"http://server:3000/alerts","thresholds":{"cpu":90,"memory":80}}}`)

	initial := GetRuntimeConfig()
	if initial.CPUThreshold != 90 || initial.MemoryThreshold != 80 {
		t.Fatalf("unexpected initial thresholds: %+v", initial)
	}

	if err := UpdateThresholds(1, 2); err != nil {
		t.Fatalf("update thresholds: %v", err)
	}

	updated := GetRuntimeConfig()
	if updated.CPUThreshold != 1 || updated.MemoryThreshold != 2 {
		t.Fatalf("unexpected updated thresholds: %+v", updated)
	}
	if initial.CPUThreshold != 90 || initial.MemoryThreshold != 80 {
		t.Fatalf("initial snapshot changed after update: %+v", initial)
	}
}
