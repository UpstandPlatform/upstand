package main

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestAuthorizeDockerRequestAllowsNormalContainerLifecycle(t *testing.T) {
	req, _ := http.NewRequest(http.MethodPost, "http://broker/v1.43/containers/create", nil)
	body := []byte(`{"Image":"alpine","HostConfig":{"ReadonlyRootfs":true}}`)
	if err := authorizeDockerRequest(req, body); err != nil {
		t.Fatalf("expected normal container request to be allowed: %v", err)
	}
}

func TestAuthorizeTypedResourceBuildRequiresScopedHeaders(t *testing.T) {
	request, err := http.NewRequest(http.MethodPost, "http://broker/upstand/v1/server/resource-build", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	request.Header.Set("X-Upstand-Image", "upstand-app-resource-1:latest")
	request.Header.Set("X-Upstand-Dockerfile", "Dockerfile")
	if err := authorizeTypedDockerRequest("deployment-worker", request, nil); err != nil {
		t.Fatalf("expected a scoped resource build to be allowed: %v", err)
	}

	request.Header.Set("X-Upstand-Build-Args", `{"SECRET":"must-not-be-forwarded"}`)
	if err := authorizeTypedDockerRequest("deployment-worker", request, nil); err == nil {
		t.Fatal("expected typed resource build arguments to be rejected")
	}
}

func TestAuthorizeTypedResourceServiceRegistryAuthIsBoundToUpsert(t *testing.T) {
	request, err := http.NewRequest(http.MethodPost, "http://broker/upstand/v1/server/resource-service", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set(
		"X-Upstand-Registry-Auth",
		base64.StdEncoding.EncodeToString([]byte(`{"username":"builder","password":"temporary"}`)),
	)
	upsert := []byte(`{"operation":"upsert","resource_id":"resource-1","service_name":"resource-1","spec":{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest"}}}}`)
	if err := authorizeTypedDockerRequest("deployment-worker", request, upsert); err != nil {
		t.Fatalf("expected registry-authenticated typed upsert to be allowed: %v", err)
	}

	network := []byte(`{"operation":"ensure_network","resource_id":"resource-1","service_name":"resource-1","network_id":"network-1"}`)
	if err := authorizeTypedDockerRequest("deployment-worker", request, network); err == nil {
		t.Fatal("expected registry authentication to be rejected for network attachment")
	}

	request.Header.Del("X-Upstand-Registry-Auth")
	remove := []byte(`{"operation":"remove","resource_id":"resource-1","service_name":"resource-1"}`)
	if err := authorizeTypedDockerRequest("deployment-worker", request, remove); err != nil {
		t.Fatalf("expected typed service removal to be allowed: %v", err)
	}

	request.Header.Set("X-Upstand-Registry-Auth", "not-base64")
	if err := authorizeTypedDockerRequest("deployment-worker", request, upsert); err == nil {
		t.Fatal("expected malformed registry authentication to be rejected")
	}
}

func TestAuthorizeTypedResourcePushRequiresBoundedRegistryAuth(t *testing.T) {
	request, err := http.NewRequest(
		http.MethodPost,
		"http://broker/upstand/v1/server/resource-push",
		strings.NewReader(`{"resource_id":"resource-1","image":"registry.example/app:latest"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"resource_id":"resource-1","image":"registry.example/app:latest"}`)
	request.Header.Set(
		"X-Upstand-Registry-Auth",
		base64.StdEncoding.EncodeToString([]byte(`{"username":"builder","password":"temporary"}`)),
	)
	if err := authorizeTypedDockerRequest("deployment-worker", request, body); err != nil {
		t.Fatalf("expected bounded registry-authenticated image push to be allowed: %v", err)
	}

	request.Header.Del("X-Upstand-Registry-Auth")
	if err := authorizeTypedDockerRequest("deployment-worker", request, body); err == nil {
		t.Fatal("expected an unauthenticated typed image push to be rejected")
	}

	request.Header.Set("X-Upstand-Registry-Auth", "not-base64")
	if err := authorizeTypedDockerRequest("deployment-worker", request, body); err == nil {
		t.Fatal("expected malformed image push registry auth to be rejected")
	}
}

func TestAuthorizeDockerRequestRejectsHostSocketAndPrivilegedContainers(t *testing.T) {
	for _, body := range []string{
		`{"HostConfig":{"Privileged":true}}`,
		`{"HostConfig":{"Binds":["/var/run/docker.sock:/var/run/docker.sock"]}}`,
		`{"HostConfig":{"NetworkMode":"host"}}`,
		`{"HostConfig":{"Devices":[{"PathOnHost":"/dev/kvm"}]}}`,
	} {
		req, _ := http.NewRequest(http.MethodPost, "http://broker/v1.43/containers/create", strings.NewReader(body))
		if err := authorizeDockerRequest(req, []byte(body)); err == nil {
			t.Fatalf("expected host escape request to be rejected: %s", body)
		}
	}
}

func TestAuthorizeDockerRequestRejectsHostBackedVolumesAndWeakSecurityProfiles(t *testing.T) {
	for _, test := range []struct {
		path string
		body string
	}{
		{
			path: "/v1.43/volumes/create",
			body: `{"Name":"escape","Driver":"local","DriverOpts":{"type":"none","device":"/"}}`,
		},
		{
			path: "/v1.43/containers/create",
			body: `{"Image":"alpine","HostConfig":{"Runtime":"runc-custom"}}`,
		},
		{
			path: "/v1.43/containers/create",
			body: `{"Image":"alpine","HostConfig":{"SecurityOpt":["seccomp=unconfined"]}}`,
		},
	} {
		req, _ := http.NewRequest(http.MethodPost, "http://broker"+test.path, strings.NewReader(test.body))
		if err := authorizeDockerRequest(req, []byte(test.body)); err == nil {
			t.Fatalf("expected %s to be rejected", test.path)
		}
	}
}

func TestAuthorizeDockerRequestRejectsNonTelemetryAbsoluteBinds(t *testing.T) {
	for _, source := range []string{"/home/upstand:/workspace", "/opt/data:/data", "/tmp/cache:/cache:ro"} {
		body := `{"Image":"alpine","HostConfig":{"Binds":["` + source + `"]}}`
		req, _ := http.NewRequest(http.MethodPost, "http://broker/v1.43/containers/create", strings.NewReader(body))
		if err := authorizeDockerRequest(req, []byte(body)); err == nil {
			t.Fatalf("expected non-telemetry absolute bind to be rejected: %s", source)
		}
	}
}

func TestAuthorizeDockerRequestAllowsEmptyVolumeDriverOptions(t *testing.T) {
	req, _ := http.NewRequest(http.MethodPost, "http://broker/v1.43/volumes/create", strings.NewReader(`{"Name":"managed","Driver":"local","DriverOpts":{}}`))
	if err := authorizeDockerRequest(req, []byte(`{"Name":"managed","Driver":"local","DriverOpts":{}}`)); err != nil {
		t.Fatalf("expected an empty driver-options object to remain valid: %v", err)
	}
}

func TestAuthorizeDockerRequestRejectsPluginBackedDrivers(t *testing.T) {
	for _, test := range []struct {
		path string
		body string
	}{
		{
			path: "/v1.43/volumes/create",
			body: `{"Name":"escape","Driver":"local-persist"}`,
		},
		{
			path: "/v1.43/networks/create",
			body: `{"Name":"escape","Driver":"macvlan"}`,
		},
	} {
		req, _ := http.NewRequest(http.MethodPost, "http://broker"+test.path, strings.NewReader(test.body))
		if err := authorizeDockerRequest(req, []byte(test.body)); err == nil {
			t.Fatalf("expected plugin-backed driver to be rejected: %s", test.body)
		}
	}

	for _, test := range []struct {
		path string
		body string
	}{
		{
			path: "/v1.43/volumes/create",
			body: `{"Name":"managed","Driver":"local"}`,
		},
		{
			path: "/v1.43/networks/create",
			body: `{"Name":"managed","Driver":"overlay"}`,
		},
	} {
		req, _ := http.NewRequest(http.MethodPost, "http://broker"+test.path, strings.NewReader(test.body))
		if err := authorizeDockerRequest(req, []byte(test.body)); err != nil {
			t.Fatalf("expected built-in driver to remain valid: %s: %v", test.body, err)
		}
	}
}

func TestAuthorizeDockerRequestRequiresReadOnlyTelemetryBinds(t *testing.T) {
	for _, body := range []string{
		`{"HostConfig":{"Binds":["/proc:/host/proc"]}}`,
		`{"HostConfig":{"Binds":["/sys:/host/sys:rw"]}}`,
		`{"HostConfig":{"Mounts":[{"Type":"bind","Source":"/proc","Target":"/host/proc","ReadOnly":false}]}}`,
	} {
		req, _ := http.NewRequest(http.MethodPost, "http://broker/v1.43/containers/create", strings.NewReader(body))
		if err := authorizeDockerRequest(req, []byte(body)); err == nil {
			t.Fatalf("expected writable telemetry bind to be rejected: %s", body)
		}
	}

	for _, body := range []string{
		`{"HostConfig":{"Binds":["/proc:/host/proc:ro"]}}`,
		`{"HostConfig":{"Mounts":[{"Type":"bind","Source":"/sys","Target":"/host/sys","ReadOnly":true}]}}`,
	} {
		req, _ := http.NewRequest(http.MethodPost, "http://broker/v1.43/containers/create", strings.NewReader(body))
		if err := authorizeDockerRequest(req, []byte(body)); err != nil {
			t.Fatalf("expected read-only telemetry bind to remain valid: %s: %v", body, err)
		}
	}
}

func TestAuthorizeDockerRequestRejectsDaemonExtensions(t *testing.T) {
	for _, path := range []string{"/v1.43/plugins", "/v1.43/auth", "/v1.43/session", "/v1.43/swarm", "/v1.43/events"} {
		req, _ := http.NewRequest(http.MethodGet, "http://broker"+path, nil)
		if err := authorizeDockerRequest(req, nil); err == nil {
			t.Fatalf("expected %s to be rejected", path)
		}
	}
}

func TestAuthorizeDockerRequestAllowsReviewedLifecycleOperations(t *testing.T) {
	for _, test := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/v1.43/version"},
		{http.MethodGet, "/v1.43/nodes"},
		{http.MethodGet, "/v1.43/system/df"},
		{http.MethodGet, "/v1.43/containers/abc/json"},
		{http.MethodPost, "/v1.43/containers/abc/start"},
		{http.MethodPut, "/v1.43/containers/abc/archive"},
		{http.MethodGet, "/v1.43/images/alpine/json"},
		{http.MethodPost, "/v1.43/images/create"},
		{http.MethodGet, "/v1.43/services/abc"},
		{http.MethodDelete, "/v1.43/services/abc"},
		{http.MethodGet, "/v1.43/exec/abc/json"},
		{http.MethodPost, "/v1.43/exec/abc/start"},
	} {
		req, _ := http.NewRequest(test.method, "http://broker"+test.path, nil)
		if err := authorizeDockerRequest(req, nil); err != nil {
			t.Fatalf("expected %s %s to be allowed: %v", test.method, test.path, err)
		}
	}
}

func TestAuthorizeDockerRequestAppliesCallerSpecificCapabilities(t *testing.T) {
	for _, test := range []struct {
		caller string
		method string
		path   string
		allow  bool
	}{
		{caller: "schedules", method: http.MethodPost, path: "/v1.43/services/create", allow: true},
		{caller: "schedules", method: http.MethodPost, path: "/v1.43/build", allow: false},
		{caller: "schedules", method: http.MethodPost, path: "/v1.43/containers/create", allow: false},
		{caller: "schedules", method: http.MethodPost, path: "/v1.43/images/create", allow: false},
		{caller: "deployment-worker", method: http.MethodPost, path: "/v1.43/build", allow: true},
		{caller: "deployment-worker", method: http.MethodPost, path: "/v1.43/images/prune", allow: false},
		{caller: "deployment-worker", method: http.MethodDelete, path: "/v1.43/images/sha256:abc", allow: false},
		{caller: "server", method: http.MethodPost, path: "/v1.43/containers/prune", allow: true},
	} {
		req, _ := http.NewRequest(test.method, "http://broker"+test.path, nil)
		err := authorizeDockerRequestForCaller(test.caller, req, nil)
		if test.allow && err != nil {
			t.Fatalf("expected %s %s %s to be allowed: %v", test.caller, test.method, test.path, err)
		}
		if !test.allow && err == nil {
			t.Fatalf("expected %s %s %s to be rejected", test.caller, test.method, test.path)
		}
	}
}

func TestAuthorizeTypedDockerRequestRequiresServerAndNarrowOperations(t *testing.T) {
	tests := []struct {
		name   string
		caller string
		method string
		path   string
		body   string
		allow  bool
	}{
		{
			name:   "managed service update",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/web-server/service-update",
			body:   `{"service_name":"upstand_server"}`,
			allow:  true,
		},
		{
			name:   "managed Redis flush",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/web-server/service-command",
			body:   `{"service_name":"upstand_redis","command":["redis-cli","--no-auth-warning","-a","secret","FLUSHALL"]}`,
			allow:  true,
		},
		{
			name:   "managed network inspection",
			caller: "server",
			method: http.MethodGet,
			path:   "/upstand/v1/web-server/network?name=upstand-network",
			allow:  true,
		},
		{
			name:   "typed Caddy provisioning",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/web-server/caddy",
			body:   `{"operation":"ensure","network_name":"upstand-network","caddyfile_base64":"c2l0ZQ==","environment":["UPSTAND_CADDYFILE_B64=c2l0ZQ=="],"ports":[{"protocol":"tcp","target_port":80,"published_port":80}]}`,
			allow:  true,
		},
		{
			name:   "typed Caddy configuration",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/web-server/caddy/configure",
			body:   `{"operation":"apply_configuration","caddyfile_base64":"c2l0ZQ==","certificates":[]}`,
			allow:  true,
		},
		{
			name:   "bounded server cleanup",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/cleanup",
			body:   `{"command":"images","preserve_rollback_images":true}`,
			allow:  true,
		},
		{
			name:   "digest-bound self-update",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/self-update",
			body:   `{"version":"v0.2.25","repository":"UpstandPlatform/upstand","images":{"server":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","schedules":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","web":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","fumadocs":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","monitoring":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}}`,
			allow:  true,
		},
		{
			name:   "mutable self-update image is rejected",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/self-update",
			body:   `{"version":"v0.2.25","repository":"UpstandPlatform/upstand","images":{"server":"latest","schedules":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","web":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","fumadocs":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","monitoring":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}}`,
			allow:  false,
		},
		{
			name:   "Swarm inventory operation",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/swarm",
			body:   `{"operation":"list_nodes"}`,
			allow:  true,
		},
		{
			name:   "Swarm node update is bounded",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/swarm",
			body:   `{"operation":"update_node","node_id":"abcdef123","version":4,"name":"worker-1","labels":{"com.upstand.role":"worker"},"role":"worker","availability":"active"}`,
			allow:  true,
		},
		{
			name:   "Swarm arbitrary field is rejected",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/swarm",
			body:   `{"operation":"list_nodes","node_id":"abcdef123"}`,
			allow:  false,
		},
		{
			name:   "Swarm network leaves managed namespace",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/swarm",
			body:   `{"operation":"ensure_network","network_name":"attacker-network"}`,
			allow:  false,
		},
		{
			name:   "typed inventory containers is bounded",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/inventory",
			body:   `{"operation":"containers","search":"upstand","state":"running"}`,
			allow:  true,
		},
		{
			name:   "typed inventory rejects arbitrary fields",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/inventory",
			body:   `{"operation":"containers","command":"sh -c id"}`,
			allow:  false,
		},
		{
			name:   "typed container control is bounded",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/inventory",
			body:   `{"operation":"control_container","container_id":"abc123","command":"restart"}`,
			allow:  true,
		},
		{
			name:   "typed stats requires a container",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/inventory",
			body:   `{"operation":"stats"}`,
			allow:  false,
		},
		{
			name:   "typed inventory is reserved for server",
			caller: "schedules",
			method: http.MethodPost,
			path:   "/upstand/v1/server/inventory",
			body:   `{"operation":"info"}`,
			allow:  false,
		},
		{
			name:   "resource file read is resource-scoped",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-files",
			body:   `{"operation":"read","resource_id":"resource-1","container_id":"abc123","mount_path":"/data","path":"/config.json"}`,
			allow:  true,
		},
		{
			name:   "resource file rejects traversal",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-files",
			body:   `{"operation":"read","resource_id":"resource-1","container_id":"abc123","mount_path":"/data","path":"/../etc/passwd"}`,
			allow:  false,
		},
		{
			name:   "resource file rejects arbitrary operation fields",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-files",
			body:   `{"operation":"list","resource_id":"resource-1","container_id":"abc123","mount_path":"/data","path":"/","command":"sh -c id"}`,
			allow:  false,
		},
		{
			name:   "resource file route is reserved for server",
			caller: "schedules",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-files",
			body:   `{"operation":"mounts","resource_id":"resource-1","container_id":"abc123"}`,
			allow:  false,
		},
		{
			name:   "resource command is bounded and resource-scoped",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-command",
			body:   `{"resource_id":"resource-1","container_id":"abc123","command":"printf ok","timeout_seconds":30}`,
			allow:  true,
		},
		{
			name:   "resource command rejects arbitrary fields",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-command",
			body:   `{"resource_id":"resource-1","container_id":"abc123","command":"printf ok","environment":{"X":"Y"}}`,
			allow:  false,
		},
		{
			name:   "deployment worker may use only the typed resource command",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-command",
			body:   `{"resource_id":"resource-1","service_name":"resource-1","command":"printf ok"}`,
			allow:  true,
		},
		{
			name:   "schedules may use only the bounded resource command",
			caller: "schedules",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-command",
			body:   `{"resource_id":"resource-1","container_id":"abc123","command":"printf ok"}`,
			allow:  true,
		},
		{
			name:   "deployment worker may inspect only typed resource convergence",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-convergence",
			body:   `{"resource_id":"resource-1","service_name":"resource-1"}`,
			allow:  true,
		},
		{
			name:   "deployment worker may mutate only an owned typed resource service",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-service",
			body:   `{"operation":"upsert","resource_id":"resource-1","service_name":"resource-1","spec":{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest"}}}}`,
			allow:  true,
		},
		{
			name:   "deployment worker may pull only through the typed resource route",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-pull",
			body:   `{"resource_id":"resource-1","image":"example/app:latest"}`,
			allow:  true,
		},
		{
			name:   "deployment worker may remove only an owned typed resource network",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-network",
			body:   `{"operation":"remove","resource_id":"resource-1","network_id":"upstand-resource-resource-1"}`,
			allow:  true,
		},
		{
			name:   "deployment worker may ensure a typed resource network",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-network",
			body:   `{"operation":"ensure","resource_id":"resource-1"}`,
			allow:  true,
		},
		{
			name:   "deployment worker may ensure a named typed resource network",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-network",
			body:   `{"operation":"ensure","resource_id":"resource-1","network_key":"private","project_name":"resource-1","compose_type":"stack","internal":true}`,
			allow:  true,
		},
		{
			name:   "typed resource network cannot select another resource network",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-network",
			body:   `{"operation":"ensure","resource_id":"resource-1","network_id":"upstand-resource-other-resource"}`,
			allow:  false,
		},
		{
			name:   "typed resource network rejects arbitrary fields",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-network",
			body:   `{"operation":"remove","resource_id":"resource-1","network_id":"upstand-resource-resource-1","name":"other"}`,
			allow:  false,
		},
		{
			name:   "deployment worker may remove only an owned typed resource volume",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-volume",
			body:   `{"operation":"remove","resource_id":"resource-1","volume_id":"upstand-db-data-resource-1"}`,
			allow:  true,
		},
		{
			name:   "deployment worker may ensure a named typed resource volume",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-volume",
			body:   `{"operation":"ensure","resource_id":"resource-1","volume_key":"data","project_name":"resource-1","compose_type":"compose"}`,
			allow:  true,
		},
		{
			name:   "typed resource volume rejects arbitrary fields",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-volume",
			body:   `{"operation":"remove","resource_id":"resource-1","volume_id":"upstand-db-data-resource-1","name":"other"}`,
			allow:  false,
		},
		{
			name:   "deployment worker may remove an owned typed Compose project",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-teardown",
			body:   `{"operation":"remove","resource_id":"resource-1","project_name":"resource-1","compose_type":"compose"}`,
			allow:  true,
		},
		{
			name:   "typed resource teardown rejects arbitrary fields",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-teardown",
			body:   `{"operation":"remove","resource_id":"resource-1","project_name":"resource-1","compose_type":"compose","force":true}`,
			allow:  false,
		},
		{
			name:   "typed resource service rejects host escape fields",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/resource-service",
			body:   `{"operation":"upsert","resource_id":"resource-1","service_name":"resource-1","spec":{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest","Privileged":true}}}}`,
			allow:  false,
		},
		{
			name:   "unknown cleanup command is rejected",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/server/cleanup",
			body:   `{"command":"system-shell"}`,
			allow:  false,
		},
		{
			name:   "deployment worker may ensure the shared network through typed Swarm",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/swarm",
			body:   `{"operation":"ensure_network","network_name":"upstand-network"}`,
			allow:  true,
		},
		{
			name:   "deployment worker cannot ensure another typed Swarm network",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/server/swarm",
			body:   `{"operation":"ensure_network","network_name":"upstand-other"}`,
			allow:  false,
		},
		{
			name:   "worker cannot use web maintenance",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/web-server/service-update",
			body:   `{"service_name":"upstand_server"}`,
			allow:  false,
		},
		{
			name:   "worker cannot provision Caddy",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/web-server/caddy",
			body:   `{"operation":"ensure","network_name":"upstand-network","caddyfile_base64":"c2l0ZQ==","environment":["UPSTAND_CADDYFILE_B64=c2l0ZQ=="],"ports":[{"protocol":"tcp","target_port":80,"published_port":80}]}`,
			allow:  false,
		},
		{
			name:   "worker cannot configure Caddy",
			caller: "deployment-worker",
			method: http.MethodPost,
			path:   "/upstand/v1/web-server/caddy/configure",
			body:   `{"operation":"apply_configuration","caddyfile_base64":"c2l0ZQ==","certificates":[]}`,
			allow:  false,
		},
		{
			name:   "arbitrary service is rejected",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/web-server/service-update",
			body:   `{"service_name":"attacker_service"}`,
			allow:  false,
		},
		{
			name:   "arbitrary Redis command is rejected",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/web-server/service-command",
			body:   `{"service_name":"upstand_redis","command":["sh","-c","id"]}`,
			allow:  false,
		},
		{
			name:   "oversized log tail is rejected",
			caller: "server",
			method: http.MethodPost,
			path:   "/upstand/v1/web-server/service-logs",
			body:   `{"service_name":"upstand_server","tail":1001}`,
			allow:  false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req, err := http.NewRequest(test.method, "http://broker"+test.path, strings.NewReader(test.body))
			if err != nil {
				t.Fatal(err)
			}
			err = authorizeTypedDockerRequest(test.caller, req, []byte(test.body))
			if test.allow && err != nil {
				t.Fatalf("expected typed operation to be allowed: %v", err)
			}
			if !test.allow && err == nil {
				t.Fatal("expected typed operation to be rejected")
			}
		})
	}
}

func TestProductionServerCannotUseRawBuildOrServiceMutation(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	for _, test := range []struct {
		path string
		body string
	}{
		{path: "/v1.43/build", body: ""},
		{path: "/v1.43/services/create", body: `{"Name":"resource-1"}`},
		{path: "/v1.43/services/service-1/update", body: `{"Name":"resource-1"}`},
	} {
		req, err := http.NewRequest(
			http.MethodPost,
			"http://broker"+test.path,
			strings.NewReader(test.body),
		)
		if err != nil {
			t.Fatal(err)
		}
		var body []byte
		if test.body != "" {
			body = []byte(test.body)
		}
		if err := authorizeDockerRequestForCaller("server", req, body); err == nil {
			t.Fatalf("expected production server raw operation to be rejected: %s", test.path)
		}
	}
	deleteRequest := httptest.NewRequest(http.MethodDelete, "http://broker/v1.43/services/service-1", nil)
	if err := authorizeDockerRequestForCaller("server", deleteRequest, nil); err == nil {
		t.Fatal("expected production server raw service deletion to be rejected")
	}
}

func TestProductionDeploymentWorkerBuildRequiresResourceScope(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")

	withoutScope := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/build", nil)
	if err := authorizeDockerRequestForCaller("deployment-worker", withoutScope, nil); err == nil {
		t.Fatal("expected an unscoped deployment-worker build to be rejected")
	}

	withScope := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/build", nil)
	withScope.Header.Set("X-Upstand-Resource-ID", "resource-1")
	withScope.URL.RawQuery = url.Values{
		"t":      []string{"upstand-app-resource-1:latest"},
		"labels": []string{`{"com.upstand.resource-id":"resource-1"}`},
	}.Encode()
	if err := authorizeDockerRequestForCaller("deployment-worker", withScope, nil); err != nil {
		t.Fatalf("expected a resource-scoped deployment-worker build to be allowed: %v", err)
	}

	withInvalidScope := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/build", nil)
	withInvalidScope.Header.Set("X-Upstand-Resource-ID", "../other-resource")
	if err := authorizeDockerRequestForCaller("deployment-worker", withInvalidScope, nil); err == nil {
		t.Fatal("expected an invalid deployment-worker resource scope to be rejected")
	}
}

func TestProductionDeploymentWorkerCannotUseRawImagePull(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	req := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/images/create?fromImage=example/app:latest", nil)
	req.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDockerRequestForCaller("deployment-worker", req, nil); err == nil {
		t.Fatal("expected deployment-worker raw image pull to be rejected")
	}
}

func TestProductionDeploymentWorkerBuildRejectsUnsafeQueryOptions(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	for _, test := range []struct {
		name  string
		query url.Values
	}{
		{name: "missing image", query: url.Values{"labels": []string{`{"com.upstand.resource-id":"resource-1"}`}}},
		{name: "missing ownership label", query: url.Values{"t": []string{"upstand-app-resource-1:latest"}}},
		{name: "mismatched ownership label", query: url.Values{"t": []string{"upstand-app-resource-1:latest"}, "labels": []string{`{"com.upstand.resource-id":"other-resource"}`}}},
		{name: "remote context", query: url.Values{"t": []string{"upstand-app-resource-1:latest"}, "labels": []string{`{"com.upstand.resource-id":"resource-1"}`}, "remote": []string{"https://example.invalid/context.tar"}}},
		{name: "output exporter", query: url.Values{"t": []string{"upstand-app-resource-1:latest"}, "labels": []string{`{"com.upstand.resource-id":"resource-1"}`}, "outputs": []string{"type=registry"}}},
		{name: "host network", query: url.Values{"t": []string{"upstand-app-resource-1:latest"}, "labels": []string{`{"com.upstand.resource-id":"resource-1"}`}, "networkmode": []string{"host"}}},
		{name: "sensitive build arg", query: url.Values{"t": []string{"upstand-app-resource-1:latest"}, "labels": []string{`{"com.upstand.resource-id":"resource-1"}`}, "buildargs": []string{`{"API_TOKEN":"redacted"}`}}},
		{name: "null build args", query: url.Values{"t": []string{"upstand-app-resource-1:latest"}, "labels": []string{`{"com.upstand.resource-id":"resource-1"}`}, "buildargs": []string{"null"}}},
		{name: "path traversal", query: url.Values{"t": []string{"upstand-app-resource-1:latest"}, "labels": []string{`{"com.upstand.resource-id":"resource-1"}`}, "dockerfile": []string{"../Dockerfile"}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/build?"+test.query.Encode(), nil)
			req.Header.Set("X-Upstand-Resource-ID", "resource-1")
			if err := authorizeDockerRequestForCaller("deployment-worker", req, nil); err == nil {
				t.Fatal("expected unsafe deployment-worker build query to be rejected")
			}
		})
	}
}

func TestProductionDeploymentWorkerServiceMutationRequiresResourceScope(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")

	for _, test := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/v1.43/services/create"},
		{method: http.MethodPost, path: "/v1.43/services/service-1/update"},
	} {
		withoutScope := httptest.NewRequest(test.method, "http://broker"+test.path, nil)
		if err := authorizeDockerRequestForCaller("deployment-worker", withoutScope, nil); err == nil {
			t.Fatalf("expected an unscoped deployment-worker service mutation to be rejected: %s", test.path)
		}

		withScope := httptest.NewRequest(test.method, "http://broker"+test.path, nil)
		withScope.Header.Set("X-Upstand-Resource-ID", "resource-1")
		body := []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"}}`)
		if err := authorizeDockerRequestForCaller("deployment-worker", withScope, body); err != nil {
			t.Fatalf("expected a resource-scoped deployment-worker service mutation to be allowed: %s: %v", test.path, err)
		}
	}

	withScope := httptest.NewRequest(http.MethodDelete, "http://broker/v1.43/services/service-1", nil)
	withScope.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDockerRequestForCaller("deployment-worker", withScope, nil); err == nil {
		t.Fatal("expected deployment-worker raw service deletion to remain denied")
	}
}

