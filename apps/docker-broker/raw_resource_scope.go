package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// authorizeDeploymentWorkerRawResourceScope closes the remaining confused-
// deputy gap in the legacy Docker API. The caller certificate and resource
// header identify the intended resource, but only the daemon's live labels can
// prove that an existing container or network belongs to it.
func authorizeDeploymentWorkerRawResourceScope(
	ctx context.Context,
	caller string,
	r *http.Request,
	body []byte,
	engine *dockerEngineClient,
) error {
	if caller != "deployment-worker" || !brokerRequiresProductionIdentity() {
		return nil
	}
	resourceID := strings.TrimSpace(r.Header.Get("X-Upstand-Resource-ID"))
	if !resourceIDPattern.MatchString(resourceID) {
		return errors.New("deployment-worker raw resource scope is invalid")
	}
	if engine == nil {
		return errors.New("Docker engine authorization client is unavailable")
	}

	path := normalizeDockerPath(r.URL.Path)
	if r.Method == http.MethodPost && resourceActionPath(path, "services", "update") {
		parts, ok := splitResourcePath(path, "services")
		if !ok || !swarmNamePattern.MatchString(parts[1]) {
			return errors.New("deployment-worker service identity is invalid")
		}
		return engine.authorizeResourceService(ctx, parts[1], resourceID)
	}
	if isRawContainerMutation(r.Method, path) {
		parts, ok := splitResourcePath(path, "containers")
		if !ok || !swarmNamePattern.MatchString(parts[1]) {
			return errors.New("deployment-worker container identity is invalid")
		}
		return engine.authorizeResourceContainer(ctx, parts[1], resourceID)
	}
	if r.Method == http.MethodPost &&
		(resourceActionPath(path, "networks", "connect") || resourceActionPath(path, "networks", "disconnect")) {
		return authorizeDeploymentWorkerRawNetwork(ctx, path, body, resourceID, engine)
	}
	return nil
}

func (engine *dockerEngineClient) authorizeResourceService(ctx context.Context, serviceID, resourceID string) error {
	body, _, err := engine.request(ctx, http.MethodGet, "/services/"+url.PathEscape(serviceID), nil)
	if err != nil {
		return err
	}
	var inspection struct {
		Spec struct {
			Labels map[string]string `json:"Labels"`
		} `json:"Spec"`
	}
	if err := json.Unmarshal(body, &inspection); err != nil {
		return fmt.Errorf("invalid Docker service inspection: %w", err)
	}
	if inspection.Spec.Labels["com.upstand.resource-id"] != resourceID {
		return errors.New("service is not owned by the requested Upstand resource")
	}
	return nil
}

func isRawContainerMutation(method, path string) bool {
	return (method == http.MethodDelete && containerPath(path, "")) ||
		(method == http.MethodPost && isContainerMutationPath(path)) ||
		(method == http.MethodPut && containerActionPath(path, "archive"))
}

func authorizeDeploymentWorkerRawNetwork(
	ctx context.Context,
	path string,
	body []byte,
	resourceID string,
	engine *dockerEngineClient,
) error {
	parts, ok := splitResourcePath(path, "networks")
	if !ok || !swarmNamePattern.MatchString(parts[1]) {
		return errors.New("deployment-worker network identity is invalid")
	}

	var payload struct {
		Container string `json:"Container"`
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return errors.New("deployment-worker network attachment requires a JSON body")
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return fmt.Errorf("deployment-worker network attachment body is invalid: %w", err)
	}
	if !swarmNamePattern.MatchString(payload.Container) {
		return errors.New("deployment-worker network attachment container identity is invalid")
	}

	networkBody, _, err := engine.request(
		ctx,
		http.MethodGet,
		"/networks/"+url.PathEscape(parts[1]),
		nil,
	)
	if err != nil {
		return err
	}
	var network struct {
		ID         string            `json:"Id"`
		Name       string            `json:"Name"`
		Driver     string            `json:"Driver"`
		Scope      string            `json:"Scope"`
		Attachable bool              `json:"Attachable"`
		Options    map[string]string `json:"Options"`
		Labels     map[string]string `json:"Labels"`
	}
	if err := json.Unmarshal(networkBody, &network); err != nil {
		return fmt.Errorf("invalid Docker network inspection: %w", err)
	}
	if network.ID == "" || network.Name == "" {
		return errors.New("Docker network inspection is missing its identity")
	}
	if err := validateManagedSwarmNetwork(networkBody); err != nil {
		return fmt.Errorf("Docker network is not a managed encrypted Swarm network: %w", err)
	}
	if !isAuthorizedDeploymentWorkerNetwork(network.Name, network.Labels, resourceID) {
		return errors.New("Docker network is not owned by the requested Upstand resource")
	}
	return engine.authorizeResourceContainer(ctx, payload.Container, resourceID)
}

func isAuthorizedDeploymentWorkerNetwork(name string, labels map[string]string, resourceID string) bool {
	if name == configuredSharedNetworkName() {
		return true
	}
	resourcePrefix := "upstand-resource-" + strings.ToLower(resourceID)
	if name != resourceOverlayNetworkName(resourceID) &&
		!strings.HasPrefix(name, resourcePrefix+"-") {
		return false
	}
	return labels["com.upstand.managed"] == "true" &&
		labels["com.upstand.purpose"] == "resource-isolation" &&
		labels["com.upstand.resource-id"] == resourceID
}
