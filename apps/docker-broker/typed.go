package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	typedBrokerPrefix       = "/upstand/v1/web-server/"
	typedServerPrefix       = "/upstand/v1/server/"
	maxTypedResponseBytes   = 8 << 20
	maxTypedLogTail         = 1000
	maxTypedCommandPassword = 512
)

var managedWebServerServicePattern = regexp.MustCompile(`^upstand_(server|redis)$`)
var managedNetworkPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
var selfUpdateVersionPattern = regexp.MustCompile(`^(?:v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?|canary)$`)
var selfUpdateDigestPattern = regexp.MustCompile(`^sha256:[a-fA-F0-9]{64}$`)
var selfUpdateRepositoryPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
var swarmNodeIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)
var swarmNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
var swarmAddressPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,255}$`)
var swarmRolePattern = regexp.MustCompile(`^(manager|worker)$`)
var swarmAvailabilityPattern = regexp.MustCompile(`^(active|drain|pause)$`)
var swarmOperationPattern = regexp.MustCompile(`^(info|inspect|list_nodes|list_services|list_tasks|initialize|update|inspect_node|update_node|remove_node|ensure_network)$`)

type typedServiceRequest struct {
	ServiceName string `json:"service_name"`
}

type typedServiceLogsRequest struct {
	ServiceName string `json:"service_name"`
	Tail        int    `json:"tail"`
}

type typedServiceCommandRequest struct {
	ServiceName string   `json:"service_name"`
	Command     []string `json:"command"`
}

type typedCleanupRequest struct {
	Command                string `json:"command"`
	PreserveRollbackImages *bool  `json:"preserve_rollback_images,omitempty"`
	PruneNetworks          bool   `json:"prune_networks,omitempty"`
}

type typedSelfUpdateRequest struct {
	Version    string `json:"version"`
	Repository string `json:"repository"`
	Images     struct {
		Server     string `json:"server"`
		Schedules  string `json:"schedules"`
		Web        string `json:"web"`
		Fumadocs   string `json:"fumadocs"`
		Monitoring string `json:"monitoring"`
	} `json:"images"`
}

type typedSwarmRequest struct {
	Operation                 string            `json:"operation"`
	AdvertiseAddr             string            `json:"advertise_addr,omitempty"`
	DataPathAddr              string            `json:"data_path_addr,omitempty"`
	DefaultAddrPools          []string          `json:"default_addr_pools,omitempty"`
	SubnetSize                int               `json:"subnet_size,omitempty"`
	Version                   uint64            `json:"version,omitempty"`
	TaskHistoryRetentionLimit *int              `json:"task_history_retention_limit,omitempty"`
	RotateWorkerToken         bool              `json:"rotate_worker_token,omitempty"`
	RotateManagerToken        bool              `json:"rotate_manager_token,omitempty"`
	NodeID                    string            `json:"node_id,omitempty"`
	Force                     bool              `json:"force,omitempty"`
	Name                      string            `json:"name,omitempty"`
	Labels                    map[string]string `json:"labels,omitempty"`
	Role                      string            `json:"role,omitempty"`
	Availability              string            `json:"availability,omitempty"`
	NetworkName               string            `json:"network_name,omitempty"`
}

type typedDockerResponse struct {
	Logs         string `json:"logs,omitempty"`
	Driver       string `json:"driver,omitempty"`
	Attachable   bool   `json:"attachable,omitempty"`
	UpdatedCount int    `json:"updated_count"`
	Changed      bool   `json:"changed"`
}

const typedSwarmPath = typedServerPrefix + `swarm`

type dockerEngineClient struct {
	httpClient *http.Client
}

func isTypedDockerPath(path string) bool {
	switch path {
	case typedBrokerPrefix + `service-update`,
		typedBrokerPrefix + `service-logs`,
		typedBrokerPrefix + `service-command`,
		typedCaddyPath,
		typedCaddyConfigurationPath:
		return true
	default:
		return path == typedBrokerPrefix+`network` ||
			path == typedServerPrefix+`cleanup` ||
			path == typedServerPrefix+`self-update` ||
			path == typedServerPrefix+`swarm` ||
			path == typedServerPrefix+`inventory` ||
			path == typedResourcePullPath ||
			path == typedResourceNetworkPath ||
			path == typedResourceVolumePath ||
			path == typedResourceTeardownPath ||
			path == typedResourceBuildPath ||
			path == typedResourcePushPath ||
			path == typedResourceFilesPath ||
			path == typedResourceCommandPath ||
			path == typedResourceServicePath ||
			path == typedResourceConvergencePath
	}
}

func authorizeTypedDockerRequest(caller string, r *http.Request, body []byte) error {
	path := normalizeDockerPath(r.URL.Path)
	if path == typedServerPrefix+`swarm` && caller == `deployment-worker` {
		if r.Method != http.MethodPost {
			return errors.New(`typed Swarm operations require POST`)
		}
		var input typedSwarmRequest
		if err := decodeTypedJSON(body, &input); err != nil {
			return err
		}
		if input.Operation != `ensure_network` {
			return errors.New(`deployment-worker may only ensure the shared Upstand network`)
		}
		if err := validateTypedSwarmFieldSet(body, input.Operation); err != nil {
			return err
		}
		if err := validateTypedSwarmRequest(input); err != nil {
			return err
		}
		if input.NetworkName != configuredSharedNetworkName() {
			return errors.New(`deployment-worker may only ensure the configured shared Upstand network`)
		}
		return nil
	}
	if path == typedResourceCommandPath {
		if caller != `server` && caller != `schedules` && caller != `deployment-worker` {
			return errors.New(`typed resource command is reserved for server, schedules, and deployment-worker callers`)
		}
		if r.Method != http.MethodPost {
			return errors.New(`typed resource command operations require POST`)
		}
		_, err := validateTypedResourceCommandRequest(body)
		return err
	}
	if path == typedResourceBuildPath {
		if caller != `server` && caller != `schedules` && caller != `deployment-worker` {
			return errors.New(`typed resource build is reserved for server, schedules, and deployment-worker callers`)
		}
		if r.Method != http.MethodPost {
			return errors.New(`typed resource build operations require POST`)
		}
		_, err := validateTypedResourceBuildHeaders(r.Header)
		return err
	}
	if path == typedResourcePullPath {
		if caller != `server` && caller != `schedules` && caller != `deployment-worker` {
			return errors.New(`typed resource pull is reserved for server, schedules, and deployment-worker callers`)
		}
		if r.Method != http.MethodPost {
			return errors.New(`typed resource pull operations require POST`)
		}
		if err := rejectHostEscapeJSON(body); err != nil {
			return err
		}
		if _, err := validateTypedResourcePullRequest(body); err != nil {
			return err
		}
		_, err := validateTypedResourceServiceRegistryAuth(
			r.Header.Get(`X-Upstand-Registry-Auth`),
		)
		return err
	}
	if path == typedResourcePushPath {
		if caller != `server` && caller != `schedules` && caller != `deployment-worker` {
			return errors.New(`typed resource push is reserved for server, schedules, and deployment-worker callers`)
		}
		if r.Method != http.MethodPost {
			return errors.New(`typed resource push operations require POST`)
		}
		if err := rejectHostEscapeJSON(body); err != nil {
			return err
		}
		if _, err := validateTypedResourcePushRequest(body); err != nil {
			return err
		}
		registryAuth, err := validateTypedResourceServiceRegistryAuth(
			r.Header.Get(`X-Upstand-Registry-Auth`),
		)
		if err != nil {
			return err
		}
		if registryAuth == `` {
			return errors.New(`typed resource push requires registry authentication`)
		}
		return nil
	}
	if path == typedResourceServicePath {
		if caller != `server` && caller != `schedules` && caller != `deployment-worker` {
			return errors.New(`typed resource service is reserved for server, schedules, and deployment-worker callers`)
		}
		if r.Method != http.MethodPost {
			return errors.New(`typed resource service operations require POST`)
		}
		if err := rejectHostEscapeJSON(body); err != nil {
			return err
		}
		input, err := validateTypedResourceServiceRequest(body)
		if err != nil {
			return err
		}
		registryAuth, err := validateTypedResourceServiceRegistryAuth(
			r.Header.Get(`X-Upstand-Registry-Auth`),
		)
		if err != nil {
			return err
		}
		if input.Operation != `upsert` && registryAuth != `` {
			return errors.New(`typed registry authentication is only valid for service upsert`)
		}
		return nil
	}
	if path == typedResourceNetworkPath {
		if caller != `server` && caller != `schedules` && caller != `deployment-worker` {
			return errors.New(`typed resource network is reserved for server, schedules, and deployment-worker callers`)
		}
		if r.Method != http.MethodPost {
			return errors.New(`typed resource network operations require POST`)
		}
		_, err := validateTypedResourceNetworkRequest(body)
		return err
	}
	if path == typedResourceVolumePath {
		if caller != `server` && caller != `schedules` && caller != `deployment-worker` {
			return errors.New(`typed resource volume is reserved for server, schedules, and deployment-worker callers`)
		}
		if r.Method != http.MethodPost {
			return errors.New(`typed resource volume operations require POST`)
		}
		_, err := validateTypedResourceVolumeRequest(body)
		return err
	}
	if path == typedResourceTeardownPath {
		if caller != `server` && caller != `schedules` && caller != `deployment-worker` {
			return errors.New(`typed resource teardown is reserved for server, schedules, and deployment-worker callers`)
		}
		if r.Method != http.MethodPost {
			return errors.New(`typed resource teardown operations require POST`)
		}
		_, err := validateTypedResourceTeardownRequest(body)
		return err
	}
	if path == typedResourceConvergencePath {
		if caller != `server` && caller != `schedules` && caller != `deployment-worker` {
			return errors.New(`typed resource convergence is reserved for server, schedules, and deployment-worker callers`)
		}
		if r.Method != http.MethodPost {
			return errors.New(`typed resource convergence operations require POST`)
		}
		_, err := validateTypedResourceConvergenceRequest(body)
		return err
	}
	if caller != `server` {
		return errors.New(`typed web-server operations are reserved for the server caller`)
	}
	if path == typedBrokerPrefix+`network` {
		if r.Method != http.MethodGet {
			return errors.New(`typed network inspection requires GET`)
		}
		name := strings.TrimSpace(r.URL.Query().Get(`name`))
		if !managedNetworkPattern.MatchString(name) {
			return errors.New(`typed network inspection received an invalid network name`)
		}
		return nil
	}
	if path == typedServerPrefix+`cleanup` {
		if r.Method != http.MethodPost {
			return errors.New(`typed cleanup requires POST`)
		}
		var input typedCleanupRequest
		if err := decodeTypedJSON(body, &input); err != nil {
			return err
		}
		if !isAllowedTypedCleanup(input.Command) {
			return errors.New(`typed cleanup received an unsupported command`)
		}
		return nil
	}
	if path == typedServerPrefix+`self-update` {
		if r.Method != http.MethodPost {
			return errors.New(`typed self-update requires POST`)
		}
		var input typedSelfUpdateRequest
		if err := decodeTypedJSON(body, &input); err != nil {
			return err
		}
		if !selfUpdateVersionPattern.MatchString(input.Version) ||
			!selfUpdateRepositoryPattern.MatchString(input.Repository) ||
			!selfUpdateDigestPattern.MatchString(input.Images.Server) ||
			!selfUpdateDigestPattern.MatchString(input.Images.Schedules) ||
			!selfUpdateDigestPattern.MatchString(input.Images.Web) ||
			!selfUpdateDigestPattern.MatchString(input.Images.Fumadocs) ||
			!selfUpdateDigestPattern.MatchString(input.Images.Monitoring) {
			return errors.New(`typed self-update requires a validated release version, repository, and image digests`)
		}
		return nil
	}
	if path == typedServerPrefix+`swarm` {
		if r.Method != http.MethodPost {
			return errors.New(`typed Swarm operations require POST`)
		}
		var input typedSwarmRequest
		if err := decodeTypedJSON(body, &input); err != nil {
			return err
		}
		if err := validateTypedSwarmFieldSet(body, input.Operation); err != nil {
			return err
		}
		return validateTypedSwarmRequest(input)
	}
	if path == typedServerPrefix+`inventory` {
		if r.Method != http.MethodPost {
			return errors.New(`typed inventory operations require POST`)
		}
		_, err := validateTypedInventoryRequest(body)
		return err
	}
	if path == typedResourceFilesPath {
		if r.Method != http.MethodPost {
			return errors.New(`typed resource file operations require POST`)
		}
		_, err := validateTypedResourceFileRequest(body)
		return err
	}
	if r.Method != http.MethodPost {
		return errors.New(`typed web-server operations require POST`)
	}
	switch path {
	case typedBrokerPrefix + `service-update`:
		var input typedServiceRequest
		if err := decodeTypedJSON(body, &input); err != nil {
			return err
		}
		if !managedWebServerServicePattern.MatchString(input.ServiceName) {
			return errors.New(`typed service update is limited to managed Upstand services`)
		}
	case typedBrokerPrefix + `service-logs`:
		var input typedServiceLogsRequest
		if err := decodeTypedJSON(body, &input); err != nil {
			return err
		}
		if input.ServiceName != `upstand_server` || input.Tail < 1 || input.Tail > maxTypedLogTail {
			return errors.New(`typed service logs are limited to the managed server service and bounded tail`)
		}
	case typedBrokerPrefix + `service-command`:
		var input typedServiceCommandRequest
		if err := decodeTypedJSON(body, &input); err != nil {
			return err
		}
		if input.ServiceName != `upstand_redis` || !isAllowedTypedRedisCommand(input.Command) {
			return errors.New(`typed service command is limited to the managed Redis flush operation`)
		}
	case typedCaddyPath:
		if r.Method != http.MethodPost {
			return errors.New(`typed Caddy provisioning requires POST`)
		}
		_, err := validateTypedCaddyRequest(body)
		return err
	case typedCaddyConfigurationPath:
		if r.Method != http.MethodPost {
			return errors.New(`typed Caddy configuration requires POST`)
		}
		_, err := validateTypedCaddyConfigurationRequest(body)
		return err
	default:
		return errors.New(`unknown typed Docker operation`)
	}
	return nil
}

func decodeTypedJSON(body []byte, target any) error {
	if len(bytes.TrimSpace(body)) == 0 {
		return errors.New(`typed Docker operation requires a JSON body`)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf(`invalid typed Docker operation body: %w`, err)
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return errors.New(`typed Docker operation body must contain exactly one JSON value`)
	}
	return nil
}

func isAllowedTypedRedisCommand(command []string) bool {
	if len(command) != 5 ||
		command[0] != `redis-cli` ||
		command[1] != `--no-auth-warning` ||
		command[2] != `-a` ||
		command[4] != `FLUSHALL` {
		return false
	}
	password := command[3]
	if password == `` || len(password) > maxTypedCommandPassword {
		return false
	}
	for _, r := range password {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func isAllowedTypedCleanup(command string) bool {
	switch command {
	case `images`, `volumes`, `containers`, `builder`, `system`, `all`:
		return true
	default:
		return false
	}
}

func validateTypedSwarmRequest(input typedSwarmRequest) error {
	if !swarmOperationPattern.MatchString(input.Operation) {
		return errors.New(`typed Swarm operation is not supported`)
	}
	switch input.Operation {
	case `info`, `inspect`, `list_nodes`, `list_services`, `list_tasks`:
		return nil
	case `initialize`:
		if !swarmAddressPattern.MatchString(input.AdvertiseAddr) ||
			(input.DataPathAddr != `` && !swarmAddressPattern.MatchString(input.DataPathAddr)) ||
			len(input.DefaultAddrPools) < 1 || len(input.DefaultAddrPools) > 8 ||
			input.SubnetSize < 16 || input.SubnetSize > 28 {
			return errors.New(`typed Swarm initialization contains invalid address settings`)
		}
		for _, pool := range input.DefaultAddrPools {
			if _, _, err := net.ParseCIDR(pool); err != nil {
				return errors.New(`typed Swarm initialization contains an invalid address pool`)
			}
		}
	case `update`:
		if input.Version == 0 ||
			(input.TaskHistoryRetentionLimit == nil && !input.RotateWorkerToken && !input.RotateManagerToken) {
			return errors.New(`typed Swarm update requires a version and a requested change`)
		}
		if input.TaskHistoryRetentionLimit != nil && (*input.TaskHistoryRetentionLimit < 0 || *input.TaskHistoryRetentionLimit > 100000) {
			return errors.New(`typed Swarm task history retention is out of bounds`)
		}
	case `inspect_node`:
		if !swarmNodeIDPattern.MatchString(input.NodeID) {
			return errors.New(`typed Swarm node ID is invalid`)
		}
	case `update_node`:
		if !swarmNodeIDPattern.MatchString(input.NodeID) || input.Version == 0 ||
			!swarmNamePattern.MatchString(input.Name) ||
			!swarmRolePattern.MatchString(input.Role) ||
			!swarmAvailabilityPattern.MatchString(input.Availability) ||
			len(input.Labels) > 64 {
			return errors.New(`typed Swarm node update contains invalid fields`)
		}
		for key, value := range input.Labels {
			if !isSafeSwarmLabel(key, 128) || !isSafeSwarmLabel(value, 256) {
				return errors.New(`typed Swarm node labels contain unsafe values`)
			}
		}
	case `remove_node`:
		if !swarmNodeIDPattern.MatchString(input.NodeID) {
			return errors.New(`typed Swarm node ID is invalid`)
		}
	case `ensure_network`:
		if !swarmNamePattern.MatchString(input.NetworkName) ||
			(!strings.HasPrefix(input.NetworkName, `upstand-`) && !strings.HasPrefix(input.NetworkName, `upstand_`)) {
			return errors.New(`typed Swarm network name is outside the managed namespace`)
		}
	}
	return nil
}

func configuredSharedNetworkName() string {
	name := strings.TrimSpace(os.Getenv(`UPSTAND_DOCKER_NETWORK`))
	if name == `` {
		return `upstand-network`
	}
	return name
}

func validateTypedSwarmFieldSet(body []byte, operation string) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return fmt.Errorf(`invalid typed Swarm body: %w`, err)
	}
	allowed := map[string]struct{}{`operation`: {}}
	for _, field := range func() []string {
		switch operation {
		case `initialize`:
			return []string{`advertise_addr`, `data_path_addr`, `default_addr_pools`, `subnet_size`}
		case `update`:
			return []string{`version`, `task_history_retention_limit`, `rotate_worker_token`, `rotate_manager_token`}
		case `inspect_node`, `remove_node`:
			return []string{`node_id`}
		case `update_node`:
			return []string{`node_id`, `version`, `name`, `labels`, `role`, `availability`}
		case `ensure_network`:
			return []string{`network_name`}
		default:
			return nil
		}
	}() {
		allowed[field] = struct{}{}
	}
	for field := range fields {
		if _, ok := allowed[field]; !ok {
			return fmt.Errorf(`typed Swarm operation %q does not accept field %q`, operation, field)
		}
	}
	return nil
}

func isSafeSwarmLabel(value string, maxLength int) bool {
	if value == `` || len(value) > maxLength {
		return false
	}
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}

func serveTypedDockerRequest(w http.ResponseWriter, r *http.Request, body []byte, socketPath string) int {
	engine := newDockerEngineClient(socketPath)
	var response typedDockerResponse
	var err error
	switch normalizeDockerPath(r.URL.Path) {
	case typedBrokerPrefix + `service-update`:
		err = engine.updateManagedService(r.Context(), body)
	case typedBrokerPrefix + `service-logs`:
		response.Logs, err = engine.serviceLogs(r.Context(), body)
	case typedBrokerPrefix + `service-command`:
		err = engine.runManagedServiceCommand(r.Context(), body)
	case typedCaddyPath:
		var input typedCaddyRequest
		input, err = validateTypedCaddyRequest(body)
		if err == nil {
			err = engine.ensureCaddyContainer(r.Context(), input)
		}
	case typedCaddyConfigurationPath:
		var input typedCaddyConfigurationRequest
		input, err = validateTypedCaddyConfigurationRequest(body)
		if err == nil {
			response.Changed, err = engine.applyTypedCaddyConfiguration(r.Context(), input)
		}
	case typedBrokerPrefix + `network`:
		response.Driver, response.Attachable, err = engine.inspectManagedNetwork(
			r.Context(),
			r.URL.Query().Get(`name`),
		)
	case typedServerPrefix + `cleanup`:
		err = engine.cleanupDocker(r.Context(), body)
	case typedServerPrefix + `self-update`:
		response.UpdatedCount, err = engine.applySelfUpdate(r.Context(), body)
	case typedSwarmPath:
		var payload any
		payload, err = engine.swarmOperation(r.Context(), body)
		if err == nil {
			w.Header().Set(`Content-Type`, `application/json`)
			if encodeErr := json.NewEncoder(w).Encode(payload); encodeErr != nil {
				return http.StatusInternalServerError
			}
			return http.StatusOK
		}
	case typedServerPrefix + `inventory`:
		var payload any
		payload, err = engine.inventoryOperation(r.Context(), body)
		if err == nil {
			w.Header().Set(`Content-Type`, `application/json`)
			if encodeErr := json.NewEncoder(w).Encode(payload); encodeErr != nil {
				return http.StatusInternalServerError
			}
			return http.StatusOK
		}
	case typedResourceFilesPath:
		var payload any
		payload, err = engine.resourceFileOperation(r.Context(), body)
		if err == nil {
			w.Header().Set(`Content-Type`, `application/json`)
			if encodeErr := json.NewEncoder(w).Encode(payload); encodeErr != nil {
				return http.StatusInternalServerError
			}
			return http.StatusOK
		}
	case typedResourceCommandPath:
		var payload typedResourceCommandResponse
		payload, err = engine.resourceCommandOperation(r.Context(), body)
		if err == nil {
			w.Header().Set(`Content-Type`, `application/json`)
			if encodeErr := json.NewEncoder(w).Encode(payload); encodeErr != nil {
				return http.StatusInternalServerError
			}
			return http.StatusOK
		}
	case typedResourceServicePath:
		err = engine.resourceServiceOperation(
			r.Context(),
			body,
			r.Header.Get(`X-Upstand-Registry-Auth`),
		)
	case typedResourceNetworkPath:
		var resourceNetworkResponse typedResourceNetworkResponse
		resourceNetworkResponse, err = engine.resourceNetworkOperation(r.Context(), body)
		if err == nil && resourceNetworkResponse.ID != `` {
			w.Header().Set(`Content-Type`, `application/json`)
			if encodeErr := json.NewEncoder(w).Encode(resourceNetworkResponse); encodeErr != nil {
				return http.StatusInternalServerError
			}
			return http.StatusOK
		}
	case typedResourceVolumePath:
		err = engine.resourceVolumeOperation(r.Context(), body)
	case typedResourceTeardownPath:
		err = engine.resourceTeardownOperation(r.Context(), body)
	case typedResourcePushPath:
		err = engine.resourcePushOperation(
			r.Context(),
			body,
			r.Header.Get(`X-Upstand-Registry-Auth`),
		)
	case typedResourcePullPath:
		err = engine.resourcePullOperation(
			r.Context(),
			body,
			r.Header.Get(`X-Upstand-Registry-Auth`),
		)
	case typedResourceConvergencePath:
		var payload typedResourceConvergenceResponse
		payload, err = engine.resourceConvergenceOperation(r.Context(), body)
		if err == nil {
			w.Header().Set(`Content-Type`, `application/json`)
			if encodeErr := json.NewEncoder(w).Encode(payload); encodeErr != nil {
				return http.StatusInternalServerError
			}
			return http.StatusOK
		}
	default:
		err = errors.New(`unknown typed Docker operation`)
	}
	if err != nil {
		log.Printf(`Docker broker typed operation failed: %v`, err)
		http.Error(w, `Docker typed operation failed`, http.StatusBadGateway)
		return http.StatusBadGateway
	}
	path := normalizeDockerPath(r.URL.Path)
	if path == typedBrokerPrefix+`service-update` || path == typedBrokerPrefix+`service-command` || path == typedCaddyPath || path == typedServerPrefix+`cleanup` || path == typedResourceServicePath || path == typedResourcePullPath || path == typedResourceNetworkPath || path == typedResourceVolumePath || path == typedResourceTeardownPath || path == typedResourcePushPath {
		w.WriteHeader(http.StatusNoContent)
		return http.StatusNoContent
	}
	w.Header().Set(`Content-Type`, `application/json`)
	if err := json.NewEncoder(w).Encode(response); err != nil {
		return http.StatusInternalServerError
	}
	return http.StatusOK
}

type typedSwarmInfoResponse struct {
	LocalNodeState   string `json:"localNodeState"`
	ControlAvailable bool   `json:"controlAvailable"`
	NodeID           string `json:"nodeId"`
	NodeAddress      string `json:"nodeAddress"`
	NodeCount        int    `json:"nodeCount"`
}

type typedSwarmInspectionResponse struct {
	ID                  string   `json:"id"`
	Version             uint64   `json:"version"`
	CreatedAt           *string  `json:"createdAt,omitempty"`
	UpdatedAt           *string  `json:"updatedAt,omitempty"`
	DataPathPort        *int     `json:"dataPathPort,omitempty"`
	DefaultAddressPools []string `json:"defaultAddressPools"`
	WorkerJoinToken     string   `json:"workerJoinToken,omitempty"`
	ManagerJoinToken    string   `json:"managerJoinToken,omitempty"`
}

type typedSwarmNodeResponse struct {
	ID            string            `json:"id"`
	Hostname      string            `json:"hostname"`
	Role          string            `json:"role"`
	Labels        map[string]string `json:"labels"`
	Availability  string            `json:"availability"`
	Status        string            `json:"status"`
	IP            string            `json:"ip"`
	EngineVersion string            `json:"engineVersion"`
	Version       uint64            `json:"version"`
	Leader        bool              `json:"leader"`
	ManagerAddr   string            `json:"managerAddr"`
	Reachability  string            `json:"reachability"`
	IsLocalNode   bool              `json:"isLocalNode"`
}

type typedSwarmServiceResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type typedSwarmTaskResponse struct {
	ID           string  `json:"id"`
	ServiceID    string  `json:"serviceId,omitempty"`
	NodeID       string  `json:"nodeId,omitempty"`
	Slot         int     `json:"slot"`
	DesiredState string  `json:"desiredState"`
	CurrentState string  `json:"currentState"`
	Message      string  `json:"message"`
	UpdatedAt    *string `json:"updatedAt,omitempty"`
	Image        string  `json:"image"`
}

func (engine *dockerEngineClient) swarmOperation(ctx context.Context, body []byte) (any, error) {
	var input typedSwarmRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return nil, err
	}
	if err := validateTypedSwarmFieldSet(body, input.Operation); err != nil {
		return nil, err
	}
	if err := validateTypedSwarmRequest(input); err != nil {
		return nil, err
	}
	switch input.Operation {
	case `info`:
		return engine.swarmInfo(ctx)
	case `inspect`:
		return engine.swarmInspect(ctx)
	case `list_nodes`:
		return engine.swarmNodes(ctx)
	case `list_services`:
		return engine.swarmServices(ctx)
	case `list_tasks`:
		return engine.swarmTasks(ctx)
	case `initialize`:
		return map[string]any{`success`: true}, engine.swarmInitialize(ctx, input)
	case `update`:
		return map[string]any{`success`: true}, engine.swarmUpdate(ctx, input)
	case `inspect_node`:
		return engine.swarmNode(ctx, input.NodeID)
	case `update_node`:
		return map[string]any{`success`: true}, engine.swarmUpdateNode(ctx, input)
	case `remove_node`:
		return map[string]any{`success`: true}, engine.swarmRemoveNode(ctx, input)
	case `ensure_network`:
		return engine.ensureManagedSwarmNetwork(ctx, input.NetworkName)
	default:
		return nil, errors.New(`typed Swarm operation was not mapped`)
	}
}

func (engine *dockerEngineClient) swarmInfo(ctx context.Context) (typedSwarmInfoResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/info`, nil)
	if err != nil {
		return typedSwarmInfoResponse{}, err
	}
	var info struct {
		Swarm struct {
			LocalNodeState   string `json:"LocalNodeState"`
			ControlAvailable bool   `json:"ControlAvailable"`
			NodeID           string `json:"NodeID"`
			NodeAddr         string `json:"NodeAddr"`
			Nodes            int    `json:"Nodes"`
		} `json:"Swarm"`
	}
	if err := json.Unmarshal(body, &info); err != nil {
		return typedSwarmInfoResponse{}, fmt.Errorf(`invalid Docker info response: %w`, err)
	}
	return typedSwarmInfoResponse{
		LocalNodeState:   info.Swarm.LocalNodeState,
		ControlAvailable: info.Swarm.ControlAvailable,
		NodeID:           info.Swarm.NodeID,
		NodeAddress:      info.Swarm.NodeAddr,
		NodeCount:        info.Swarm.Nodes,
	}, nil
}

