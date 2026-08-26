package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	listenAddress            = ":2375"
	maxPolicyBody            = 16 << 20
	defaultMaxInflight       = 64
	minimumMaxInflight       = 1
	maximumMaxInflight       = 256
	brokerBusyRetryAfterSecs = 1
)

func main() {
	socketPath := os.Getenv("UPSTAND_DOCKER_SOCKET")
	if socketPath == "" {
		socketPath = "/var/run/docker.sock"
	}
	if _, err := os.Stat(socketPath); err != nil {
		log.Fatalf("Docker socket is unavailable: %v", err)
	}
	brokerCredentials := loadBrokerCredentials()
	allowedCallers := loadAllowedCallers()
	tlsRequired := strings.EqualFold(strings.TrimSpace(os.Getenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED")), "true")
	if err := validateBrokerConfiguration(brokerCredentials, allowedCallers, tlsRequired); err != nil {
		log.Fatal(err)
	}
	brokerTLS, err := loadBrokerTLSConfig()
	if err != nil {
		log.Fatal(err)
	}
	requestSlots := make(chan struct{}, loadMaxInflightRequests())

	backend, _ := url.Parse("http://docker-engine")
	proxy := httputil.NewSingleHostReverseProxy(backend)
	proxy.Transport = &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socketPath)
		},
		MaxIdleConns:          32,
		IdleConnTimeout:       30 * time.Second,
		ResponseHeaderTimeout: 5 * time.Minute,
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		if audit := dockerAuditFromContext(r.Context()); audit != nil {
			audit.finish(http.StatusBadGateway)
		}
		log.Printf("Docker broker upstream error: %v", err)
		http.Error(w, "Docker broker upstream unavailable", http.StatusBadGateway)
	}
	proxy.ModifyResponse = func(response *http.Response) error {
		if audit := dockerAuditFromContext(response.Request.Context()); audit != nil {
			audit.finish(response.StatusCode)
		}
		return nil
	}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok\n"))
			return
		}
		audit := newDockerAudit(r, normalizeDockerPath(r.URL.Path))
		defer audit.finish(http.StatusInternalServerError)
		authenticatedCaller, err := authorizeBrokerCredentials(
			r.Header.Get("X-Upstand-Docker-Broker-Token"),
			brokerCredentials,
		)
		if err != nil {
			audit.finish(http.StatusUnauthorized)
			http.Error(w, "Docker broker authentication required", http.StatusUnauthorized)
			return
		}
		if brokerTLS != nil {
			certificateCaller, certificateErr := authorizeBrokerClientCertificate(r)
			if certificateErr != nil {
				audit.finish(http.StatusUnauthorized)
				http.Error(w, "Docker broker client certificate required", http.StatusUnauthorized)
				return
			}
			if authenticatedCaller != "*" && authenticatedCaller != certificateCaller {
				audit.finish(http.StatusForbidden)
				http.Error(w, "Docker broker credential and certificate callers differ", http.StatusForbidden)
				return
			}
			authenticatedCaller = certificateCaller
		}
		reportedCaller := strings.TrimSpace(r.Header.Get("X-Upstand-Docker-Caller"))
		if authenticatedCaller != "*" && reportedCaller != "" && reportedCaller != authenticatedCaller {
			audit.finish(http.StatusForbidden)
			http.Error(w, "Docker broker caller identity does not match its credential", http.StatusForbidden)
			return
		}
		audit.caller = authenticatedCaller
		if audit.caller == "*" {
			audit.caller = reportedCaller
		}
		if err := authorizeBrokerCaller(audit.caller, allowedCallers); err != nil {
			audit.finish(http.StatusForbidden)
			http.Error(w, "Docker broker caller is not authorized", http.StatusForbidden)
			return
		}
		select {
		case requestSlots <- struct{}{}:
			defer func() { <-requestSlots }()
		default:
			audit.finish(http.StatusTooManyRequests)
			w.Header().Set("Retry-After", strconv.Itoa(brokerBusyRetryAfterSecs))
			http.Error(w, "Docker broker is at its concurrency limit", http.StatusTooManyRequests)
			return
		}

		var body []byte
		normalizedPath := normalizeDockerPath(r.URL.Path)
		if (isTypedDockerPath(normalizedPath) && normalizedPath != typedResourceBuildPath) || isJSONPolicyPath(normalizedPath) {
			var err error
			body, err = readPolicyBody(r)
			if err != nil {
				audit.finish(http.StatusRequestEntityTooLarge)
				http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
				return
			}
		}
		if isTypedDockerPath(normalizedPath) {
			if err := authorizeTypedDockerRequest(audit.caller, r, body); err != nil {
				audit.finish(http.StatusForbidden)
				log.Printf("Docker broker denied typed %s %s: %v", r.Method, r.URL.Path, err)
				http.Error(w, "Docker typed operation denied by Upstand policy", http.StatusForbidden)
				return
			}
			if normalizedPath == typedResourceBuildPath {
				status := serveTypedResourceBuild(w, r, socketPath)
				audit.finish(status)
				return
			}
			status := serveTypedDockerRequest(w, r, body, socketPath)
			audit.finish(status)
			return
		}
		if err := authorizeDockerRequestForCaller(audit.caller, r, body); err != nil {
			audit.finish(http.StatusForbidden)
			log.Printf("Docker broker denied %s %s: %v", r.Method, r.URL.Path, err)
			http.Error(w, "Docker operation denied by Upstand policy", http.StatusForbidden)
			return
		}
		if body != nil {
			r.Body = io.NopCloser(bytes.NewReader(body))
			r.ContentLength = int64(len(body))
		}
		proxy.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), dockerAuditContextKey{}, audit)))
	})

	server := &http.Server{
		Addr:              listenAddress,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Minute,
		WriteTimeout:      15 * time.Minute,
		IdleTimeout:       5 * time.Minute,
		MaxHeaderBytes:    32 << 10,
	}
	log.Printf("Upstand Docker broker listening on %s", listenAddress)
	var serveErr error
	if brokerTLS != nil {
		server.TLSConfig = brokerTLS
		serveErr = server.ListenAndServeTLS("", "")
	} else {
		serveErr = server.ListenAndServe()
	}
	if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
		log.Fatal(serveErr)
	}
}

