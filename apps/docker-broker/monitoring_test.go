package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTypedMonitoringContainerConfigIsBoundedAndHardened(t *testing.T) {
	input := typedMonitoringRequest{
		Operation:       "ensure",
		Image:           "ghcr.io/upstandplatform/upstand-monitoring@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		Token:           "monitoring-token",
		CPUThreshold:    90,
		MemoryThreshold: 80,
		NetworkName:     "upstand-docker-control",
		CallbackPort:    3000,
	}
	body, err := typedMonitoringContainerConfig(input)
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Image      string                    `json:"Image"`
		Env        []string                  `json:"Env"`
		Labels     map[string]string         `json:"Labels"`
		HostConfig typedMonitoringHostConfig `json:"HostConfig"`
	}
	if err := json.Unmarshal(body, &config); err != nil {
		t.Fatal(err)
	}
	if config.Image != input.Image || config.Labels["com.upstand.component"] != "monitoring-agent" || config.Labels["com.upstand.platform"] != "true" {
		t.Fatalf("unexpected monitoring identity: %#v", config)
	}
	if config.HostConfig.NetworkMode != input.NetworkName || !config.HostConfig.ReadonlyRootfs || config.HostConfig.Memory != 256*1024*1024 || config.HostConfig.PidsLimit == nil || *config.HostConfig.PidsLimit != 128 {
		t.Fatalf("unexpected monitoring hardening: %#v", config.HostConfig)
	}
	if len(config.HostConfig.Binds) != 4 || config.HostConfig.Binds[0] != "/proc:/host/proc:ro" || config.HostConfig.Binds[1] != "/sys:/host/sys:ro" || config.HostConfig.Binds[2] != "/etc/os-release:/etc/os-release:ro" || config.HostConfig.Binds[3] != "upstand-monitoring-data:/data" {
		t.Fatalf("unexpected monitoring mounts: %#v", config.HostConfig.Binds)
	}
	if !strings.Contains(config.Env[0], `"token":"monitoring-token"`) || !strings.Contains(config.Env[0], "http://server:3000/api/monitoring/alerts") {
		t.Fatalf("monitoring metrics configuration is incomplete: %#v", config.Env)
	}
}

func TestValidateTypedMonitoringRequestRejectsUnsafeValues(t *testing.T) {
	valid := `{"operation":"ensure","image":"ghcr.io/upstandplatform/upstand-monitoring@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","token":"monitoring-token","cpu_threshold":90,"memory_threshold":90,"network_name":"upstand-docker-control","callback_port":3000}`
	if _, err := validateTypedMonitoringRequest([]byte(valid)); err != nil {
		t.Fatalf("expected valid monitoring request: %v", err)
	}
	for _, body := range []string{
		strings.Replace(valid, `"callback_port":3000`, `"callback_port":0`, 1),
		strings.Replace(valid, `"cpu_threshold":90`, `"cpu_threshold":101`, 1),
		strings.Replace(valid, `"token":"monitoring-token"`, `"token":"bad\nvalue"`, 1),
	} {
		if _, err := validateTypedMonitoringRequest([]byte(body)); err == nil {
			t.Fatalf("expected unsafe monitoring request to be rejected: %s", body)
		}
	}
}

func TestMonitoringNetworkEncryptionRequiresExplicitAcceptanceOptIn(t *testing.T) {
	if monitoringNetworkEncryptionAllowed(map[string]string{}, false) {
		t.Fatal("expected an unencrypted network to be rejected by default")
	}
	if !monitoringNetworkEncryptionAllowed(map[string]string{}, true) {
		t.Fatal("expected the explicit acceptance opt-in to allow the hosted network")
	}
	if !monitoringNetworkEncryptionAllowed(map[string]string{"encrypted": "true"}, false) {
		t.Fatal("expected an encrypted network to be accepted")
	}
}
