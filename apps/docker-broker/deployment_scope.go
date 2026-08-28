package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	deploymentScopeHeader = "X-Upstand-Docker-Scope"
	deploymentIDHeader    = "X-Upstand-Deployment-ID"
	serverIDHeader        = "X-Upstand-Server-ID"
	minimumScopeSecretLen = 32
	// Keep signed worker grants short-lived to reduce replay exposure after a
	// worker compromise while covering the broker's bounded build operations.
	maximumScopeLifetime = 2 * time.Hour
	maximumClockSkew     = 5 * time.Minute
)

var deploymentScopeIdentifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

type deploymentScopeClaims struct {
	ResourceID   string `json:"resourceId"`
	DeploymentID string `json:"deploymentId"`
	ServerID     string `json:"serverId"`
	IssuedAt     int64  `json:"issuedAt"`
	ExpiresAt    int64  `json:"expiresAt"`
	Nonce        string `json:"nonce"`
}

func loadDockerScopeSecret() ([]byte, error) {
	file := strings.TrimSpace(os.Getenv("UPSTAND_DOCKER_BROKER_SCOPE_SECRET_FILE"))
	var value []byte
	var err error
	if file != "" {
		value, err = os.ReadFile(file)
		if err != nil {
			return nil, fmt.Errorf("read Docker broker scope secret: %w", err)
		}
	} else {
		value = []byte(strings.TrimSpace(os.Getenv("UPSTAND_DOCKER_BROKER_SCOPE_SECRET")))
	}
	value = []byte(strings.TrimSpace(string(value)))
	if len(value) == 0 {
		if brokerRequiresProductionIdentity() {
			return nil, errors.New("Docker broker scope signing secret is required in production")
		}
		return nil, nil
	}
	if len(value) < minimumScopeSecretLen {
		return nil, errors.New("Docker broker scope signing secret must contain at least 32 bytes")
	}
	return value, nil
}

// authorizeDeploymentWorkerScopeToken verifies that the deployment worker was
// granted the resource scope by a queueing control-plane process. The worker
// can forward a grant, but it cannot mint a grant for another resource because
// it never receives the signing secret.
func authorizeDeploymentWorkerScopeToken(caller string, r *http.Request, body, secret []byte) error {
	if caller != "deployment-worker" || !brokerRequiresProductionIdentity() {
		return nil
	}
	if len(secret) < minimumScopeSecretLen {
		return errors.New("deployment-worker scope signing is not configured")
	}
	token := strings.TrimSpace(r.Header.Get(deploymentScopeHeader))
	if token == "" {
		return errors.New("deployment-worker request requires a signed deployment scope")
	}
	claims, suppliedSignature, signedValue, err := parseDeploymentScopeToken(token)
	if err != nil {
		return err
	}
	expectedMAC := hmac.New(sha256.New, secret)
	_, _ = expectedMAC.Write([]byte(signedValue))
	expectedSignature := expectedMAC.Sum(nil)
	decodedSignature, err := base64.RawURLEncoding.DecodeString(suppliedSignature)
	if err != nil || !hmac.Equal(expectedSignature, decodedSignature) {
		return errors.New("deployment-worker deployment scope signature is invalid")
	}

	now := time.Now()
	issuedAt := time.UnixMilli(claims.IssuedAt)
	expiresAt := time.UnixMilli(claims.ExpiresAt)
	if claims.IssuedAt <= 0 || claims.ExpiresAt <= claims.IssuedAt ||
		expiresAt.Before(now) || issuedAt.After(now.Add(maximumClockSkew)) ||
		expiresAt.Sub(issuedAt) > maximumScopeLifetime {
		return errors.New("deployment-worker deployment scope is expired or has invalid lifetime")
	}
	if !resourceIDPattern.MatchString(claims.ResourceID) ||
		!deploymentScopeIdentifierPattern.MatchString(claims.DeploymentID) ||
		!deploymentScopeIdentifierPattern.MatchString(claims.ServerID) ||
		!deploymentScopeIdentifierPattern.MatchString(claims.Nonce) {
		return errors.New("deployment-worker deployment scope claims are invalid")
	}

	resourceID := strings.TrimSpace(r.Header.Get("X-Upstand-Resource-ID"))
	if resourceID == "" {
		resourceID = resourceIDFromBody(body)
	}
	if resourceID != "" && resourceID != claims.ResourceID {
		return errors.New("deployment-worker resource scope does not match the signed deployment grant")
	}
	if strings.TrimSpace(r.Header.Get(deploymentIDHeader)) != claims.DeploymentID {
		return errors.New("deployment-worker deployment scope does not match the signed deployment grant")
	}
	if strings.TrimSpace(r.Header.Get(serverIDHeader)) != claims.ServerID {
		return errors.New("deployment-worker server scope does not match the signed deployment grant")
	}
	return nil
}

func parseDeploymentScopeToken(token string) (deploymentScopeClaims, string, string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" || parts[1] == "" || parts[2] == "" {
		return deploymentScopeClaims{}, "", "", errors.New("deployment-worker deployment scope format is invalid")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return deploymentScopeClaims{}, "", "", errors.New("deployment-worker deployment scope payload is invalid")
	}
	var claims deploymentScopeClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return deploymentScopeClaims{}, "", "", errors.New("deployment-worker deployment scope claims are invalid")
	}
	return claims, parts[2], parts[0] + "." + parts[1], nil
}

func resourceIDFromBody(body []byte) string {
	if len(strings.TrimSpace(string(body))) == 0 {
		return ""
	}
	var payload struct {
		ResourceID string `json:"resource_id"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return ""
	}
	return strings.TrimSpace(payload.ResourceID)
}
