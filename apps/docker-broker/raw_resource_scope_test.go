package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestDeploymentWorkerRawContainerMutationRequiresDaemonOwnership(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		if request.Method != http.MethodGet || request.URL.Path != "/containers/container-1/json" {
			return dockerResponse(http.StatusNotFound, `{}`)
		}
		return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`)
	})

	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/containers/container-1/start", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, engine); err != nil {
		t.Fatalf("expected an owned container mutation to be allowed: %v", err)
	}

	engine = rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, engine); err == nil {
		t.Fatal("expected a cross-resource container mutation to be rejected")
	}
}

func TestDeploymentWorkerRawServiceUpdateRequiresDaemonOwnership(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/service-1/update", strings.NewReader(`{"Labels":{"com.upstand.resource-id":"resource-1"}}`))
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	body := []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"}}`)
	owned := rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Spec":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, owned); err != nil {
		t.Fatalf("expected an owned service update to be allowed: %v", err)
	}

	foreign := rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Spec":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, foreign); err == nil {
		t.Fatal("expected a cross-resource service update to be rejected")
	}
}

func TestDeploymentWorkerRawExecRequiresOwningContainer(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/exec/exec-1/start", strings.NewReader(`{"Detach":false}`))
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	owned := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/exec/exec-1/json":
			return dockerResponse(http.StatusOK, `{"ContainerID":"container-1"}`)
		case "/containers/container-1/json":
			return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, owned); err != nil {
		t.Fatalf("expected an exec attached to an owned container to be allowed: %v", err)
	}

	foreign := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/exec/exec-1/json":
			return dockerResponse(http.StatusOK, `{"ContainerID":"container-1"}`)
		case "/containers/container-1/json":
			return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, foreign); err == nil {
		t.Fatal("expected an exec attached to a foreign container to be rejected")
	}
}

func TestDeploymentWorkerRawContainerReadsRequireDaemonOwnership(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/containers/container-1/logs", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	foreign := rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, foreign); err == nil {
		t.Fatal("expected a cross-resource container read to be rejected")
	}
}

func TestDeploymentWorkerRawContainerListingRequiresExactResourceFilter(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	for _, test := range []struct {
		name    string
		filters string
		valid   bool
	}{
		{name: "exact label", filters: `{"label":["com.docker.compose.project=app","com.upstand.resource-id=resource-1"]}`, valid: true},
		{name: "missing label", filters: `{"label":["com.docker.compose.project=app"]}`},
		{name: "foreign label", filters: `{"label":["com.upstand.resource-id=other-resource"]}`},
		{name: "malformed filters", filters: `{"label":[}`},
		{name: "wrong label shape", filters: `{"label":"com.upstand.resource-id=resource-1"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/containers/json?filters="+url.QueryEscape(test.filters), nil)
			request.Header.Set("X-Upstand-Resource-ID", "resource-1")
			err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, rawScopeTestEngine(func(*http.Request) *http.Response {
				t.Fatal("container list policy must fail before contacting Docker")
				return nil
			}))
			if test.valid && err != nil {
				t.Fatalf("expected an exact resource filter to be allowed: %v", err)
			}
			if !test.valid && err == nil {
				t.Fatal("expected an incomplete or foreign resource filter to be rejected")
			}
		})
	}
}

func TestDeploymentWorkerRawNetworkAttachmentRequiresOwnedNetworkAndContainer(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	body := []byte(`{"Container":"container-1"}`)
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/networks/network-1":
			return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"upstand-resource-resource-1-app","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`)
		case "/containers/container-1/json":
			return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/networks/network-1/connect", strings.NewReader(string(body)))
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, engine); err != nil {
		t.Fatalf("expected an owned network attachment to be allowed: %v", err)
	}

	foreignNetwork := rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"upstand-resource-other-resource-app","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"other-resource"}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, foreignNetwork); err == nil {
		t.Fatal("expected a cross-resource network attachment to be rejected")
	}
}

func TestDeploymentWorkerRawSharedNetworkStillRequiresEncryptedNetworkAndOwnedContainer(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	t.Setenv("UPSTAND_DOCKER_NETWORK", "shared-net")
	body := []byte(`{"Container":"container-1"}`)
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/networks/shared-net":
			return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"shared-net","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""}}`)
		case "/containers/container-1/json":
			return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/networks/shared-net/connect", strings.NewReader(string(body)))
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, engine); err != nil {
		t.Fatalf("expected the encrypted shared network to remain available: %v", err)
	}

	unencrypted := rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"shared-net","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, unencrypted); err == nil {
		t.Fatal("expected an unencrypted shared network to be rejected")
	}
}

func TestDeploymentWorkerRawNetworkAttachmentRequiresBoundedJSONIdentity(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/networks/network-1/connect", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		t.Fatal("invalid network attachment must fail before contacting Docker")
		return nil
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, engine); err == nil {
		t.Fatal("expected a missing network attachment body to be rejected")
	}
}

func rawScopeTestEngine(handler func(*http.Request) *http.Response) *dockerEngineClient {
	return &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			return handler(request), nil
		}),
	}}
}