func TestProductionDeploymentWorkerResourceMutationsRequireMatchingOwnedLabel(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	for _, test := range []struct {
		path string
		body string
	}{
		{path: "/v1.43/containers/create", body: `{"Labels":{"com.upstand.resource-id":"other-resource"}}`},
		{path: "/v1.43/services/create", body: `{"Labels":{"com.upstand.resource-id":"other-resource"}}`},
		{path: "/v1.43/services/service-1/update", body: `{"Labels":{"com.upstand.resource-id":"other-resource"}}`},
	} {
		req := httptest.NewRequest(http.MethodPost, "http://broker"+test.path, strings.NewReader(test.body))
		req.Header.Set("X-Upstand-Resource-ID", "resource-1")
		if err := authorizeDockerRequestForCaller("deployment-worker", req, []byte(test.body)); err == nil {
			t.Fatalf("expected mismatched resource label to be rejected: %s", test.path)
		}
	}
}

func TestProductionDeploymentWorkerCannotMountAnotherResourceVolume(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")

	ownedService := `{"Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Mounts":[{"Type":"volume","Source":"upstand-db-data-resource-1","Target":"/data"}]}}}`
	ownedRequest := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/create", strings.NewReader(ownedService))
	ownedRequest.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDockerRequestForCaller("deployment-worker", ownedRequest, []byte(ownedService)); err != nil {
		t.Fatalf("expected the resource database volume to remain available: %v", err)
	}

	ownedComposeService := `{"Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Mounts":[{"Type":"volume","Source":"upstand-resource-resource-1-volume-data","Target":"/data"}]}}}`
	ownedComposeRequest := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/create", strings.NewReader(ownedComposeService))
	ownedComposeRequest.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDockerRequestForCaller("deployment-worker", ownedComposeRequest, []byte(ownedComposeService)); err != nil {
		t.Fatalf("expected the resource Compose volume to remain available: %v", err)
	}

	for _, body := range []string{
		`{"Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Mounts":[{"Type":"volume","Source":"upstand-db-data-resource-2","Target":"/data"}]}}}`,
		`{"Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Mounts":[{"Type":"bind","Source":"/var/lib/other-resource","Target":"/data"}]}}}`,
		`{"Labels":{"com.upstand.resource-id":"resource-1"},"HostConfig":{"Binds":["upstand-db-data-resource-2:/data"]}}`,
	} {
		request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/create", strings.NewReader(body))
		request.Header.Set("X-Upstand-Resource-ID", "resource-1")
		if err := authorizeDockerRequestForCaller("deployment-worker", request, []byte(body)); err == nil {
			t.Fatalf("expected a non-owned service volume to be rejected: %s", body)
		}
	}
}