func (engine *dockerEngineClient) swarmInspect(ctx context.Context) (typedSwarmInspectionResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/swarm`, nil)
	if err != nil {
		return typedSwarmInspectionResponse{}, err
	}
	var swarm struct {
		ID      string `json:"ID"`
		Version struct {
			Index uint64 `json:"Index"`
		} `json:"Version"`
		CreatedAt       string   `json:"CreatedAt"`
		UpdatedAt       string   `json:"UpdatedAt"`
		DataPathPort    int      `json:"DataPathPort"`
		DefaultAddrPool []string `json:"DefaultAddrPool"`
		JoinTokens      struct {
			Worker  string `json:"Worker"`
			Manager string `json:"Manager"`
		} `json:"JoinTokens"`
	}
	if err := json.Unmarshal(body, &swarm); err != nil {
		return typedSwarmInspectionResponse{}, fmt.Errorf(`invalid Docker Swarm response: %w`, err)
	}
	result := typedSwarmInspectionResponse{
		ID:                  swarm.ID,
		Version:             swarm.Version.Index,
		DefaultAddressPools: swarm.DefaultAddrPool,
		WorkerJoinToken:     swarm.JoinTokens.Worker,
		ManagerJoinToken:    swarm.JoinTokens.Manager,
	}
	if swarm.CreatedAt != `` {
		result.CreatedAt = &swarm.CreatedAt
	}
	if swarm.UpdatedAt != `` {
		result.UpdatedAt = &swarm.UpdatedAt
	}
	if swarm.DataPathPort != 0 {
		result.DataPathPort = &swarm.DataPathPort
	}
	return result, nil
}

func (engine *dockerEngineClient) swarmNodes(ctx context.Context) ([]typedSwarmNodeResponse, error) {
	info, err := engine.swarmInfo(ctx)
	if err != nil {
		return nil, err
	}
	if info.LocalNodeState != `active` {
		return []typedSwarmNodeResponse{}, nil
	}
	body, _, err := engine.request(ctx, http.MethodGet, `/nodes`, nil)
	if err != nil {
		return nil, err
	}
	var nodes []dockerSwarmNodePayload
	if err := json.Unmarshal(body, &nodes); err != nil {
		return nil, fmt.Errorf(`invalid Docker node list: %w`, err)
	}
	result := make([]typedSwarmNodeResponse, 0, len(nodes))
	for _, node := range nodes {
		result = append(result, node.toResponse(info.NodeID))
	}
	return result, nil
}

type dockerSwarmNodePayload struct {
	ID      string `json:"ID"`
	Version struct {
		Index uint64 `json:"Index"`
	} `json:"Version"`
	Description struct {
		Hostname string `json:"Hostname"`
		Engine   struct {
			EngineVersion string `json:"EngineVersion"`
		} `json:"Engine"`
	} `json:"Description"`
	Spec struct {
		Name         string            `json:"Name"`
		Role         string            `json:"Role"`
		Labels       map[string]string `json:"Labels"`
		Availability string            `json:"Availability"`
	} `json:"Spec"`
	Status struct {
		State string `json:"State"`
		Addr  string `json:"Addr"`
	} `json:"Status"`
	ManagerStatus struct {
		Leader       bool   `json:"Leader"`
		Addr         string `json:"Addr"`
		Reachability string `json:"Reachability"`
	} `json:"ManagerStatus"`
}

func (node dockerSwarmNodePayload) toResponse(localNodeID string) typedSwarmNodeResponse {
	hostname := node.Description.Hostname
	if hostname == `` {
		hostname = node.Spec.Name
	}
	if hostname == `` {
		hostname = node.ID
	}
	role := node.Spec.Role
	if role == `` {
		role = `worker`
	}
	availability := node.Spec.Availability
	if availability == `` {
		availability = `active`
	}
	status := node.Status.State
	if status == `` {
		status = `unknown`
	}
	engineVersion := node.Description.Engine.EngineVersion
	if engineVersion == `` {
		engineVersion = `unknown`
	}
	labels := node.Spec.Labels
	if labels == nil {
		labels = map[string]string{}
	}
	return typedSwarmNodeResponse{
		ID: node.ID, Hostname: hostname, Role: role, Labels: labels,
		Availability: availability, Status: status, IP: node.Status.Addr,
		EngineVersion: engineVersion, Version: node.Version.Index,
		Leader: node.ManagerStatus.Leader, ManagerAddr: node.ManagerStatus.Addr,
		Reachability: node.ManagerStatus.Reachability, IsLocalNode: node.ID == localNodeID,
	}
}

func (engine *dockerEngineClient) swarmNode(ctx context.Context, nodeID string) (typedSwarmNodeResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/nodes/`+url.PathEscape(nodeID), nil)
	if err != nil {
		return typedSwarmNodeResponse{}, err
	}
	var node dockerSwarmNodePayload
	if err := json.Unmarshal(body, &node); err != nil {
		return typedSwarmNodeResponse{}, fmt.Errorf(`invalid Docker node response: %w`, err)
	}
	info, err := engine.swarmInfo(ctx)
	if err != nil {
		return typedSwarmNodeResponse{}, err
	}
	return node.toResponse(info.NodeID), nil
}

