package main

import "testing"

func TestNetworkEncryptionRequiresExplicitAcceptanceOptIn(t *testing.T) {
	for name, options := range map[string]map[string]string{
		"missing option":        {},
		"explicitly disabled":   {"encrypted": "false"},
		"unrelated option only": {"com.example.option": "value"},
	} {
		t.Run(name, func(t *testing.T) {
			if networkEncryptionAllowed(options, false) {
				t.Fatal("expected an unencrypted network to be rejected by default")
			}
		})
	}

	for name, options := range map[string]map[string]string{
		"empty encrypted option": {"encrypted": ""},
		"true encrypted option":  {"ENCRYPTED": "true"},
	} {
		t.Run(name, func(t *testing.T) {
			if !networkEncryptionAllowed(options, false) {
				t.Fatal("expected an encrypted network to be accepted")
			}
		})
	}

	if !networkEncryptionAllowed(map[string]string{}, true) {
		t.Fatal("expected the explicit acceptance opt-in to allow the hosted network")
	}
}

func TestAcceptanceUnencryptedNetworkRequiresExactTrueValue(t *testing.T) {
	for _, value := range []string{"", "false", "1", " yes ", "TRUE-ish"} {
		t.Setenv(acceptanceUnencryptedNetworkEnvironment, value)
		if allowUnencryptedNetworkForAcceptance() {
			t.Fatalf("expected %q to keep the acceptance override disabled", value)
		}
	}

	t.Setenv(acceptanceUnencryptedNetworkEnvironment, " true ")
	if !allowUnencryptedNetworkForAcceptance() {
		t.Fatal("expected an explicitly enabled acceptance override")
	}
}