func loadBrokerTLSConfig() (*tls.Config, error) {
	caPath := strings.TrimSpace(os.Getenv("UPSTAND_DOCKER_BROKER_CA_FILE"))
	certPath := strings.TrimSpace(os.Getenv("UPSTAND_DOCKER_BROKER_CERT_FILE"))
	keyPath := strings.TrimSpace(os.Getenv("UPSTAND_DOCKER_BROKER_KEY_FILE"))
	required := strings.EqualFold(strings.TrimSpace(os.Getenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED")), "true")
	configured := caPath != "" || certPath != "" || keyPath != ""
	if !configured {
		if required {
			return nil, errors.New("Docker broker TLS is required but certificate files are not configured")
		}
		return nil, nil
	}
	if caPath == "" || certPath == "" || keyPath == "" {
		return nil, errors.New("Docker broker TLS requires CA, certificate, and key files")
	}

	caPEM, err := os.ReadFile(caPath)
	if err != nil {
		return nil, fmt.Errorf("read Docker broker TLS CA: %w", err)
	}
	clientCAs := x509.NewCertPool()
	if !clientCAs.AppendCertsFromPEM(caPEM) {
		return nil, errors.New("Docker broker TLS CA does not contain a valid certificate")
	}
	certificate, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, fmt.Errorf("load Docker broker TLS certificate: %w", err)
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
		// Reject unauthenticated connections during the TLS handshake. The HTTP
		// handler still verifies the caller identity and matching token, but a
		// missing client certificate must never reach the Docker policy layer.
		ClientAuth: tls.RequireAndVerifyClientCert,
		ClientCAs:  clientCAs,
	}, nil
}

func authorizeBrokerClientCertificate(r *http.Request) (string, error) {
	if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 || len(r.TLS.VerifiedChains) == 0 {
		return "", errors.New("verified Docker broker client certificate is required")
	}
	commonName := strings.TrimSpace(r.TLS.PeerCertificates[0].Subject.CommonName)
	switch commonName {
	case "upstand-server":
		return "server", nil
	case "upstand-schedules":
		return "schedules", nil
	case "upstand-deployment-worker":
		return "deployment-worker", nil
	default:
		return "", fmt.Errorf("unrecognized Docker broker client certificate subject %q", commonName)
	}
}

func loadMaxInflightRequests() int {
	value := strings.TrimSpace(os.Getenv("UPSTAND_DOCKER_BROKER_MAX_INFLIGHT"))
	if value == "" {
		return defaultMaxInflight
	}
	limit, err := strconv.Atoi(value)
	if err != nil || limit < minimumMaxInflight || limit > maximumMaxInflight {
		log.Printf(
			"Invalid UPSTAND_DOCKER_BROKER_MAX_INFLIGHT=%q; using %d",
			value,
			defaultMaxInflight,
		)
		return defaultMaxInflight
	}
	return limit
}

func authorizeBrokerToken(provided, expected string) error {
	if expected == "" {
		return nil
	}
	if len(provided) != len(expected) || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		return errors.New("invalid Docker broker token")
	}
	return nil
}