func (engine *dockerEngineClient) swarmServices(ctx context.Context) ([]typedSwarmServiceResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/services`, nil)
	if err != nil {
		return nil, err
	}
	var services []struct {
		ID   string `json:"ID"`
		Spec struct {
			Name string `json:"Name"`
		} `json:"Spec"`
	}
	if err := json.Unmarshal(body, &services); err != nil {
		return nil, fmt.Errorf(`invalid Docker service list: %w`, err)
	}
	result := make([]typedSwarmServiceResponse, 0, len(services))
	for _, service := range services {
		result = append(result, typedSwarmServiceResponse{ID: service.ID, Name: service.Spec.Name})
	}
	return result, nil
}

func (engine *dockerEngineClient) swarmTasks(ctx context.Context) ([]typedSwarmTaskResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/tasks`, nil)
	if err != nil {
		return nil, err
	}
	var tasks []struct {
		ID           string `json:"ID"`
		ServiceID    string `json:"ServiceID"`
		NodeID       string `json:"NodeID"`
		Slot         int    `json:"Slot"`
		DesiredState string `json:"DesiredState"`
		Status       struct {
			State     string `json:"State"`
			Message   string `json:"Message"`
			Err       string `json:"Err"`
			Timestamp string `json:"Timestamp"`
		} `json:"Status"`
		Spec struct {
			ContainerSpec struct {
				Image string `json:"Image"`
			} `json:"ContainerSpec"`
		} `json:"Spec"`
	}
	if err := json.Unmarshal(body, &tasks); err != nil {
		return nil, fmt.Errorf(`invalid Docker task list: %w`, err)
	}
	result := make([]typedSwarmTaskResponse, 0, len(tasks))
	for _, task := range tasks {
		message := task.Status.Message
		if message == `` {
			message = task.Status.Err
		}
		currentState := task.Status.State
		if currentState == `` {
			currentState = `unknown`
		}
		desiredState := task.DesiredState
		if desiredState == `` {
			desiredState = `unknown`
		}
		item := typedSwarmTaskResponse{ID: task.ID, ServiceID: task.ServiceID, NodeID: task.NodeID, Slot: task.Slot, DesiredState: desiredState, CurrentState: currentState, Message: message, Image: task.Spec.ContainerSpec.Image}
		if task.Status.Timestamp != `` {
			item.UpdatedAt = &task.Status.Timestamp
		}
		if item.Image == `` {
			item.Image = `unknown`
		}
		result = append(result, item)
	}
	return result, nil
}