func TestProductionDeploymentWorkerCannotUseRawNetworkDeletion(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	req := httptest.NewRequest(http.MethodDelete, "http://broker/v1.43/networks/network-1", nil)
	if err := authorizeDockerRequestForCaller("deployment-worker", req, nil); err == nil {
		t.Fatal("expected deployment-worker raw network deletion to remain denied")
	}
}

func TestProductionDeploymentWorkerCannotUseRawVolumeDeletion(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	req := httptest.NewRequest(http.MethodDelete, "http://broker/v1.43/volumes/volume-1", nil)
	if err := authorizeDockerRequestForCaller("deployment-worker", req, nil); err == nil {
		t.Fatal("expected deployment-worker raw volume deletion to remain denied")
	}
}

func TestProductionDeploymentWorkerResourceCreationRequiresResourceScope(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")

	for _, test := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/v1.43/containers/create"},
		{method: http.MethodPost, path: "/v1.43/networks/network-1/connect"},
	} {
		withoutScope := httptest.NewRequest(test.method, "http://broker"+test.path, nil)
		if err := authorizeDockerRequestForCaller("deployment-worker", withoutScope, nil); err == nil {
			t.Fatalf("expected an unscoped deployment-worker resource creation to be rejected: %s", test.path)
		}

		withScope := httptest.NewRequest(test.method, "http://broker"+test.path, nil)
		withScope.Header.Set("X-Upstand-Resource-ID", "resource-1")
		var body []byte
		if test.path == "/v1.43/containers/create" {
			body = []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"}}`)
		}
		if err := authorizeDockerRequestForCaller("deployment-worker", withScope, body); err != nil {
			t.Fatalf("expected a resource-scoped deployment-worker creation to be allowed: %s: %v", test.path, err)
		}
	}

	for _, path := range []string{"/v1.43/networks/create", "/v1.43/volumes/create"} {
		request := httptest.NewRequest(http.MethodPost, "http://broker"+path, strings.NewReader(`{"Labels":{"com.upstand.resource-id":"resource-1"}}`))
		request.Header.Set("X-Upstand-Resource-ID", "resource-1")
		if err := authorizeDockerRequestForCaller("deployment-worker", request, []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"}}`)); err == nil {
			t.Fatalf("expected raw deployment-worker resource creation to remain denied: %s", path)
		}
	}
}

