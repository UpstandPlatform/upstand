package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func deploymentScopeTestToken(t *testing.T, secret []byte, claims deploymentScopeClaims) string {
	t.Helper()
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	signedValue := "v1." + encodedPayload
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(signedValue))
	return signedValue + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func deploymentScopeTestRequest(body string) *http.Request {
	return httptest.NewRequest(
		http.MethodPost,
		"http://broker/upstand/v1/server/resource-service",
		strings.NewReader(body),
	)
}

func TestAuthorizeDeploymentWorkerScopeTokenRequiresValidResourceGrant(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	secret := []byte("deployment-scope-test-secret-012345678901234567890")
	now := time.Now()
	token := deploymentScopeTestToken(t, secret, deploymentScopeClaims{
		ResourceID:   "resource-1",
		DeploymentID: "deployment-1",
		ServerID:     "server-1",
		IssuedAt:     now.Add(-time.Minute).UnixMilli(),
		ExpiresAt:    now.Add(time.Hour).UnixMilli(),
		Nonce:        "nonce-1",
	})

	request := deploymentScopeTestRequest(`{"operation":"remove","resource_id":"resource-1"}`)
	request.Header.Set(deploymentScopeHeader, token)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	request.Header.Set(deploymentIDHeader, "deployment-1")
	request.Header.Set(serverIDHeader, "server-1")
	if err := authorizeDeploymentWorkerScopeToken("deployment-worker", request, []byte(`{"resource_id":"resource-1"}`), secret); err != nil {
		t.Fatalf("expected a matching signed grant to pass: %v", err)
	}

	request.Header.Set("X-Upstand-Resource-ID", "resource-2")
	if err := authorizeDeploymentWorkerScopeToken("deployment-worker", request, nil, secret); err == nil {
		t.Fatal("expected a cross-resource grant to be rejected")
	}
}

func TestAuthorizeDeploymentWorkerScopeTokenRejectsCrossTargetReplay(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	secret := []byte("deployment-scope-test-secret-012345678901234567890")
	now := time.Now()
	token := deploymentScopeTestToken(t, secret, deploymentScopeClaims{
		ResourceID:   "resource-1",
		DeploymentID: "deployment-1",
		ServerID:     "server-1",
		IssuedAt:     now.Add(-time.Minute).UnixMilli(),
		ExpiresAt:    now.Add(time.Hour).UnixMilli(),
		Nonce:        "nonce-1",
	})
	request := deploymentScopeTestRequest(`{"resource_id":"resource-1"}`)
	request.Header.Set(deploymentScopeHeader, token)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	request.Header.Set(deploymentIDHeader, "deployment-2")
	request.Header.Set(serverIDHeader, "server-1")
	if err := authorizeDeploymentWorkerScopeToken("deployment-worker", request, nil, secret); err == nil {
		t.Fatal("expected a cross-deployment replay to be rejected")
	}

	request.Header.Set(deploymentIDHeader, "deployment-1")
	request.Header.Set(serverIDHeader, "server-2")
	if err := authorizeDeploymentWorkerScopeToken("deployment-worker", request, nil, secret); err == nil {
		t.Fatal("expected a cross-server replay to be rejected")
	}
}

func TestAuthorizeDeploymentWorkerScopeTokenRejectsMissingExpiredAndTamperedGrants(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	secret := []byte("deployment-scope-test-secret-012345678901234567890")
	request := deploymentScopeTestRequest(`{"operation":"ensure_network"}`)

	if err := authorizeDeploymentWorkerScopeToken("deployment-worker", request, nil, secret); err == nil {
		t.Fatal("expected a missing grant to be rejected")
	}

	now := time.Now()
	expired := deploymentScopeTestToken(t, secret, deploymentScopeClaims{
		ResourceID:   "resource-1",
		DeploymentID: "deployment-1",
		ServerID:     "server-1",
		IssuedAt:     now.Add(-2 * time.Hour).UnixMilli(),
		ExpiresAt:    now.Add(-time.Hour).UnixMilli(),
		Nonce:        "nonce-1",
	})
	request.Header.Set(deploymentScopeHeader, expired)
	if err := authorizeDeploymentWorkerScopeToken("deployment-worker", request, nil, secret); err == nil {
		t.Fatal("expected an expired grant to be rejected")
	}

	valid := deploymentScopeTestToken(t, secret, deploymentScopeClaims{
		ResourceID:   "resource-1",
		DeploymentID: "deployment-1",
		ServerID:     "server-1",
		IssuedAt:     now.Add(-time.Minute).UnixMilli(),
		ExpiresAt:    now.Add(time.Hour).UnixMilli(),
		Nonce:        "nonce-1",
	})
	tamperedSuffix := byte('A')
	if valid[len(valid)-1] == tamperedSuffix {
		tamperedSuffix = 'B'
	}
	request.Header.Set(deploymentScopeHeader, valid[:len(valid)-1]+string(tamperedSuffix))
	if err := authorizeDeploymentWorkerScopeToken("deployment-worker", request, nil, secret); err == nil {
		t.Fatal("expected a tampered grant to be rejected")
	}
}

func TestAuthorizeDeploymentWorkerScopeTokenDoesNotConstrainNonWorkerCallers(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := deploymentScopeTestRequest(`{"operation":"ensure_network"}`)
	if err := authorizeDeploymentWorkerScopeToken("schedules", request, nil, nil); err != nil {
		t.Fatalf("expected non-worker callers to use their own broker policy: %v", err)
	}
}