func (engine *dockerEngineClient) swarmInitialize(ctx context.Context, input typedSwarmRequest) error {
	payload := map[string]any{`AdvertiseAddr`: input.AdvertiseAddr, `ListenAddr`: `0.0.0.0:2377`, `DefaultAddrPool`: input.DefaultAddrPools, `SubnetSize`: input.SubnetSize}
	if input.DataPathAddr != `` {
		payload[`DataPathAddr`] = input.DataPathAddr
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, _, err = engine.request(ctx, http.MethodPost, `/swarm/init`, body)
	return err
}

func (engine *dockerEngineClient) swarmUpdate(ctx context.Context, input typedSwarmRequest) error {
	payload := map[string]any{}
	if input.TaskHistoryRetentionLimit != nil {
		payload[`Spec`] = map[string]any{`Orchestration`: map[string]any{`TaskHistoryRetentionLimit`: *input.TaskHistoryRetentionLimit}}
	}
	if input.RotateWorkerToken {
		payload[`RotateWorkerToken`] = true
	}
	if input.RotateManagerToken {
		payload[`RotateManagerToken`] = true
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, _, err = engine.request(ctx, http.MethodPost, `/swarm/update?version=`+strconv.FormatUint(input.Version, 10), body)
	return err
}

func (engine *dockerEngineClient) swarmUpdateNode(ctx context.Context, input typedSwarmRequest) error {
	body, err := json.Marshal(map[string]any{`Name`: input.Name, `Labels`: input.Labels, `Role`: input.Role, `Availability`: input.Availability})
	if err != nil {
		return err
	}
	_, _, err = engine.request(ctx, http.MethodPost, `/nodes/`+url.PathEscape(input.NodeID)+`/update?version=`+strconv.FormatUint(input.Version, 10), body)
	return err
}

func (engine *dockerEngineClient) swarmRemoveNode(ctx context.Context, input typedSwarmRequest) error {
	path := `/nodes/` + url.PathEscape(input.NodeID) + `?force=` + strconv.FormatBool(input.Force)
	_, _, err := engine.request(ctx, http.MethodDelete, path, nil)
	return err
}

func (engine *dockerEngineClient) ensureManagedSwarmNetwork(ctx context.Context, name string) (map[string]any, error) {
	body, status, err := engine.request(ctx, http.MethodGet, `/networks/`+url.PathEscape(name), nil)
	if err == nil && status >= 200 && status < 300 {
		if err := validateManagedSwarmNetwork(body); err != nil {
			return nil, err
		}
		var network struct {
			ID string `json:"Id"`
		}
		if err := json.Unmarshal(body, &network); err != nil {
			return nil, err
		}
		if network.ID == `` {
			return nil, errors.New(`managed Swarm network inspection returned no ID`)
		}
		return map[string]any{`id`: network.ID, `created`: false}, nil
	}
	if status != http.StatusNotFound {
		return nil, err
	}
	createBody, err := json.Marshal(map[string]any{
		`Name`: name, `Driver`: `overlay`, `Attachable`: true, `CheckDuplicate`: true,
		`Options`: map[string]string{`encrypted`: ``},
		`Labels`:  map[string]string{`com.upstand.managed`: `true`, `com.upstand.purpose`: `application-routing`},
	})
	if err != nil {
		return nil, err
	}
	createdBody, createdStatus, createErr := engine.request(ctx, http.MethodPost, `/networks/create`, createBody)
	if createErr != nil {
		if createdStatus != http.StatusConflict {
			return nil, createErr
		}
		body, _, inspectErr := engine.request(ctx, http.MethodGet, `/networks/`+url.PathEscape(name), nil)
		if inspectErr != nil {
			return nil, inspectErr
		}
		if inspectErr := validateManagedSwarmNetwork(body); inspectErr != nil {
			return nil, inspectErr
		}
		var network struct {
			ID string `json:"Id"`
		}
		if err := json.Unmarshal(body, &network); err != nil {
			return nil, err
		}
		if network.ID == `` {
			return nil, errors.New(`managed Swarm network inspection returned no ID`)
		}
		return map[string]any{`id`: network.ID, `created`: false}, nil
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal(createdBody, &created); err != nil {
		return nil, err
	}
	if created.ID == `` {
		return nil, errors.New(`managed Swarm network creation returned no ID`)
	}
	return map[string]any{`id`: created.ID, `created`: true}, nil
}

func validateManagedSwarmNetwork(body []byte) error {
	var network struct {
		Driver     string            `json:"Driver"`
		Scope      string            `json:"Scope"`
		Attachable bool              `json:"Attachable"`
		Options    map[string]string `json:"Options"`
	}
	if err := json.Unmarshal(body, &network); err != nil {
		return err
	}
	if network.Driver != `overlay` || network.Scope != `swarm` || !network.Attachable {
		return errors.New(`managed Swarm network is not an attachable overlay network`)
	}
	encrypted := false
	for option := range network.Options {
		if strings.EqualFold(option, `encrypted`) {
			encrypted = true
			break
		}
	}
	if !encrypted {
		return errors.New(`managed Swarm network is not encrypted`)
	}
	return nil
}

func (engine *dockerEngineClient) cleanupDocker(ctx context.Context, body []byte) error {
	var input typedCleanupRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return err
	}
	preserveRollbackImages := true
	if input.PreserveRollbackImages != nil {
		preserveRollbackImages = *input.PreserveRollbackImages
	}
	imageFilter := ``
	if preserveRollbackImages {
		imageFilter = `&filters=` + url.QueryEscape(`{"label":["com.upstand.rollback.keep!=true"]}`)
	}
	actions := map[string]string{
		`images`:     `/images/prune?all=1` + imageFilter,
		`volumes`:    `/volumes/prune`,
		`containers`: `/containers/prune`,
		`builder`:    `/build/prune?all=1`,
		`system`:     `/system/prune?all=1` + imageFilter,
	}
	commands := []string{input.Command}
	if input.Command == `all` {
		commands = []string{`containers`, `images`, `volumes`, `builder`, `system`}
		if input.PruneNetworks {
			commands = append(commands, `networks`)
		}
	}
	for _, command := range commands {
		if command == `networks` {
			if _, _, err := engine.request(ctx, http.MethodPost, `/networks/prune`, nil); err != nil {
				return err
			}
			continue
		}
		path, ok := actions[command]
		if !ok {
			return errors.New(`typed cleanup command was not mapped`)
		}
		if _, _, err := engine.request(ctx, http.MethodPost, path, nil); err != nil {
			return err
		}
	}
	return nil
}

var managedSelfUpdateServices = map[string]string{
	"upstand-server":    "server",
	"upstand-schedules": "schedules",
	"upstand-web":       "web",
	"upstand-fumadocs":  "fumadocs",
	"upstand_server":    "server",
	"upstand_schedules": "schedules",
	"upstand_web":       "web",
	"upstand_fumadocs":  "fumadocs",
}

func (engine *dockerEngineClient) applySelfUpdate(ctx context.Context, body []byte) (int, error) {
	var input typedSelfUpdateRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return 0, err
	}
	serviceBody, _, err := engine.request(ctx, http.MethodGet, `/services`, nil)
	if err != nil {
		return 0, err
	}
	var services []struct {
		ID      string `json:"ID"`
		Version struct {
			Index uint64 `json:"Index"`
		} `json:"Version"`
		Spec map[string]any `json:"Spec"`
	}
	if err := json.Unmarshal(serviceBody, &services); err != nil {
		return 0, fmt.Errorf(`invalid Docker service list: %w`, err)
	}
	updatedCount := 0
	for _, service := range services {
		if service.ID == `` || service.Version.Index == 0 || service.Spec == nil {
			continue
		}
		name, _ := service.Spec[`Name`].(string)
		imageName, managed := managedSelfUpdateServices[name]
		if !managed {
			continue
		}
		taskTemplate, ok := service.Spec[`TaskTemplate`].(map[string]any)
		if !ok {
			continue
		}
		containerSpec, ok := taskTemplate[`ContainerSpec`].(map[string]any)
		if !ok {
			continue
		}
		currentImage, _ := containerSpec[`Image`].(string)
		if currentImage == `` {
			continue
		}
		if strings.Contains(currentImage, `:source-`) {
			return 0, errors.New(`self-update is unavailable for source installations`)
		}
		baseImage := normalizeSelfUpdateImage(currentImage)
		if !strings.Contains(baseImage, `/`) || strings.HasPrefix(baseImage, `upstand-`) {
			baseImage = `ghcr.io/` + input.Repository + `-` + imageName
		}
		newImage := baseImage + `@` + selfUpdateDigest(input, imageName)
		envValues := []string{}
		if rawEnv, ok := containerSpec[`Env`].([]any); ok {
			for _, raw := range rawEnv {
				if value, ok := raw.(string); ok {
					envValues = append(envValues, value)
				}
			}
		}
		envValues = replaceSelfUpdateEnv(envValues, `UPSTAND_VERSION`, input.Version)
		envValues = replaceSelfUpdateEnv(envValues, `UPSTAND_UPDATE_COMPLETION_VERSION`, input.Version)
		if imageName == `server` {
			monitoringBaseImage := baseImage
			if strings.HasSuffix(baseImage, `-server`) {
				monitoringBaseImage = strings.TrimSuffix(baseImage, `-server`) + `-monitoring`
			}
			envValues = replaceSelfUpdateEnv(
				envValues,
				`UPSTAND_MONITORING_IMAGE`,
				monitoringBaseImage+`@`+input.Images.Monitoring,
			)
		}
		containerSpec[`Image`] = newImage
		containerSpec[`Env`] = envValues
		forceUpdate, _ := taskTemplate[`ForceUpdate`].(float64)
		taskTemplate[`ForceUpdate`] = forceUpdate + 1
		updateBody, err := json.Marshal(service.Spec)
		if err != nil {
			return 0, err
		}
		updatePath := `/services/` + url.PathEscape(service.ID) + `/update?version=` + strconv.FormatUint(service.Version.Index, 10)
		if _, _, err := engine.request(ctx, http.MethodPost, updatePath, updateBody); err != nil {
			return 0, err
		}
		updatedCount++
	}
	return updatedCount, nil
}

func normalizeSelfUpdateImage(image string) string {
	baseImage := image
	if separator := strings.Index(baseImage, `@sha256:`); separator >= 0 {
		baseImage = baseImage[:separator]
	}
	if separator := strings.LastIndex(baseImage, `@`); separator >= 0 {
		baseImage = baseImage[:separator]
	}
	if separator := strings.LastIndex(baseImage, `:`); separator > strings.LastIndex(baseImage, `/`) {
		baseImage = baseImage[:separator]
	}
	return baseImage
}

func selfUpdateDigest(input typedSelfUpdateRequest, imageName string) string {
	switch imageName {
	case `server`:
		return input.Images.Server
	case `schedules`:
		return input.Images.Schedules
	case `web`:
		return input.Images.Web
	default:
		return input.Images.Fumadocs
	}
}

func replaceSelfUpdateEnv(values []string, key string, value string) []string {
	prefix := key + `=`
	replaced := false
	result := make([]string, 0, len(values)+1)
	for _, entry := range values {
		if strings.HasPrefix(entry, prefix) {
			if !replaced {
				result = append(result, prefix+value)
				replaced = true
			}
			continue
		}
		result = append(result, entry)
	}
	if !replaced {
		result = append(result, prefix+value)
	}
	return result
}

func newDockerEngineClient(socketPath string) *dockerEngineClient {
	return &dockerEngineClient{
		httpClient: &http.Client{
			Timeout: 5 * time.Minute,
			Transport: &http.Transport{
				DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
					return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, `unix`, socketPath)
				},
			},
		},
	}
}