func TestAuthorizeDockerRequestRejectsUnreviewedOperations(t *testing.T) {
	for _, test := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/v1.43/containers/abc/unreviewed"},
		{http.MethodPost, "/v1.43/containers/abc/commit"},
		{http.MethodGet, "/v1.43/images/abc/history"},
		{http.MethodPost, "/v1.43/swarm/join"},
		{http.MethodGet, "/v1.43/events"},
	} {
		req, _ := http.NewRequest(test.method, "http://broker"+test.path, nil)
		if err := authorizeDockerRequest(req, nil); err == nil {
			t.Fatalf("expected %s %s to be rejected", test.method, test.path)
		}
	}
}

func TestAuthorizeTypedResourceRollback(t *testing.T) {
	body := []byte(`{"resource_id":"resource-1","image":"upstand-app-resource-1:latest"}`)
	request := httptest.NewRequest(http.MethodPost, "http://broker/upstand/v1/server/resource-rollback", strings.NewReader(string(body)))
	if err := authorizeTypedDockerRequest("deployment-worker", request, body); err != nil {
		t.Fatalf("expected deployment-worker rollback to be allowed: %v", err)
	}
	for _, caller := range []string{"client", ""} {
		if err := authorizeTypedDockerRequest(caller, request, body); err == nil {
			t.Fatalf("expected caller %q to be rejected", caller)
		}
	}
	invalid := []byte(`{"resource_id":"resource-1","image":"upstand-app-resource-1:latest","extra":true}`)
	if err := authorizeTypedDockerRequest("deployment-worker", request, invalid); err == nil {
		t.Fatal("expected unknown rollback fields to be rejected")
	}
}