func authorizeBrokerCredentials(provided string, credentials map[string]string) (string, error) {
	matchedCaller := ""
	for caller, expected := range credentials {
		if len(provided) == len(expected) && subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1 {
			matchedCaller = caller
		}
	}
	if matchedCaller == "" {
		return "", errors.New("invalid Docker broker credential")
	}
	return matchedCaller, nil
}

func loadAllowedCallers() map[string]struct{} {
	allowed := make(map[string]struct{})
	for _, value := range strings.Split(os.Getenv("UPSTAND_DOCKER_BROKER_ALLOWED_CALLERS"), ",") {
		if caller := strings.TrimSpace(value); caller != "" {
			allowed[caller] = struct{}{}
		}
	}
	return allowed
}

func authorizeBrokerCaller(caller string, allowed map[string]struct{}) error {
	if len(allowed) == 0 {
		return nil
	}
	if _, ok := allowed[caller]; !ok {
		return errors.New("caller is not in the Docker broker allowlist")
	}
	return nil
}

func validateBrokerConfiguration(credentials map[string]string, allowedCallers map[string]struct{}, tlsRequired bool) error {
	if !tlsRequired {
		return nil
	}
	if _, legacyTokenMode := credentials["*"]; legacyTokenMode {
		return errors.New("Docker broker TLS mode requires caller-specific token files")
	}
	if len(allowedCallers) == 0 {
		return errors.New("Docker broker TLS mode requires a non-empty caller allowlist")
	}
	for caller := range allowedCallers {
		if caller != "server" && caller != "schedules" && caller != "deployment-worker" {
			return fmt.Errorf("Docker broker TLS mode contains unknown caller %q", caller)
		}
		if strings.TrimSpace(credentials[caller]) == "" {
			return fmt.Errorf("Docker broker TLS mode is missing credentials for caller %q", caller)
		}
	}
	return nil
}

func loadBrokerCredentials() map[string]string {
	credentials := make(map[string]string)
	for caller, variable := range map[string]string{
		"server":            "UPSTAND_DOCKER_BROKER_SERVER_TOKEN_FILE",
		"schedules":         "UPSTAND_DOCKER_BROKER_SCHEDULES_TOKEN_FILE",
		"deployment-worker": "UPSTAND_DOCKER_BROKER_DEPLOYMENT_WORKER_TOKEN_FILE",
	} {
		path := strings.TrimSpace(os.Getenv(variable))
		if path == "" {
			continue
		}
		credentials[caller] = readBrokerTokenFile(path)
	}
	if len(credentials) > 0 {
		return credentials
	}

	// A single token is retained only as an explicit development/backward-
	// compatibility path. Production Compose supplies caller-specific files.
	if token := loadBrokerToken(); token != "" {
		credentials["*"] = token
		return credentials
	}
	log.Fatal("Docker broker requires caller-specific token files or an explicit development token")
	return credentials
}

type dockerAuditContextKey struct{}

type dockerAudit struct {
	startedAt  time.Time
	method     string
	operation  string
	caller     string
	finishOnce sync.Once
}

func newDockerAudit(r *http.Request, path string) *dockerAudit {
	return &dockerAudit{
		startedAt: time.Now(),
		method:    r.Method,
		operation: dockerOperationName(r.Method, path),
	}
}

