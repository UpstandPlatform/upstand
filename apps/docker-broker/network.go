package main

import (
	"os"
	"strings"
)

const acceptanceUnencryptedNetworkEnvironment = `UPSTAND_ACCEPTANCE_ALLOW_UNENCRYPTED_NETWORK`

func allowUnencryptedNetworkForAcceptance() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv(acceptanceUnencryptedNetworkEnvironment)), `true`)
}

func networkEncryptionAllowed(options map[string]string, allowUnencrypted bool) bool {
	return allowUnencrypted || encryptedNetworkOption(options)
}

func encryptedNetworkOption(options map[string]string) bool {
	for key, value := range options {
		if strings.EqualFold(key, `encrypted`) && !strings.EqualFold(strings.TrimSpace(value), `false`) {
			return true
		}
	}
	return false
}