func TestUnsafeBindSourceAllowsManagedNamedVolumes(t *testing.T) {
	if unsafeBindSource("upstand-build:/workspace") {
		t.Fatal("named volumes must remain available")
	}
	if unsafeBindSource("/proc:/host/proc:ro") {
		t.Fatal("read-only proc telemetry must remain available")
	}
	if !unsafeBindSource("/var/run/docker.sock:/var/run/docker.sock:ro") {
		t.Fatal("the Docker socket must be rejected")
	}
	if !unsafeBindSource("/proc:/host/proc") {
		t.Fatal("a telemetry bind without read-only mode must be rejected")
	}
	if unsafeBindSource("/proc:/host/proc:ro") {
		t.Fatal("a read-only proc telemetry bind must remain available")
	}
}

func TestAuthorizeBrokerToken(t *testing.T) {
	const expected = "01234567890123456789012345678901"
	if err := authorizeBrokerToken("", expected); err == nil {
		t.Fatal("expected a missing broker token to be rejected")
	}
	if err := authorizeBrokerToken("wrong-token", expected); err == nil {
		t.Fatal("expected an incorrect broker token to be rejected")
	}
	if err := authorizeBrokerToken(expected, expected); err != nil {
		t.Fatalf("expected the configured broker token to be accepted: %v", err)
	}
	if err := authorizeBrokerToken(expected, ""); err != nil {
		t.Fatalf("expected development mode without a configured token to remain available: %v", err)
	}
}