func dockerAuditFromContext(ctx context.Context) *dockerAudit {
	audit, _ := ctx.Value(dockerAuditContextKey{}).(*dockerAudit)
	return audit
}

func (audit *dockerAudit) finish(status int) {
	audit.finishOnce.Do(func() {
		payload, err := json.Marshal(map[string]any{
			"event":       "docker_operation",
			"caller":      audit.caller,
			"method":      audit.method,
			"operation":   audit.operation,
			"status":      status,
			"duration_ms": time.Since(audit.startedAt).Milliseconds(),
		})
		if err == nil {
			log.Print(string(payload))
		}
	})
}

func dockerOperationName(method, path string) string {
	if method == http.MethodGet && path == "/_ping" {
		return "daemon.ping"
	}
	if method == http.MethodGet && path == "/version" {
		return "daemon.version"
	}
	if method == http.MethodGet && path == "/info" {
		return "daemon.info"
	}
	if method == http.MethodPost && path == "/build" {
		return "build.create"
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 2 && parts[1] == "json" {
		return parts[0] + ".list"
	}
	if len(parts) == 2 {
		return parts[0] + "." + parts[1]
	}
	if len(parts) == 3 {
		return parts[0] + "." + parts[2]
	}
	return "unknown"
}

func loadBrokerToken() string {
	path := strings.TrimSpace(os.Getenv("UPSTAND_DOCKER_BROKER_TOKEN_FILE"))
	if path == "" {
		return strings.TrimSpace(os.Getenv("UPSTAND_DOCKER_BROKER_TOKEN"))
	}
	return readBrokerTokenFile(path)
}

func readBrokerTokenFile(path string) string {
	token, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("Docker broker token is unavailable: %v", err)
	}
	value := strings.TrimSpace(string(token))
	if len(value) < 32 {
		log.Fatal("Docker broker token must contain at least 32 characters")
	}
	return value
}

func readPolicyBody(r *http.Request) ([]byte, error) {
	if r.Body == nil || r.ContentLength == 0 {
		return nil, nil
	}
	if r.ContentLength > maxPolicyBody {
		return nil, fmt.Errorf("request body exceeds %d bytes", maxPolicyBody)
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxPolicyBody+1))
	if err != nil {
		return nil, fmt.Errorf("read request body: %w", err)
	}
	if len(body) > maxPolicyBody {
		return nil, fmt.Errorf("request body exceeds %d bytes", maxPolicyBody)
	}
	return body, nil
}

func authorizeDockerRequest(r *http.Request, body []byte) error {
	return authorizeDockerRequestForCaller("*", r, body)
}

func authorizeDockerRequestForCaller(caller string, r *http.Request, body []byte) error {
	path := normalizeDockerPath(r.URL.Path)
	if !isAllowedDockerOperation(r.Method, path) {
		return fmt.Errorf("operation %s %s is outside the broker contract", r.Method, path)
	}
	if !isAllowedCallerDockerOperation(caller, r.Method, path) {
		return fmt.Errorf("operation %s %s is outside the %s caller contract", r.Method, path, caller)
	}
	if err := requireDeploymentWorkerResourceScope(caller, r, r.Method, path); err != nil {
		return err
	}
	if err := requireDeploymentWorkerOwnedResourceBody(caller, r, body); err != nil {
		return err
	}
	if isJSONPolicyPath(path) && len(bytes.TrimSpace(body)) > 0 {
		if err := rejectHostEscapeJSON(body); err != nil {
			return err
		}
		if err := rejectUnapprovedDockerDrivers(path, body); err != nil {
			return err
		}
	}
	return nil
}