func (engine *dockerEngineClient) request(
	ctx context.Context,
	method string,
	path string,
	body []byte,
) ([]byte, int, error) {
	return engine.requestWithHeaders(ctx, method, path, body, ``)
}

func (engine *dockerEngineClient) requestWithHeaders(
	ctx context.Context,
	method string,
	path string,
	body []byte,
	registryAuth string,
) ([]byte, int, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, `http://docker-engine`+path, reader)
	if err != nil {
		return nil, 0, err
	}
	if body != nil {
		request.Header.Set(`Content-Type`, `application/json`)
		request.ContentLength = int64(len(body))
	}
	if registryAuth != `` {
		request.Header.Set(`X-Registry-Auth`, registryAuth)
	}
	response, err := engine.httpClient.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxTypedResponseBytes+1))
	if err != nil {
		return nil, response.StatusCode, err
	}
	if len(data) > maxTypedResponseBytes {
		return nil, response.StatusCode, errors.New(`Docker typed operation response exceeded its limit`)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return data, response.StatusCode, fmt.Errorf(`Docker API returned HTTP %d`, response.StatusCode)
	}
	return data, response.StatusCode, nil
}

func (engine *dockerEngineClient) updateManagedService(ctx context.Context, body []byte) error {
	var input typedServiceRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return err
	}
	inspectionBody, _, err := engine.request(
		ctx,
		http.MethodGet,
		`/services/`+url.PathEscape(input.ServiceName),
		nil,
	)
	if err != nil {
		return err
	}
	var inspection struct {
		ID      string `json:"ID"`
		Version struct {
			Index uint64 `json:"Index"`
		} `json:"Version"`
		Spec map[string]any `json:"Spec"`
	}
	if err := json.Unmarshal(inspectionBody, &inspection); err != nil {
		return fmt.Errorf(`invalid Docker service inspection: %w`, err)
	}
	if inspection.ID == `` || inspection.Version.Index == 0 || inspection.Spec == nil {
		return errors.New(`Docker service inspection was incomplete`)
	}
	taskTemplate, ok := inspection.Spec[`TaskTemplate`].(map[string]any)
	if !ok {
		return errors.New(`Docker service inspection has no task template`)
	}
	forceUpdate, _ := taskTemplate[`ForceUpdate`].(float64)
	taskTemplate[`ForceUpdate`] = forceUpdate + 1
	updateBody, err := json.Marshal(inspection.Spec)
	if err != nil {
		return err
	}
	_, _, err = engine.request(
		ctx,
		http.MethodPost,
		`/services/`+url.PathEscape(inspection.ID)+`/update?version=`+strconv.FormatUint(inspection.Version.Index, 10),
		updateBody,
	)
	return err
}