func TestAuthorizeBrokerCredentialsBindsCallerToCredential(t *testing.T) {
	credentials := map[string]string{
		"server":    "server-token-012345678901234567890123",
		"schedules": "schedules-token-0123456789012345678901",
	}
	caller, err := authorizeBrokerCredentials(credentials["server"], credentials)
	if err != nil || caller != "server" {
		t.Fatalf("expected server credential to authenticate as server, caller=%q err=%v", caller, err)
	}
	caller, err = authorizeBrokerCredentials(credentials["schedules"], credentials)
	if err != nil || caller != "schedules" {
		t.Fatalf("expected schedules credential to authenticate as schedules, caller=%q err=%v", caller, err)
	}
	if _, err := authorizeBrokerCredentials(credentials["server"], map[string]string{"schedules": credentials["schedules"]}); err == nil {
		t.Fatal("expected a server credential to be rejected when only schedules is configured")
	}
}

func TestAuthorizeBrokerCredentialsRejectsMissingCredential(t *testing.T) {
	if _, err := authorizeBrokerCredentials("", map[string]string{"server": "server-token-012345678901234567890123"}); err == nil {
		t.Fatal("expected missing credential to be rejected")
	}
}

func TestAuthorizeBrokerCaller(t *testing.T) {
	allowed := map[string]struct{}{"server": {}, "schedules": {}}
	if err := authorizeBrokerCaller("server", allowed); err != nil {
		t.Fatalf("expected server caller to be accepted: %v", err)
	}
	if err := authorizeBrokerCaller("", allowed); err == nil {
		t.Fatal("expected missing caller identity to be rejected")
	}
	if err := authorizeBrokerCaller("web", allowed); err == nil {
		t.Fatal("expected unapproved caller identity to be rejected")
	}
	allowed["deployment-worker"] = struct{}{}
	if err := authorizeBrokerCaller("deployment-worker", allowed); err != nil {
		t.Fatalf("expected deployment worker caller to be accepted: %v", err)
	}
	if err := authorizeBrokerCaller("anything", nil); err != nil {
		t.Fatalf("expected development mode without a caller allowlist: %v", err)
	}
}

