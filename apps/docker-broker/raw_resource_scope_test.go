package main

import (
	"context"
	"net/http"
	"net/http/httptest"
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