func (engine *dockerEngineClient) inspectManagedNetwork(ctx context.Context, name string) (string, bool, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/networks/`+url.PathEscape(name), nil)
	if err != nil {
		return ``, false, err
	}
	var network struct {
		Driver     string `json:"Driver"`
		Attachable bool   `json:"Attachable"`
	}
	if err := json.Unmarshal(body, &network); err != nil {
		return ``, false, fmt.Errorf(`invalid Docker network inspection: %w`, err)
	}
	return network.Driver, network.Attachable, nil
}

func (engine *dockerEngineClient) serviceLogs(ctx context.Context, body []byte) (string, error) {
	var input typedServiceLogsRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return ``, err
	}
	logBody, _, err := engine.request(
		ctx,
		http.MethodGet,
		`/services/`+url.PathEscape(input.ServiceName)+`/logs?stdout=1&stderr=1&tail=`+strconv.Itoa(input.Tail),
		nil,
	)
	if err != nil {
		return ``, err
	}
	return decodeDockerLogStream(logBody), nil
}

func decodeDockerLogStream(body []byte) string {
	var output bytes.Buffer
	offset := 0
	for offset+8 <= len(body) {
		stream := body[offset]
		size := int(body[offset+4])<<24 | int(body[offset+5])<<16 | int(body[offset+6])<<8 | int(body[offset+7])
		if (stream != 1 && stream != 2) || offset+8+size > len(body) {
			return string(body)
		}
		output.Write(body[offset+8 : offset+8+size])
		offset += 8 + size
	}
	if offset != len(body) {
		return string(body)
	}
	return output.String()
}

func (engine *dockerEngineClient) runManagedServiceCommand(ctx context.Context, body []byte) error {
	var input typedServiceCommandRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return err
	}
	filter := url.QueryEscape(`{"service":["upstand_redis"],"desired-state":["running"]}`)
	tasksBody, _, err := engine.request(ctx, http.MethodGet, `/tasks?filters=`+filter, nil)
	if err != nil {
		return err
	}
	var tasks []struct {
		Status struct {
			State           string `json:"State"`
			ContainerStatus struct {
				ContainerID string `json:"ContainerID"`
			} `json:"ContainerStatus"`
		} `json:"Status"`
	}
	if err := json.Unmarshal(tasksBody, &tasks); err != nil {
		return fmt.Errorf(`invalid Docker task response: %w`, err)
	}
	containerID := ``
	for _, task := range tasks {
		if task.Status.State == `running` && task.Status.ContainerStatus.ContainerID != `` {
			containerID = task.Status.ContainerStatus.ContainerID
			break
		}
	}
	if containerID == `` {
		return errors.New(`managed Redis service has no running container`)
	}
	createBody, err := json.Marshal(map[string]any{
		`Cmd`:          input.Command,
		`AttachStdout`: true,
		`AttachStderr`: true,
		`Tty`:          false,
	})
	if err != nil {
		return err
	}
	execBody, _, err := engine.request(ctx, http.MethodPost, `/containers/`+url.PathEscape(containerID)+`/exec`, createBody)
	if err != nil {
		return err
	}
	var execution struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal(execBody, &execution); err != nil || execution.ID == `` {
		return errors.New(`Docker exec creation returned no execution ID`)
	}
	startBody := []byte(`{"Detach":false,"Tty":false}`)
	if _, _, err := engine.request(ctx, http.MethodPost, `/exec/`+url.PathEscape(execution.ID)+`/start`, startBody); err != nil {
		return err
	}
	inspectionBody, _, err := engine.request(ctx, http.MethodGet, `/exec/`+url.PathEscape(execution.ID)+`/json`, nil)
	if err != nil {
		return err
	}
	var inspection struct {
		ExitCode int `json:"ExitCode"`
	}
	if err := json.Unmarshal(inspectionBody, &inspection); err != nil {
		return err
	}
	if inspection.ExitCode != 0 {
		return fmt.Errorf(`managed Redis command exited with code %d`, inspection.ExitCode)
	}
	return nil
}