func TestValidateBrokerConfigurationRequiresExplicitProductionIdentity(t *testing.T) {
	callerCredentials := map[string]string{"server": "server-token"}
	callerAllowlist := map[string]struct{}{"server": {}}
	if err := validateBrokerConfiguration(callerCredentials, callerAllowlist, true); err != nil {
		t.Fatalf("expected caller-specific TLS configuration to be accepted: %v", err)
	}
	if err := validateBrokerConfiguration(
		map[string]string{"server": "same-token", "schedules": "same-token"},
		map[string]struct{}{"server": {}, "schedules": {}},
		true,
	); err == nil {
		t.Fatal("expected caller credentials to be unique when TLS identity is required")
	}
	if err := validateBrokerConfiguration(callerCredentials, map[string]struct{}{"schedules": {}}, true); err == nil {
		t.Fatal("expected an allowlisted caller without a token file to be rejected")
	}
	if err := validateBrokerConfiguration(callerCredentials, map[string]struct{}{"unknown": {}}, true); err == nil {
		t.Fatal("expected an unknown production caller to be rejected")
	}
	if err := validateBrokerConfiguration(map[string]string{"*": "legacy-token"}, callerAllowlist, true); err == nil {
		t.Fatal("expected legacy single-token mode to be rejected when TLS is required")
	}
	if err := validateBrokerConfiguration(callerCredentials, nil, true); err == nil {
		t.Fatal("expected an empty caller allowlist to be rejected when TLS is required")
	}
	if err := validateBrokerConfiguration(map[string]string{"*": "legacy-token"}, nil, false); err != nil {
		t.Fatalf("expected explicit development mode to retain compatibility: %v", err)
	}
}

