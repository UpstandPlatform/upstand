package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

var deploymentWorkerVolumeNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$`)

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
	if r.Method == http.MethodGet && isDeploymentWorkerGlobalInventoryPath(path) {
		return errors.New("deployment-worker global Docker inventory is not allowed")
	}
	if r.Method == http.MethodPost && path == "/containers/create" {
		return authorizeDeploymentWorkerRawContainerResources(ctx, body, resourceID, engine)
	}
	if r.Method == http.MethodGet && path == "/containers/json" {
		return authorizeDeploymentWorkerRawContainerList(r, resourceID)
	}
	if r.Method == http.MethodGet && path == "/services" {
		return authorizeDeploymentWorkerRawResourceList(r, resourceID, "services")
	}
	if r.Method == http.MethodGet && path == "/tasks" {
		return authorizeDeploymentWorkerRawTaskList(ctx, r, resourceID, engine)
	}
	if r.Method == http.MethodGet && path == "/networks" {
		return authorizeDeploymentWorkerRawResourceList(r, resourceID, "networks")
	}
	if r.Method == http.MethodGet && resourceItemPath(path, "volumes") {
		return authorizeDeploymentWorkerRawVolumeInspection(ctx, path, resourceID, engine)
	}
	if r.Method == http.MethodGet && resourceItemPath(path, "services") {
		parts, ok := splitResourcePath(path, "services")
		if !ok || !swarmNamePattern.MatchString(parts[1]) {
			return errors.New("deployment-worker service identity is invalid")
		}
		return engine.authorizeResourceService(ctx, parts[1], resourceID)
	}
	if r.Method == http.MethodGet && resourceActionPath(path, "services", "tasks") {
		parts, ok := splitResourcePath(path, "services")
		if !ok || !swarmNamePattern.MatchString(parts[1]) {
			return errors.New("deployment-worker service identity is invalid")
		}
		return engine.authorizeResourceService(ctx, parts[1], resourceID)
	}
	if r.Method == http.MethodGet && resourceItemPath(path, "networks") {
		return authorizeDeploymentWorkerRawNetworkInspection(ctx, path, resourceID, engine)
	}
	if execPath(path, "json") || execPath(path, "start") || execPath(path, "resize") {
		return engine.authorizeResourceExec(ctx, path, resourceID)
	}
	if r.Method == http.MethodPost && resourceActionPath(path, "services", "update") {
		parts, ok := splitResourcePath(path, "services")
		if !ok || !swarmNamePattern.MatchString(parts[1]) {
			return errors.New("deployment-worker service identity is invalid")
		}
		if err := engine.authorizeResourceService(ctx, parts[1], resourceID); err != nil {
			return err
		}
		return authorizeDeploymentWorkerRawServiceResources(ctx, body, parts[1], resourceID, engine)
	}
	if r.Method == http.MethodPost && path == "/services/create" {
		return authorizeDeploymentWorkerRawServiceResources(ctx, body, "", resourceID, engine)
	}
	if isRawContainerResourcePath(r.Method, path) {
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

func isDeploymentWorkerGlobalInventoryPath(path string) bool {
	switch path {
	case "/info", "/images/json", "/nodes", "/system/df", "/volumes":
		return true
	default:
		return false
	}
}

func authorizeDeploymentWorkerRawContainerResources(
	ctx context.Context,
	body []byte,
	resourceID string,
	engine *dockerEngineClient,
) error {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return fmt.Errorf("container create payload is invalid: %w", err)
	}

	// A resource container must explicitly attach to an Upstand-managed
	// network. The only networkless exceptions are the Docker API's explicit
	// network-disabled and `none` modes; otherwise Docker would silently place
	// a raw worker-created container on the daemon's default bridge.
	hostConfig, _ := dockerObjectField(payload, "HostConfig")
	hostConfigObject, _ := hostConfig.(map[string]any)
	networkMode := strings.ToLower(dockerStringField(hostConfigObject, "NetworkMode"))
	networkDisabled, _ := dockerObjectField(payload, "NetworkDisabled")
	if disabled, ok := networkDisabled.(bool); ok && disabled {
		if _, hasNetworkingConfig := dockerObjectField(payload, "NetworkingConfig"); hasNetworkingConfig {
			return errors.New("network-disabled container cannot declare network endpoints")
		}
		return nil
	}

	networkingConfig, hasNetworkingConfig := dockerObjectField(payload, "NetworkingConfig")
	if !hasNetworkingConfig {
		if networkMode == "none" {
			return nil
		}
		return errors.New("resource container create requires an explicit managed network")
	}
	networkingConfigObject, ok := networkingConfig.(map[string]any)
	if !ok {
		return errors.New("container NetworkingConfig is not an object")
	}
	endpoints, hasEndpoints := dockerObjectField(networkingConfigObject, "EndpointsConfig")
	if !hasEndpoints {
		if networkMode == "none" {
			return nil
		}
		return errors.New("resource container create requires managed network endpoints")
	}
	endpointMap, ok := endpoints.(map[string]any)
	if !ok || len(endpointMap) == 0 || len(endpointMap) > 32 {
		return errors.New("container network endpoints are invalid or unbounded")
	}
	if networkMode == "none" {
		return errors.New("network-disabled container cannot declare network endpoints")
	}
	for networkTarget, rawEndpoint := range endpointMap {
		if !swarmNamePattern.MatchString(strings.TrimSpace(networkTarget)) {
			return errors.New("container network identity is invalid")
		}
		if rawEndpoint != nil {
			if _, ok := rawEndpoint.(map[string]any); !ok {
				return errors.New("container network endpoint is invalid")
			}
		}
		networkBody, _, err := engine.request(
			ctx,
			http.MethodGet,
			"/networks/"+url.PathEscape(strings.TrimSpace(networkTarget)),
			nil,
		)
		if err != nil {
			return fmt.Errorf("container network %q could not be inspected: %w", networkTarget, err)
		}
		var network struct {
			ID     string            `json:"Id"`
			Name   string            `json:"Name"`
			Labels map[string]string `json:"Labels"`
		}
		if err := json.Unmarshal(networkBody, &network); err != nil {
			return fmt.Errorf("container network %q inspection is invalid: %w", networkTarget, err)
		}
		if network.ID == "" || network.Name == "" {
			return fmt.Errorf("container network %q inspection is incomplete", networkTarget)
		}
		if network.Name != strings.TrimSpace(networkTarget) {
			return fmt.Errorf("container network %q identity does not match the request", networkTarget)
		}
		if err := validateManagedSwarmNetwork(networkBody); err != nil {
			return fmt.Errorf("container network %q is not an encrypted attachable network: %w", networkTarget, err)
		}
		if !isAuthorizedDeploymentWorkerNetwork(network.Name, network.Labels, resourceID) {
			return fmt.Errorf("container network %q is not owned by the requested Upstand resource", networkTarget)
		}
	}
	return nil
}

func authorizeDeploymentWorkerRawVolumeInspection(
	ctx context.Context,
	path string,
	resourceID string,
	engine *dockerEngineClient,
) error {
	parts, ok := splitResourcePath(path, "volumes")
	if !ok || !deploymentWorkerVolumeNamePattern.MatchString(parts[1]) {
		return errors.New("deployment-worker volume identity is invalid")
	}

	body, _, err := engine.request(ctx, http.MethodGet, "/volumes/"+url.PathEscape(parts[1]), nil)
	if err != nil {
		return err
	}
	var inspection struct {
		Name    string            `json:"Name"`
		Driver  string            `json:"Driver"`
		Options map[string]string `json:"Options"`
		Labels  map[string]string `json:"Labels"`
	}
	if err := json.Unmarshal(body, &inspection); err != nil {
		return fmt.Errorf("invalid Docker volume inspection: %w", err)
	}
	if inspection.Name == "" || inspection.Name != parts[1] {
		return errors.New("Docker volume inspection has no matching identity")
	}
	if inspection.Driver != "local" || len(inspection.Options) != 0 {
		return errors.New("Docker volume is not an unconfigured local volume")
	}
	if !isDeploymentWorkerOwnedVolume(inspection.Name, resourceID) {
		return errors.New("Docker volume is not owned by the requested Upstand resource")
	}

	// Database volumes predate the typed resource-volume path and are identified
	// by their exact resource-bound name. Compose volumes are newer and must
	// also carry the managed labels checked by the typed volume provisioner.
	if inspection.Name == "upstand-db-data-"+resourceID {
		return nil
	}
	if inspection.Labels["com.upstand.managed"] != "true" ||
		inspection.Labels["com.upstand.purpose"] != "resource-isolation" ||
		inspection.Labels["com.upstand.resource-id"] != resourceID {
		return errors.New("Docker volume is missing the managed resource ownership labels")
	}
	return nil
}

func authorizeDeploymentWorkerRawContainerList(r *http.Request, resourceID string) error {
	return authorizeDeploymentWorkerRawResourceList(r, resourceID, "containers")
}

func authorizeDeploymentWorkerRawResourceList(r *http.Request, resourceID, resource string) error {
	values, ok := r.URL.Query()["filters"]
	if !ok || len(values) != 1 || len(values[0]) == 0 || len(values[0]) > maxPolicyBody {
		return fmt.Errorf("deployment-worker %s listing requires one bounded resource filter", resource)
	}

	var filters map[string]json.RawMessage
	if err := json.Unmarshal([]byte(values[0]), &filters); err != nil {
		return fmt.Errorf("deployment-worker %s listing filters are invalid: %w", resource, err)
	}
	rawLabels, ok := filters["label"]
	if !ok {
		return fmt.Errorf("deployment-worker %s listing requires a label filter", resource)
	}
	var labels []string
	if err := json.Unmarshal(rawLabels, &labels); err != nil || len(labels) == 0 || len(labels) > 32 {
		return fmt.Errorf("deployment-worker %s listing labels are invalid or unbounded", resource)
	}
	required := "com.upstand.resource-id=" + resourceID
	for _, label := range labels {
		if label == required {
			return nil
		}
	}
	return fmt.Errorf("deployment-worker %s listing must include the exact resource ownership label", resource)
}

func authorizeDeploymentWorkerRawTaskList(
	ctx context.Context,
	r *http.Request,
	resourceID string,
	engine *dockerEngineClient,
) error {
	values, ok := r.URL.Query()["filters"]
	if !ok || len(values) != 1 || len(values[0]) == 0 || len(values[0]) > maxPolicyBody {
		return errors.New("deployment-worker task listing requires one bounded service filter")
	}

	var filters map[string]json.RawMessage
	if err := json.Unmarshal([]byte(values[0]), &filters); err != nil {
		return fmt.Errorf("deployment-worker task listing filters are invalid: %w", err)
	}
	rawServices, ok := filters["service"]
	if !ok {
		return errors.New("deployment-worker task listing requires a service filter")
	}
	var services []string
	if err := json.Unmarshal(rawServices, &services); err != nil || len(services) != 1 || !swarmNamePattern.MatchString(services[0]) {
		return errors.New("deployment-worker task listing service filter is invalid or unbounded")
	}
	return engine.authorizeResourceService(ctx, services[0], resourceID)
}

func authorizeDeploymentWorkerRawNetworkInspection(
	ctx context.Context,
	path string,
	resourceID string,
	engine *dockerEngineClient,
) error {
	parts, ok := splitResourcePath(path, "networks")
	if !ok || !swarmNamePattern.MatchString(parts[1]) {
		return errors.New("deployment-worker network identity is invalid")
	}
	body, _, err := engine.request(ctx, http.MethodGet, "/networks/"+url.PathEscape(parts[1]), nil)
	if err != nil {
		return err
	}
	var network struct {
		ID     string            `json:"Id"`
		Name   string            `json:"Name"`
		Labels map[string]string `json:"Labels"`
	}
	if err := json.Unmarshal(body, &network); err != nil {
		return fmt.Errorf("invalid Docker network inspection: %w", err)
	}
	if network.ID == "" || network.Name == "" {
		return errors.New("Docker network inspection is missing its identity")
	}
	if err := validateManagedSwarmNetwork(body); err != nil {
		return fmt.Errorf("Docker network is not a managed encrypted Swarm network: %w", err)
	}
	if !isAuthorizedDeploymentWorkerNetwork(network.Name, network.Labels, resourceID) {
		return errors.New("Docker network is not owned by the requested Upstand resource")
	}
	return nil
}

func (engine *dockerEngineClient) authorizeResourceExec(ctx context.Context, path, resourceID string) error {
	parts, ok := splitResourcePath(path, "exec")
	if !ok || !swarmNamePattern.MatchString(parts[1]) {
		return errors.New("deployment-worker exec identity is invalid")
	}
	body, _, err := engine.request(ctx, http.MethodGet, "/exec/"+url.PathEscape(parts[1])+"/json", nil)
	if err != nil {
		return err
	}
	var inspection struct {
		ContainerID string `json:"ContainerID"`
	}
	if err := json.Unmarshal(body, &inspection); err != nil {
		return fmt.Errorf("invalid Docker exec inspection: %w", err)
	}
	if !swarmNamePattern.MatchString(inspection.ContainerID) {
		return errors.New("Docker exec inspection has no valid container identity")
	}
	return engine.authorizeResourceContainer(ctx, inspection.ContainerID, resourceID)
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

// authorizeDeploymentWorkerRawServiceResources prevents a resource-scoped
// worker from using the broad Engine service API to attach a service to an
// unrelated network or mount an unrelated Swarm secret/config. Compose/Swarm
// supplies all of these references in TaskTemplate; the broker must verify
// live daemon metadata instead of trusting caller-controlled IDs or names.
func authorizeDeploymentWorkerRawServiceResources(
	ctx context.Context,
	body []byte,
	serviceID string,
	resourceID string,
	engine *dockerEngineClient,
) error {
	if serviceID != "" {
		serviceBody, _, err := engine.request(ctx, http.MethodGet, "/services/"+url.PathEscape(serviceID), nil)
		if err != nil {
			return err
		}
		if err := authorizeServiceResourcePayload(ctx, serviceBody, resourceID, engine); err != nil {
			return fmt.Errorf("existing Docker service resource policy failed: %w", err)
		}
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return errors.New("deployment-worker service mutation requires a JSON body")
	}
	if err := authorizeServiceResourcePayload(ctx, body, resourceID, engine); err != nil {
		return fmt.Errorf("requested Docker service resource policy failed: %w", err)
	}
	return nil
}

func authorizeServiceResourcePayload(
	ctx context.Context,
	body []byte,
	resourceID string,
	engine *dockerEngineClient,
) error {
	if err := authorizeServiceNetworkPayload(ctx, body, resourceID, engine); err != nil {
		return err
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return fmt.Errorf("service payload is invalid: %w", err)
	}
	payload = dockerServiceSpecPayload(payload)
	taskTemplate, hasTaskTemplate := dockerObjectField(payload, "TaskTemplate")
	if !hasTaskTemplate {
		return nil
	}
	taskTemplateObject, ok := taskTemplate.(map[string]any)
	if !ok {
		return errors.New("service TaskTemplate is not an object")
	}
	if err := authorizeServiceFileBackedPayload(ctx, taskTemplateObject, resourceID, engine); err != nil {
		return err
	}
	return authorizeServiceVolumePayload(ctx, taskTemplateObject, resourceID, engine)
}

// authorizeServiceVolumePayload verifies the live Docker metadata for every
// named volume used by a raw service mutation. A caller-controlled name prefix
// is not sufficient: a pre-existing volume with that name could have been
// created with a host-backed driver or hostile options. Re-inspect the daemon
// object immediately before forwarding the service mutation and apply the
// same ownership policy used by the typed resource-volume route.
func authorizeServiceVolumePayload(
	ctx context.Context,
	taskTemplateObject map[string]any,
	resourceID string,
	engine *dockerEngineClient,
) error {
	containerSpec, ok := dockerObjectField(taskTemplateObject, "ContainerSpec")
	if !ok {
		return nil
	}
	containerSpecObject, ok := containerSpec.(map[string]any)
	if !ok {
		return errors.New("service ContainerSpec is not an object")
	}
	rawMounts, ok := dockerObjectField(containerSpecObject, "Mounts")
	if !ok {
		return nil
	}
	mounts, ok := rawMounts.([]any)
	if !ok || len(mounts) > 64 {
		return errors.New("service volume mounts are invalid or unbounded")
	}
	for index, rawMount := range mounts {
		mount, ok := rawMount.(map[string]any)
		if !ok {
			return fmt.Errorf("service volume mount %d is invalid", index)
		}
		mountType := strings.ToLower(dockerStringField(mount, "Type"))
		source := dockerStringField(mount, "Source")
		if mountType != "volume" || !deploymentWorkerVolumeNamePattern.MatchString(source) || !isDeploymentWorkerOwnedVolume(source, resourceID) {
			return fmt.Errorf("service volume mount %d must reference a resource-owned named volume", index)
		}
		if err := authorizeDeploymentWorkerRawVolumeInspection(
			ctx,
			"/volumes/"+url.PathEscape(source),
			resourceID,
			engine,
		); err != nil {
			return fmt.Errorf("service volume mount %d failed live ownership verification: %w", index, err)
		}
	}
	return nil
}

func authorizeServiceFileBackedPayload(
	ctx context.Context,
	taskTemplateObject map[string]any,
	resourceID string,
	engine *dockerEngineClient,
) error {
	containerSpec, hasContainerSpec := dockerObjectField(taskTemplateObject, "ContainerSpec")
	if !hasContainerSpec {
		return nil
	}
	containerSpecObject, ok := containerSpec.(map[string]any)
	if !ok {
		return errors.New("service ContainerSpec is not an object")
	}
	for _, kind := range []string{"Secrets", "Configs"} {
		if err := authorizeServiceFileBackedReferences(ctx, containerSpecObject, kind, resourceID, engine); err != nil {
			return err
		}
	}
	return nil
}

func authorizeServiceFileBackedReferences(
	ctx context.Context,
	containerSpec map[string]any,
	kind string,
	resourceID string,
	engine *dockerEngineClient,
) error {
	rawReferences, ok := dockerObjectField(containerSpec, kind)
	if !ok {
		return nil
	}
	references, ok := rawReferences.([]any)
	if !ok || len(references) > 32 {
		return fmt.Errorf("service %s references are invalid or unbounded", strings.ToLower(kind))
	}

	objectKind := strings.TrimSuffix(strings.ToLower(kind), "s")
	for index, rawReference := range references {
		reference, ok := rawReference.(map[string]any)
		if !ok {
			return fmt.Errorf("service %s reference %d is invalid", strings.ToLower(kind), index)
		}
		idField := objectKind + "ID"
		nameField := objectKind + "Name"
		objectID := dockerStringField(reference, idField)
		objectName := dockerStringField(reference, nameField)
		if objectID == "" && objectName == "" {
			return fmt.Errorf("service %s reference %d has no identity", strings.ToLower(kind), index)
		}
		lookup := objectID
		if lookup == "" {
			lookup = objectName
		}
		if len(lookup) > 256 || strings.ContainsAny(lookup, "/\x00\r\n") {
			return fmt.Errorf("service %s reference %d has an invalid identity", strings.ToLower(kind), index)
		}

		body, _, err := engine.request(ctx, http.MethodGet, "/"+objectKind+"s/"+url.PathEscape(lookup), nil)
		if err != nil {
			return fmt.Errorf("service %s reference %d could not be inspected: %w", strings.ToLower(kind), index, err)
		}
		var inspection struct {
			ID   string `json:"ID"`
			Spec struct {
				Name   string            `json:"Name"`
				Labels map[string]string `json:"Labels"`
			} `json:"Spec"`
		}
		if err := json.Unmarshal(body, &inspection); err != nil {
			return fmt.Errorf("service %s reference %d inspection is invalid: %w", strings.ToLower(kind), index, err)
		}
		if inspection.ID == "" || inspection.Spec.Name == "" {
			return fmt.Errorf("service %s reference %d inspection is incomplete", strings.ToLower(kind), index)
		}
		if objectName != "" && objectName != inspection.Spec.Name {
			return fmt.Errorf("service %s reference %d name does not match daemon identity", strings.ToLower(kind), index)
		}
		expectedPrefix := "upstand-resource-" + strings.ToLower(resourceID) + "-" + objectKind + "-"
		if inspection.Spec.Labels["com.upstand.resource-id"] != resourceID &&
			!strings.HasPrefix(strings.ToLower(inspection.Spec.Name), expectedPrefix) {
			return fmt.Errorf("service %s reference %d is not owned by the requested Upstand resource", strings.ToLower(kind), index)
		}
	}
	return nil
}

func dockerStringField(object map[string]any, wanted string) string {
	value, ok := dockerObjectField(object, wanted)
	if !ok {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func authorizeServiceNetworkPayload(
	ctx context.Context,
	body []byte,
	resourceID string,
	engine *dockerEngineClient,
) error {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return fmt.Errorf("service payload is invalid: %w", err)
	}
	payload = dockerServiceSpecPayload(payload)
	taskTemplate, hasTaskTemplate := dockerObjectField(payload, "TaskTemplate")
	if hasTaskTemplate {
		taskTemplateObject, ok := taskTemplate.(map[string]any)
		if !ok {
			return errors.New("service TaskTemplate is not an object")
		}
		if err := authorizeServiceNetworkList(ctx, taskTemplateObject, resourceID, engine); err != nil {
			return err
		}
	}
	return authorizeServiceNetworkList(ctx, payload, resourceID, engine)
}

func dockerServiceSpecPayload(payload map[string]any) map[string]any {
	spec, ok := dockerObjectField(payload, "Spec")
	if !ok {
		return payload
	}
	specObject, ok := spec.(map[string]any)
	if !ok {
		return payload
	}
	return specObject
}

func authorizeServiceNetworkList(
	ctx context.Context,
	payload map[string]any,
	resourceID string,
	engine *dockerEngineClient,
) error {
	rawNetworks, ok := dockerObjectField(payload, "Networks")
	if !ok {
		return nil
	}
	networks, ok := rawNetworks.([]any)
	if !ok || len(networks) > 32 {
		return errors.New("service network attachments are invalid or unbounded")
	}
	for index, rawNetwork := range networks {
		networkObject, ok := rawNetwork.(map[string]any)
		if !ok {
			return fmt.Errorf("service network attachment %d is invalid", index)
		}
		target, ok := dockerObjectField(networkObject, "Target")
		targetName, validTarget := target.(string)
		if !validTarget || !swarmNamePattern.MatchString(strings.TrimSpace(targetName)) {
			return fmt.Errorf("service network attachment %d has an invalid target", index)
		}
		networkBody, _, err := engine.request(ctx, http.MethodGet, "/networks/"+url.PathEscape(strings.TrimSpace(targetName)), nil)
		if err != nil {
			return fmt.Errorf("service network attachment %d could not be inspected: %w", index, err)
		}
		var network struct {
			ID     string            `json:"Id"`
			Name   string            `json:"Name"`
			Labels map[string]string `json:"Labels"`
		}
		if err := json.Unmarshal(networkBody, &network); err != nil {
			return fmt.Errorf("service network attachment %d inspection is invalid: %w", index, err)
		}
		if network.ID == "" || network.Name == "" {
			return fmt.Errorf("service network attachment %d inspection is incomplete", index)
		}
		if err := validateManagedSwarmNetwork(networkBody); err != nil {
			return fmt.Errorf("service network attachment %d is not encrypted and attachable: %w", index, err)
		}
		if !isAuthorizedDeploymentWorkerNetwork(network.Name, network.Labels, resourceID) {
			return fmt.Errorf("service network attachment %d is not owned by the requested Upstand resource", index)
		}
	}
	return nil
}

func dockerObjectField(object map[string]any, wanted string) (any, bool) {
	for key, value := range object {
		if strings.EqualFold(strings.TrimSpace(key), wanted) {
			return value, true
		}
	}
	return nil, false
}

func isRawContainerResourcePath(method, path string) bool {
	return (method == http.MethodDelete && containerPath(path, "")) ||
		(method == http.MethodGet && (containerPath(path, "") || containerActionPath(path, "json") ||
			containerActionPath(path, "logs") || containerActionPath(path, "changes") ||
			containerActionPath(path, "stats") || containerActionPath(path, "top"))) ||
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