func requireDeploymentWorkerResourceScope(caller string, r *http.Request, method, path string) error {
	if caller != "deployment-worker" || !brokerRequiresProductionIdentity() {
		return nil
	}
	if method == http.MethodPost && path == "/build" {
		resourceID := strings.TrimSpace(r.Header.Get("X-Upstand-Resource-ID"))
		if !resourceIDPattern.MatchString(resourceID) {
			return errors.New("deployment-worker build requires a valid X-Upstand-Resource-ID")
		}
		return validateDeploymentWorkerBuildQuery(r, resourceID)
	}
	serviceMutation := (method == http.MethodPost && path == "/services/create") ||
		(method == http.MethodPost && resourceActionPath(path, "services", "update")) ||
		(method == http.MethodDelete && resourceItemPath(path, "services"))
	resourceMutation := method == http.MethodPost && (path == "/build" ||
		path == "/containers/create" ||
		path == "/images/create" ||
		path == "/networks/create" ||
		path == "/volumes/create" ||
		resourceActionPath(path, "networks", "connect") ||
		resourceActionPath(path, "networks", "disconnect"))
	if resourceMutation || serviceMutation {
		resourceID := strings.TrimSpace(r.Header.Get("X-Upstand-Resource-ID"))
		if !resourceIDPattern.MatchString(resourceID) {
			return errors.New("deployment-worker resource mutation requires a valid X-Upstand-Resource-ID")
		}
	}
	return nil
}