func TestLoadMaxInflightRequestsIsBounded(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_MAX_INFLIGHT", "12")
	if got := loadMaxInflightRequests(); got != 12 {
		t.Fatalf("expected configured broker concurrency limit, got %d", got)
	}

	for _, value := range []string{"", "0", "257", "not-a-number"} {
		t.Setenv("UPSTAND_DOCKER_BROKER_MAX_INFLIGHT", value)
		if got := loadMaxInflightRequests(); got != defaultMaxInflight {
			t.Fatalf("expected invalid value %q to use the safe default, got %d", value, got)
		}
	}
}

func TestLoadBrokerTLSConfigRequiresCompleteProductionIdentity(t *testing.T) {
	for _, variable := range []string{
		"UPSTAND_DOCKER_BROKER_CA_FILE",
		"UPSTAND_DOCKER_BROKER_CERT_FILE",
		"UPSTAND_DOCKER_BROKER_KEY_FILE",
	} {
		t.Setenv(variable, "")
	}
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	if _, err := loadBrokerTLSConfig(); err == nil {
		t.Fatal("expected production broker TLS to require certificate files")
	}

	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "false")
	config, err := loadBrokerTLSConfig()
	if err != nil {
		t.Fatalf("development HTTP fallback should not require TLS files: %v", err)
	}
	if config != nil {
		t.Fatal("expected no TLS config when the broker identity is not configured")
	}
}

func TestAuthorizeBrokerClientCertificateRejectsUnverifiedConnections(t *testing.T) {
	request, _ := http.NewRequest(http.MethodGet, "https://broker/v1.43/version", nil)
	if _, err := authorizeBrokerClientCertificate(request); err == nil {
		t.Fatal("expected a verified client certificate to be required")
	}
}

func TestDockerOperationNameIsNormalizedToResourceOperations(t *testing.T) {
	tests := []struct {
		method string
		path   string
		want   string
	}{
		{http.MethodPost, "/v1.43/containers/create", "containers.create"},
		{http.MethodPost, "/v1.43/containers/abc/start", "containers.start"},
		{http.MethodGet, "/v1.43/images/json", "images.list"},
		{http.MethodGet, "/v1.43/exec/abc/json", "exec.json"},
		{http.MethodGet, "/v1.43/version", "daemon.version"},
		{http.MethodPost, "/v1.43/build", "build.create"},
	}
	for _, test := range tests {
		if got := dockerOperationName(test.method, normalizeDockerPath(test.path)); got != test.want {
			t.Fatalf("expected %s %s to be %q, got %q", test.method, test.path, test.want, got)
		}
	}
}
