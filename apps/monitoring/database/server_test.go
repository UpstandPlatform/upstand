package database

import (
	"testing"
)

func TestParseTimestampSupportsSQLiteText(t *testing.T) {
	for _, input := range []string{
		"2026-07-27T09:00:00.123456789Z",
		"2026-07-27 09:00:00.123456789Z",
		"2026-07-27 09:00:00.123456789",
	} {
		got, err := parseTimestamp(input)
		if err != nil {
			t.Fatalf("parseTimestamp(%q): %v", input, err)
		}
		if got.IsZero() || got.Location() == nil {
			t.Fatalf("parseTimestamp(%q) returned invalid time %v", input, got)
		}
	}
}

func TestParseTimestampRejectsUnsupportedValue(t *testing.T) {
	if _, err := parseTimestamp(42); err == nil {
		t.Fatal("expected unsupported timestamp type to fail")
	}
	if _, err := parseTimestamp("not-a-timestamp"); err == nil {
		t.Fatal("expected malformed timestamp to fail")
	}
}