func validateDeploymentWorkerBuildQuery(r *http.Request, resourceID string) error {
	query := r.URL.Query()
	image := strings.TrimSpace(query.Get("t"))
	if !resourceBuildImagePattern.MatchString(image) {
		return errors.New("deployment-worker build requires a valid tagged image")
	}

	dockerfile := strings.TrimSpace(query.Get("dockerfile"))
	if dockerfile != "" && (strings.HasPrefix(dockerfile, "/") || strings.Contains(dockerfile, `\`)) {
		return errors.New("deployment-worker build Dockerfile path is invalid")
	}
	for _, segment := range strings.Split(dockerfile, "/") {
		if segment == "." || segment == ".." {
			return errors.New("deployment-worker build Dockerfile path contains an invalid segment")
		}
	}

	if query.Get("remote") != "" || query.Get("outputs") != "" {
		return errors.New("deployment-worker build cannot use remote contexts or output exporters")
	}
	networkMode := strings.ToLower(strings.TrimSpace(query.Get("networkmode")))
	if networkMode == "host" || strings.HasPrefix(networkMode, "container:") {
		return errors.New("deployment-worker build cannot use host network access")
	}
	for _, option := range query["securityopt"] {
		if unsafeSecurityOption(option) {
			return errors.New("deployment-worker build cannot weaken the security profile")
		}
	}

	labels := strings.TrimSpace(query.Get("labels"))
	if labels == "" {
		return errors.New("deployment-worker build requires an ownership label")
	}
	var parsedLabels map[string]string
	if json.Unmarshal([]byte(labels), &parsedLabels) != nil ||
		parsedLabels["com.upstand.resource-id"] != resourceID {
		return errors.New("deployment-worker build must carry the exact resource ownership label")
	}

	buildArgs := strings.TrimSpace(query.Get("buildargs"))
	if buildArgs == "" {
		return nil
	}
	var parsedBuildArgs map[string]string
	if json.Unmarshal([]byte(buildArgs), &parsedBuildArgs) != nil || parsedBuildArgs == nil || len(parsedBuildArgs) > 64 {
		return errors.New("deployment-worker build arguments are invalid or unbounded")
	}
	for key, value := range parsedBuildArgs {
		if !resourceBuildTargetPattern.MatchString(key) || len(value) > maxResourceBuildArgumentB || hasControlCharacter(value) || isSensitiveBuildArgument(key) {
			return errors.New("deployment-worker build argument is invalid or sensitive")
		}
	}
	return nil
}

func requireDeploymentWorkerOwnedResourceBody(caller string, r *http.Request, body []byte) error {
	if caller != "deployment-worker" || !brokerRequiresProductionIdentity() {
		return nil
	}
	path := normalizeDockerPath(r.URL.Path)
	serviceMutation := (r.Method == http.MethodPost && path == "/services/create") ||
		(r.Method == http.MethodPost && resourceActionPath(path, "services", "update"))
	containerCreation := r.Method == http.MethodPost && path == "/containers/create"
	if !serviceMutation && !containerCreation {
		return nil
	}
	resourceID := strings.TrimSpace(r.Header.Get("X-Upstand-Resource-ID"))
	var payload struct {
		Labels map[string]string `json:"Labels"`
	}
	if len(bytes.TrimSpace(body)) == 0 || json.Unmarshal(body, &payload) != nil ||
		payload.Labels["com.upstand.resource-id"] != resourceID {
		return errors.New("deployment-worker resource mutation must carry the matching system-owned resource label")
	}
	return nil
}

// isAllowedCallerDockerOperation narrows the global Docker operation allowlist
// for production identities. The server identity owns API-facing maintenance
// operations; schedules orchestrates backups/migrations; deployment-worker
// builds and deploys. Keep the default test/development identity compatible
// with the global policy until TLS caller identity is configured.
func isAllowedCallerDockerOperation(caller, method, path string) bool {
	if caller == "" || caller == "*" {
		return true
	}

	if caller == "schedules" {
		// Workload migration and backup orchestration do not build images or
		// create ad-hoc containers. Those capabilities belong to the deployment
		// worker or the API server's explicitly reviewed workflows.
		if method == http.MethodPost && (path == "/build" || path == "/build/prune" || path == "/containers/create" || path == "/images/create") {
			return false
		}
	}

	if caller == "server" && brokerRequiresProductionIdentity() {
		// Production API processes do not own image-build or arbitrary Swarm
		// service-mutation authority. Resource service mutations, including
		// deletion, use typed routes; deployment builds and Compose remain
		// isolated in the deployment worker.
		if (method == http.MethodPost && (path == "/build" || path == "/services/create")) ||
			(method == http.MethodPost && resourceActionPath(path, "services", "update")) ||
			(method == http.MethodDelete && resourceItemPath(path, "services")) {
			return false
		}
	}

	if caller == "deployment-worker" {
		// The deployment worker must deploy and build, but it has no reason to
		// run global cleanup or delete/tag arbitrary images.
		if (method == http.MethodPost && (path == "/containers/prune" || path == "/images/prune")) ||
			(method == http.MethodPost && path == "/images/create") ||
			(method == http.MethodDelete && resourceItemPath(path, "images")) ||
			(method == http.MethodDelete && resourceItemPath(path, "networks")) ||
			(method == http.MethodDelete && resourceItemPath(path, "volumes")) ||
			(method == http.MethodPost && resourceActionPath(path, "images", "tag")) ||
			(method == http.MethodDelete && resourceItemPath(path, "services")) {
			return false
		}
	}

	return true
}

func brokerRequiresProductionIdentity() bool {
	return strings.EqualFold(
		strings.TrimSpace(os.Getenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED")),
		"true",
	)
}

func rejectUnapprovedDockerDrivers(path string, body []byte) error {
	if path != "/volumes/create" && path != "/networks/create" {
		return nil
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return fmt.Errorf("invalid JSON policy body: %w", err)
	}
	var driver string
	for key, value := range payload {
		if strings.EqualFold(key, "Driver") {
			driver, _ = value.(string)
			break
		}
	}
	driver = strings.ToLower(strings.TrimSpace(driver))
	if path == "/volumes/create" && driver != "" && driver != "local" {
		return fmt.Errorf("volume driver %q is outside the broker contract", driver)
	}
	if path == "/networks/create" && driver != "" && driver != "bridge" && driver != "overlay" {
		return fmt.Errorf("network driver %q is outside the broker contract", driver)
	}
	return nil
}

// isAllowedDockerOperation is intentionally an allowlist. The broker is a
// control-plane capability boundary, not a general Docker API endpoint. New
// Docker calls must be reviewed here and covered by a policy test before they
// can be used in production.
func isAllowedDockerOperation(method, path string) bool {
	if method == http.MethodGet && (path == "/_ping" || path == "/version" || path == "/info" || path == "/nodes" || path == "/system/df") {
		return true
	}
	if method == http.MethodGet && path == "/containers/json" {
		return true
	}
	if method == http.MethodPost && path == "/containers/create" {
		return true
	}
	if method == http.MethodPost && path == "/containers/prune" {
		return true
	}
	if method == http.MethodDelete && containerPath(path, "") {
		return true
	}
	if method == http.MethodPost && containerActionPath(path, "exec") {
		return true
	}
	if method == http.MethodPut && containerActionPath(path, "archive") {
		return true
	}
	if (method == http.MethodGet || method == http.MethodPut) && containerActionPath(path, "archive") {
		return true
	}
	for _, action := range []string{"json", "start", "stop", "restart", "kill", "wait", "rename", "update", "resize", "logs", "changes", "stats", "top"} {
		if (method == http.MethodGet && isContainerReadAction(action)) ||
			(method == http.MethodPost && isContainerWriteAction(action)) {
			if containerActionPath(path, action) {
				return true
			}
		}
	}

	if method == http.MethodGet && (path == "/images/json" || path == "/volumes" || path == "/networks" || path == "/services" || path == "/tasks") {
		return true
	}
	if method == http.MethodPost && (path == "/images/create" || path == "/images/prune" || path == "/build" || path == "/build/prune" || path == "/volumes/create" || path == "/networks/create" || path == "/services/create") {
		return true
	}
	if method == http.MethodGet && (resourceItemPath(path, "images") || resourceItemPath(path, "volumes") || resourceItemPath(path, "networks") || resourceItemPath(path, "services") || resourceItemPath(path, "tasks")) {
		return true
	}
	if method == http.MethodGet && resourceActionPath(path, "images", "json") {
		return true
	}
	if method == http.MethodDelete && (resourceItemPath(path, "images") || resourceItemPath(path, "volumes") || resourceItemPath(path, "networks") || resourceItemPath(path, "services")) {
		return true
	}
	if method == http.MethodPost && (resourceActionPath(path, "networks", "connect") || resourceActionPath(path, "networks", "disconnect") || resourceActionPath(path, "images", "tag")) {
		return true
	}
	if method == http.MethodPost && resourceActionPath(path, "services", "update") {
		return true
	}
	if method == http.MethodGet && resourceActionPath(path, "services", "tasks") {
		return true
	}

	if method == http.MethodGet && execPath(path, "json") {
		return true
	}
	if method == http.MethodPost && (execPath(path, "start") || execPath(path, "resize")) {
		return true
	}

	return false
}

func splitResourcePath(path, resource string) ([]string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 || parts[0] != resource {
		return nil, false
	}
	for _, part := range parts[1:] {
		if part == "" || part == "." || part == ".." {
			return nil, false
		}
	}
	return parts, true
}

func resourceItemPath(path, resource string) bool {
	parts, ok := splitResourcePath(path, resource)
	return ok && len(parts) == 2
}

func resourceActionPath(path, resource, action string) bool {
	parts, ok := splitResourcePath(path, resource)
	return ok && len(parts) == 3 && parts[2] == action
}

func containerPath(path, action string) bool {
	parts, ok := splitResourcePath(path, "containers")
	if !ok || len(parts) != 2 {
		return false
	}
	return action == ""
}

func containerActionPath(path, action string) bool {
	parts, ok := splitResourcePath(path, "containers")
	return ok && len(parts) == 3 && parts[2] == action
}

func execPath(path, action string) bool {
	parts, ok := splitResourcePath(path, "exec")
	return ok && len(parts) == 3 && parts[2] == action
}

func isContainerReadAction(action string) bool {
	for _, read := range []string{"json", "logs", "changes", "stats", "top"} {
		if action == read {
			return true
		}
	}
	return false
}

func isContainerWriteAction(action string) bool {
	for _, write := range []string{"start", "stop", "restart", "kill", "wait", "rename", "update", "resize"} {
		if action == write {
			return true
		}
	}
	return false
}

func normalizeDockerPath(raw string) string {
	path := raw
	if strings.HasPrefix(path, "/v") {
		if slash := strings.Index(path[2:], "/"); slash >= 0 {
			path = path[slash+2:]
		}
	}
	if path == "" {
		return "/"
	}
	return path
}

func isJSONPolicyPath(path string) bool {
	return strings.HasSuffix(path, "/containers/create") ||
		strings.Contains(path, "/containers/") && strings.HasSuffix(path, "/update") ||
		strings.HasSuffix(path, "/services/create") ||
		strings.Contains(path, "/services/") && strings.HasSuffix(path, "/update") ||
		strings.HasSuffix(path, "/volumes/create") ||
		strings.HasSuffix(path, "/networks/create")
}

func rejectHostEscapeJSON(body []byte) error {
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		return fmt.Errorf("invalid JSON policy body: %w", err)
	}
	return walkHostEscape(value, "$")
}

func walkHostEscape(value any, location string) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			keyLocation := location + "." + key
			switch key {
			case "Privileged", "PublishAllPorts", "PidMode", "IpcMode", "NetworkMode", "UsernsMode", "CgroupnsMode", "Isolation":
				if key == "Privileged" || key == "PublishAllPorts" {
					if enabled, ok := child.(bool); ok && enabled {
						return fmt.Errorf("%s enables an unsafe host capability", keyLocation)
					}
				} else if text, ok := child.(string); ok && isHostMode(text) {
					return fmt.Errorf("%s requests host mode", keyLocation)
				}
			case "CapAdd", "Devices", "DeviceRequests":
				if list, ok := child.([]any); ok && len(list) > 0 {
					return fmt.Errorf("%s injects host capabilities or devices", keyLocation)
				}
			case "DriverOpts":
				if options, ok := child.(map[string]any); ok && len(options) > 0 {
					return fmt.Errorf("%s can create a host-backed Docker volume", keyLocation)
				}
			case "Runtime":
				if runtime, ok := child.(string); ok && strings.TrimSpace(runtime) != "" {
					return fmt.Errorf("%s selects a custom container runtime", keyLocation)
				}
			case "SecurityOpt":
				if options, ok := child.([]any); ok {
					for _, option := range options {
						if text, ok := option.(string); ok && unsafeSecurityOption(text) {
							return fmt.Errorf("%s weakens the container security profile", keyLocation)
						}
					}
				}
			case "Binds":
				if list, ok := child.([]any); ok {
					for _, entry := range list {
						if text, ok := entry.(string); ok && unsafeBindSource(text) {
							return fmt.Errorf("%s contains an unsafe host bind", keyLocation)
						}
					}
				}
			case "Mounts":
				if list, ok := child.([]any); ok {
					for _, entry := range list {
						if mount, ok := entry.(map[string]any); ok {
							if kind, _ := mount["Type"].(string); kind == "bind" {
								source, _ := mount["Source"].(string)
								readOnly, _ := mount["ReadOnly"].(bool)
								if (unsafeBindSource(source) && !(isTelemetryBindSource(source) && readOnly)) ||
									(isTelemetryBindSource(source) && !readOnly) {
									return fmt.Errorf("%s contains an unsafe host bind", keyLocation)
								}
							}
						}
					}
				}
			}
			if err := walkHostEscape(child, keyLocation); err != nil {
				return err
			}
		}
	case []any:
		for index, child := range typed {
			if err := walkHostEscape(child, fmt.Sprintf("%s[%d]", location, index)); err != nil {
				return err
			}
		}
	}
	return nil
}

func isHostMode(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return value == "host" || value == "hostipc" || value == "hostpid" || value == "hostnetwork"
}

func unsafeSecurityOption(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return value == "apparmor=unconfined" ||
		value == "seccomp=unconfined" ||
		value == "label=disable" ||
		value == "systempaths=unconfined"
}

func unsafeBindSource(value string) bool {
	source := strings.TrimSpace(strings.SplitN(value, ":", 2)[0])
	if source == "" || !strings.HasPrefix(source, "/") {
		return false
	}
	clean := strings.TrimRight(source, "/")
	if clean == "" {
		return true
	}
	if isTelemetryBindSource(clean) {
		return !hasReadOnlyBindOption(value)
	}
	// A resource workload may use named Docker volumes, but an arbitrary
	// absolute source is a host filesystem capability even when it is outside
	// the familiar /etc or Docker-socket denylist. Keep the only exception
	// narrow and read-only for the broker's telemetry consumers.
	return true
}

func isTelemetryBindSource(value string) bool {
	clean := strings.TrimRight(strings.TrimSpace(value), "/")
	return clean == "/proc" || strings.HasPrefix(clean, "/proc/") ||
		clean == "/sys" || strings.HasPrefix(clean, "/sys/") || clean == "/etc/os-release"
}

func hasReadOnlyBindOption(value string) bool {
	parts := strings.Split(value, ":")
	if len(parts) < 3 {
		return false
	}
	for _, option := range strings.Split(parts[2], ",") {
		if strings.EqualFold(strings.TrimSpace(option), "ro") || strings.EqualFold(strings.TrimSpace(option), "readonly") {
			return true
		}
	}
	return false
}
