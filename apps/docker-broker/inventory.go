package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var typedInventoryOperationPattern = regexp.MustCompile(`^(info|host_time|containers|images|volumes|networks|services|swarm_nodes|logs|stats|control_container|control_resource|prune)$`)

type typedInventoryRequest struct {
	Operation              string   `json:"operation"`
	ContainerID            string   `json:"container_id,omitempty"`
	ServiceName            string   `json:"service_name,omitempty"`
	Search                 string   `json:"search,omitempty"`
	State                  string   `json:"state,omitempty"`
	Since                  int64    `json:"since,omitempty"`
	SearchLogs             string   `json:"search_logs,omitempty"`
	LogLevels              []string `json:"log_levels,omitempty"`
	Tail                   int      `json:"tail,omitempty"`
	Command                string   `json:"command,omitempty"`
	ResourceID             string   `json:"resource_id,omitempty"`
	Type                   string   `json:"type,omitempty"`
	PreserveRollbackImages *bool    `json:"preserve_rollback_images,omitempty"`
	PruneNetworks          bool     `json:"prune_networks,omitempty"`
}

type typedInventoryContainerResponse struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Image     string   `json:"image"`
	State     string   `json:"state"`
	Status    string   `json:"status"`
	Ports     string   `json:"ports"`
	Mounts    []string `json:"mounts"`
	Networks  []string `json:"networks"`
	Labels    []string `json:"labels"`
	CreatedAt *string  `json:"createdAt"`
}

type typedInventoryImageResponse struct {
	ID        string   `json:"id"`
	Tags      []string `json:"tags"`
	SizeBytes int64    `json:"sizeBytes"`
	CreatedAt *string  `json:"createdAt"`
}

type typedInventoryVolumeResponse struct {
	Name       string `json:"name"`
	Driver     string `json:"driver"`
	Mountpoint string `json:"mountpoint"`
}

type typedInventoryNetworkResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Driver     string `json:"driver"`
	Scope      string `json:"scope"`
	Internal   bool   `json:"internal"`
	Attachable bool   `json:"attachable"`
}

type typedInventoryServiceResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Mode     string `json:"mode"`
	Replicas string `json:"replicas"`
	Image    string `json:"image"`
	Ports    string `json:"ports"`
}

type typedInventorySwarmNodeResponse struct {
	ID          string `json:"id"`
	Hostname    string `json:"hostname"`
	IP          string `json:"ip"`
	IsLeader    bool   `json:"isLeader"`
	Status      string `json:"status,omitempty"`
	ServerType  string `json:"serverType,omitempty"`
	Role        string `json:"role,omitempty"`
	IsLocalNode bool   `json:"isLocalNode,omitempty"`
}

type typedInventoryStatsResponse struct {
	ContainerID      string  `json:"containerId"`
	CPUPercent       float64 `json:"cpuPercent"`
	MemoryUsageBytes uint64  `json:"memoryUsageBytes"`
	MemoryLimitBytes uint64  `json:"memoryLimitBytes"`
	MemoryPercent    float64 `json:"memoryPercent"`
	NetworkRxBytes   uint64  `json:"networkRxBytes"`
	NetworkTxBytes   uint64  `json:"networkTxBytes"`
	BlockReadBytes   uint64  `json:"blockReadBytes"`
	BlockWriteBytes  uint64  `json:"blockWriteBytes"`
	PIDs             uint64  `json:"pids"`
}

type typedInventoryInfoResponse struct {
	Name            string `json:"name"`
	ServerVersion   string `json:"serverVersion"`
	OperatingSystem string `json:"operatingSystem"`
	Architecture    string `json:"architecture"`
	Containers      int    `json:"containers"`
	Images          int    `json:"images"`
	MemoryBytes     uint64 `json:"memoryBytes"`
	SwarmState      string `json:"swarmState"`
}

type typedInventoryHostTimeResponse struct {
	EpochSeconds int64  `json:"epochSeconds"`
	ISO          string `json:"iso"`
}

type typedInventoryLogsResponse struct {
	Logs string `json:"logs"`
}

type typedInventoryPruneResponse struct {
	Success bool     `json:"success"`
	Output  []string `json:"output"`
}

func validateTypedInventoryRequest(body []byte) (typedInventoryRequest, error) {
	var input typedInventoryRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	if !typedInventoryOperationPattern.MatchString(input.Operation) {
		return input, errors.New(`typed inventory operation is not supported`)
	}
	if err := validateTypedInventoryFieldSet(body, input.Operation); err != nil {
		return input, err
	}
	if input.Tail == 0 {
		input.Tail = 150
	}
	if input.Tail < 1 || input.Tail > maxTypedLogTail {
		return input, errors.New(`typed inventory log tail is out of bounds`)
	}
	if len(input.Search) > 200 || len(input.SearchLogs) > 200 {
		return input, errors.New(`typed inventory search input is too long`)
	}
	if input.Since < 0 {
		return input, errors.New(`typed inventory since value is invalid`)
	}
	if len(input.LogLevels) > 5 {
		return input, errors.New(`typed inventory log level list is too long`)
	}
	for _, level := range input.LogLevels {
		switch level {
		case `debug`, `info`, `warn`, `error`:
		default:
			return input, errors.New(`typed inventory log level is unsupported`)
		}
	}
	if input.State != `` {
		switch input.State {
		case `created`, `running`, `paused`, `restarting`, `removing`, `exited`, `dead`:
		default:
			return input, errors.New(`typed inventory container state is unsupported`)
		}
	}
	if input.ContainerID != `` && !swarmNodeIDPattern.MatchString(input.ContainerID) {
		return input, errors.New(`typed inventory container ID is invalid`)
	}
	if input.ServiceName != `` && !swarmNamePattern.MatchString(input.ServiceName) {
		return input, errors.New(`typed inventory service name is invalid`)
	}
	if input.Operation == `logs` && input.ContainerID == `` && input.ServiceName == `` {
		return input, errors.New(`typed inventory logs require a container or service`)
	}
	if input.Operation == `stats` && input.ContainerID == `` {
		return input, errors.New(`typed inventory stats require a container`)
	}
	if input.Operation == `control_container` {
		if !swarmNodeIDPattern.MatchString(input.ContainerID) {
			return input, errors.New(`typed container control requires a valid container ID`)
		}
		switch input.Command {
		case `restart`, `stop`, `start`, `remove`:
		default:
			return input, errors.New(`typed container control command is unsupported`)
		}
	}
	if input.Operation == `control_resource` {
		switch input.Command {
		case `remove-volume`, `remove-network`:
			if !swarmNamePattern.MatchString(input.ResourceID) {
				return input, errors.New(`typed Docker resource ID is invalid`)
			}
		case `remove-image`:
			if !typedDockerImageReferencePattern.MatchString(input.ResourceID) || strings.Contains(input.ResourceID, `..`) {
				return input, errors.New(`typed Docker image reference is invalid`)
			}
		default:
			return input, errors.New(`typed resource control command is unsupported`)
		}
	}
	if input.Operation == `prune` {
		switch input.Type {
		case `images`, `volumes`, `containers`, `builder`, `networks`, `system`, `all`:
		default:
			return input, errors.New(`typed Docker prune type is unsupported`)
		}
	}
	return input, nil
}

var typedDockerImageReferencePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$`)

func validateTypedInventoryFieldSet(body []byte, operation string) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return fmt.Errorf(`invalid typed inventory body: %w`, err)
	}
	allowed := map[string]struct{}{`operation`: {}}
	for _, field := range []string{
		`container_id`, `service_name`, `search`, `state`, `since`, `search_logs`,
		`log_levels`, `tail`, `command`, `resource_id`, `type`,
		`preserve_rollback_images`, `prune_networks`,
	} {
		switch operation {
		case `containers`:
			if field == `search` || field == `state` {
				allowed[field] = struct{}{}
			}
		case `logs`:
			if field == `container_id` || field == `service_name` || field == `since` || field == `search_logs` || field == `log_levels` || field == `tail` {
				allowed[field] = struct{}{}
			}
		case `stats`:
			if field == `container_id` {
				allowed[field] = struct{}{}
			}
		case `control_container`:
			if field == `container_id` || field == `command` {
				allowed[field] = struct{}{}
			}
		case `control_resource`:
			if field == `resource_id` || field == `command` {
				allowed[field] = struct{}{}
			}
		case `prune`:
			if field == `type` || field == `preserve_rollback_images` || field == `prune_networks` {
				allowed[field] = struct{}{}
			}
		}
	}
	for field := range fields {
		if _, ok := allowed[field]; !ok {
			return fmt.Errorf(`typed inventory operation %q does not accept field %q`, operation, field)
		}
	}
	return nil
}

func (engine *dockerEngineClient) inventoryOperation(ctx context.Context, body []byte) (any, error) {
	input, err := validateTypedInventoryRequest(body)
	if err != nil {
		return nil, err
	}
	switch input.Operation {
	case `info`:
		return engine.inventoryInfo(ctx)
	case `host_time`:
		now := time.Now().UTC()
		return typedInventoryHostTimeResponse{EpochSeconds: now.Unix(), ISO: now.Format(time.RFC3339Nano)}, nil
	case `containers`:
		return engine.inventoryContainers(ctx, input)
	case `images`:
		return engine.inventoryImages(ctx)
	case `volumes`:
		return engine.inventoryVolumes(ctx)
	case `networks`:
		return engine.inventoryNetworks(ctx)
	case `services`:
		return engine.inventoryServices(ctx)
	case `swarm_nodes`:
		return engine.inventorySwarmNodes(ctx)
	case `logs`:
		return engine.inventoryLogs(ctx, input)
	case `stats`:
		return engine.inventoryStats(ctx, input.ContainerID)
	case `control_container`:
		return map[string]any{`success`: true}, engine.controlContainer(ctx, input)
	case `control_resource`:
		return map[string]any{`success`: true}, engine.controlResource(ctx, input)
	case `prune`:
		return engine.inventoryPrune(ctx, input)
	default:
		return nil, errors.New(`typed inventory operation was not mapped`)
	}
}

func (engine *dockerEngineClient) inventoryInfo(ctx context.Context) (typedInventoryInfoResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/info`, nil)
	if err != nil {
		return typedInventoryInfoResponse{}, err
	}
	var raw struct {
		Name            string `json:"Name"`
		ServerVersion   string `json:"ServerVersion"`
		OperatingSystem string `json:"OperatingSystem"`
		Architecture    string `json:"Architecture"`
		Containers      int    `json:"Containers"`
		Images          int    `json:"Images"`
		Memory          uint64 `json:"MemTotal"`
		Swarm           struct {
			LocalNodeState string `json:"LocalNodeState"`
		} `json:"Swarm"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return typedInventoryInfoResponse{}, fmt.Errorf(`invalid Docker info response: %w`, err)
	}
	state := raw.Swarm.LocalNodeState
	if state == `` {
		state = `inactive`
	}
	return typedInventoryInfoResponse{Name: raw.Name, ServerVersion: raw.ServerVersion, OperatingSystem: raw.OperatingSystem, Architecture: raw.Architecture, Containers: raw.Containers, Images: raw.Images, MemoryBytes: raw.Memory, SwarmState: state}, nil
}

func (engine *dockerEngineClient) inventoryContainers(ctx context.Context, input typedInventoryRequest) ([]typedInventoryContainerResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/containers/json?all=true`, nil)
	if err != nil {
		return nil, err
	}
	var raw []struct {
		ID      string   `json:"Id"`
		Names   []string `json:"Names"`
		Image   string   `json:"Image"`
		State   string   `json:"State"`
		Status  string   `json:"Status"`
		Created int64    `json:"Created"`
		Ports   []struct {
			PublicPort  int `json:"PublicPort"`
			PrivatePort int `json:"PrivatePort"`
		} `json:"Ports"`
		Mounts []struct {
			Name        string `json:"Name"`
			Source      string `json:"Source"`
			Destination string `json:"Destination"`
		} `json:"Mounts"`
		Networks map[string]any    `json:"Networks"`
		Labels   map[string]string `json:"Labels"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf(`invalid Docker container list: %w`, err)
	}
	result := make([]typedInventoryContainerResponse, 0, len(raw))
	for _, item := range raw {
		name := ``
		if len(item.Names) > 0 {
			name = strings.TrimPrefix(item.Names[0], `/`)
		}
		if name == `` {
			name = item.ID
		}
		mounts := make([]string, 0, len(item.Mounts))
		for _, mount := range item.Mounts {
			value := mount.Name
			if value == `` && mount.Source != `` && mount.Destination != `` {
				value = mount.Source + `:` + mount.Destination
			}
			if value != `` {
				mounts = append(mounts, value)
			}
		}
		networks := make([]string, 0, len(item.Networks))
		for network := range item.Networks {
			networks = append(networks, network)
		}
		labels := make([]string, 0, len(item.Labels))
		for key, value := range item.Labels {
			labels = append(labels, key+`=`+value)
		}
		sort.Strings(networks)
		sort.Strings(labels)
		ports := make([]string, 0, len(item.Ports))
		for _, port := range item.Ports {
			if port.PublicPort != 0 && port.PrivatePort != 0 {
				ports = append(ports, strconv.Itoa(port.PublicPort)+`:`+strconv.Itoa(port.PrivatePort))
			}
		}
		createdAt := typedTimeString(item.Created)
		row := typedInventoryContainerResponse{ID: item.ID, Name: name, Image: typedFallback(item.Image, `unknown`), State: typedFallback(item.State, `unknown`), Status: typedFallback(item.Status, `unknown`), Ports: strings.Join(ports, `, `), Mounts: mounts, Networks: networks, Labels: labels, CreatedAt: createdAt}
		if input.State != `` && row.State != input.State {
			continue
		}
		if input.Search != `` && !strings.Contains(strings.ToLower(strings.Join([]string{row.ID, row.Name, row.Image, row.Status, strings.Join(row.Labels, ` `), strings.Join(row.Networks, ` `)}, ` `)), strings.ToLower(input.Search)) {
			continue
		}
		result = append(result, row)
	}
	return result, nil
}

func (engine *dockerEngineClient) inventoryImages(ctx context.Context) ([]typedInventoryImageResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/images/json?all=true`, nil)
	if err != nil {
		return nil, err
	}
	var raw []struct {
		ID       string   `json:"Id"`
		RepoTags []string `json:"RepoTags"`
		Size     int64    `json:"Size"`
		Created  int64    `json:"Created"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf(`invalid Docker image list: %w`, err)
	}
	result := make([]typedInventoryImageResponse, 0, len(raw))
	for _, image := range raw {
		result = append(result, typedInventoryImageResponse{ID: image.ID, Tags: image.RepoTags, SizeBytes: image.Size, CreatedAt: typedTimeString(image.Created)})
	}
	return result, nil
}

func (engine *dockerEngineClient) inventoryVolumes(ctx context.Context) ([]typedInventoryVolumeResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/volumes`, nil)
	if err != nil {
		return nil, err
	}
	var raw struct {
		Volumes []struct {
			Name       string `json:"Name"`
			Driver     string `json:"Driver"`
			Mountpoint string `json:"Mountpoint"`
		} `json:"Volumes"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf(`invalid Docker volume list: %w`, err)
	}
	result := make([]typedInventoryVolumeResponse, 0, len(raw.Volumes))
	for _, volume := range raw.Volumes {
		result = append(result, typedInventoryVolumeResponse{Name: volume.Name, Driver: volume.Driver, Mountpoint: volume.Mountpoint})
	}
	return result, nil
}

func (engine *dockerEngineClient) inventoryNetworks(ctx context.Context) ([]typedInventoryNetworkResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/networks`, nil)
	if err != nil {
		return nil, err
	}
	var raw []struct {
		ID         string `json:"Id"`
		Name       string `json:"Name"`
		Driver     string `json:"Driver"`
		Scope      string `json:"Scope"`
		Internal   bool   `json:"Internal"`
		Attachable bool   `json:"Attachable"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf(`invalid Docker network list: %w`, err)
	}
	result := make([]typedInventoryNetworkResponse, 0, len(raw))
	for _, network := range raw {
		result = append(result, typedInventoryNetworkResponse{ID: network.ID, Name: network.Name, Driver: network.Driver, Scope: network.Scope, Internal: network.Internal, Attachable: network.Attachable})
	}
	return result, nil
}

func (engine *dockerEngineClient) inventoryServices(ctx context.Context) ([]typedInventoryServiceResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/services`, nil)
	if err != nil {
		return nil, err
	}
	var raw []struct {
		ID   string `json:"ID"`
		Spec struct {
			Name         string `json:"Name"`
			TaskTemplate struct {
				ContainerSpec struct {
					Image string `json:"Image"`
				} `json:"ContainerSpec"`
			} `json:"TaskTemplate"`
			Mode struct {
				Replicated *struct {
					Replicas uint64 `json:"Replicas"`
				} `json:"Replicated"`
			} `json:"Mode"`
		} `json:"Spec"`
		EndpointSpec struct {
			Ports []struct {
				PublishedPort int `json:"PublishedPort"`
				TargetPort    int `json:"TargetPort"`
			} `json:"Ports"`
		} `json:"EndpointSpec"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf(`invalid Docker service list: %w`, err)
	}
	result := make([]typedInventoryServiceResponse, 0, len(raw))
	for _, service := range raw {
		mode := `global`
		replicas := `global`
		if service.Spec.Mode.Replicated != nil {
			mode = `replicated`
			replicas = strconv.FormatUint(service.Spec.Mode.Replicated.Replicas, 10)
		}
		ports := make([]string, 0, len(service.EndpointSpec.Ports))
		for _, port := range service.EndpointSpec.Ports {
			if port.PublishedPort != 0 && port.TargetPort != 0 {
				ports = append(ports, strconv.Itoa(port.PublishedPort)+`:`+strconv.Itoa(port.TargetPort))
			}
		}
		result = append(result, typedInventoryServiceResponse{ID: service.ID, Name: service.Spec.Name, Mode: mode, Replicas: replicas, Image: typedFallback(service.Spec.TaskTemplate.ContainerSpec.Image, `unknown`), Ports: strings.Join(ports, `, `)})
	}
	return result, nil
}

func (engine *dockerEngineClient) inventorySwarmNodes(ctx context.Context) ([]typedInventorySwarmNodeResponse, error) {
	info, err := engine.swarmInfo(ctx)
	if err != nil {
		return nil, err
	}
	if info.LocalNodeState != `active` {
		return []typedInventorySwarmNodeResponse{}, nil
	}
	body, _, err := engine.request(ctx, http.MethodGet, `/nodes`, nil)
	if err != nil {
		return nil, err
	}
	var raw []dockerSwarmNodePayload
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf(`invalid Docker node list: %w`, err)
	}
	result := make([]typedInventorySwarmNodeResponse, 0, len(raw))
	for _, node := range raw {
		mapped := node.toResponse(info.NodeID)
		result = append(result, typedInventorySwarmNodeResponse{ID: mapped.ID, Hostname: mapped.Hostname, IP: mapped.IP, IsLeader: mapped.Leader, Status: mapped.Status, Role: mapped.Role, IsLocalNode: mapped.IsLocalNode})
	}
	return result, nil
}

func (engine *dockerEngineClient) inventoryLogs(ctx context.Context, input typedInventoryRequest) (typedInventoryLogsResponse, error) {
	target := input.ContainerID
	path := `/containers/` + url.PathEscape(target) + `/logs?stdout=1&stderr=1&timestamps=1&tail=` + strconv.Itoa(input.Tail)
	if input.ServiceName != `` {
		target = input.ServiceName
		path = `/services/` + url.PathEscape(target) + `/logs?stdout=1&stderr=1&timestamps=1&tail=` + strconv.Itoa(input.Tail)
	}
	if input.Since > 0 {
		path += `&since=` + strconv.FormatInt(input.Since, 10)
	}
	body, _, err := engine.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return typedInventoryLogsResponse{}, err
	}
	return typedInventoryLogsResponse{Logs: decodeDockerLogStream(body)}, nil
}

func (engine *dockerEngineClient) inventoryStats(ctx context.Context, containerID string) (typedInventoryStatsResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/containers/`+url.PathEscape(containerID)+`/stats?stream=false`, nil)
	if err != nil {
		return typedInventoryStatsResponse{}, err
	}
	var raw dockerStatsPayload
	if err := json.Unmarshal(body, &raw); err != nil {
		return typedInventoryStatsResponse{}, fmt.Errorf(`invalid Docker stats response: %w`, err)
	}
	cpuDelta := float64(raw.CPUStats.CPUUsage.TotalUsage - raw.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(raw.CPUStats.SystemCPUUsage - raw.PreCPUStats.SystemCPUUsage)
	onlineCPUs := raw.CPUStats.OnlineCPUs
	if onlineCPUs == 0 {
		onlineCPUs = uint64(len(raw.CPUStats.CPUUsage.PercpuUsage))
	}
	if onlineCPUs == 0 {
		onlineCPUs = 1
	}
	cpuPercent := 0.0
	if systemDelta > 0 {
		cpuPercent = cpuDelta / systemDelta * float64(onlineCPUs) * 100
	}
	networkRx, networkTx := uint64(0), uint64(0)
	for _, network := range raw.Networks {
		networkRx += network.RxBytes
		networkTx += network.TxBytes
	}
	blockRead, blockWrite := uint64(0), uint64(0)
	for _, block := range raw.BlkioStats.IoServiceBytesRecursive {
		switch strings.ToLower(block.Op) {
		case `read`:
			blockRead += block.Value
		case `write`:
			blockWrite += block.Value
		}
	}
	memoryPercent := 0.0
	if raw.MemoryStats.Limit > 0 {
		memoryPercent = float64(raw.MemoryStats.Usage) / float64(raw.MemoryStats.Limit) * 100
	}
	return typedInventoryStatsResponse{ContainerID: containerID, CPUPercent: cpuPercent, MemoryUsageBytes: raw.MemoryStats.Usage, MemoryLimitBytes: raw.MemoryStats.Limit, MemoryPercent: memoryPercent, NetworkRxBytes: networkRx, NetworkTxBytes: networkTx, BlockReadBytes: blockRead, BlockWriteBytes: blockWrite, PIDs: raw.PidsStats.Current}, nil
}

type dockerStatsPayload struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage  uint64   `json:"total_usage"`
			PercpuUsage []uint64 `json:"percpu_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs     uint64 `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
	} `json:"precpu_stats"`
	MemoryStats struct {
		Usage uint64 `json:"usage"`
		Limit uint64 `json:"limit"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		RxBytes uint64 `json:"rx_bytes"`
		TxBytes uint64 `json:"tx_bytes"`
	} `json:"networks"`
	BlkioStats struct {
		IoServiceBytesRecursive []struct {
			Op    string `json:"op"`
			Value uint64 `json:"value"`
		} `json:"io_service_bytes_recursive"`
	} `json:"blkio_stats"`
	PidsStats struct {
		Current uint64 `json:"current"`
	} `json:"pids_stats"`
}

func (engine *dockerEngineClient) controlContainer(ctx context.Context, input typedInventoryRequest) error {
	path := `/containers/` + url.PathEscape(input.ContainerID)
	switch input.Command {
	case `remove`:
		path += `?force=true`
		_, _, err := engine.request(ctx, http.MethodDelete, path, nil)
		return err
	case `start`, `stop`, `restart`:
		_, _, err := engine.request(ctx, http.MethodPost, path+`/`+input.Command, nil)
		return err
	default:
		return errors.New(`typed container control command was not mapped`)
	}
}

func (engine *dockerEngineClient) controlResource(ctx context.Context, input typedInventoryRequest) error {
	resourceType := map[string]string{`remove-volume`: `volumes`, `remove-network`: `networks`, `remove-image`: `images`}[input.Command]
	_, _, err := engine.request(ctx, http.MethodDelete, `/`+resourceType+`/`+url.PathEscape(input.ResourceID)+`?force=true`, nil)
	return err
}

func (engine *dockerEngineClient) inventoryPrune(ctx context.Context, input typedInventoryRequest) (typedInventoryPruneResponse, error) {
	actions := []string{input.Type}
	if input.Type == `all` {
		actions = []string{`containers`, `images`, `volumes`, `builder`, `system`}
		if input.PruneNetworks {
			actions = append(actions, `networks`)
		}
	}
	output := make([]string, 0, len(actions))
	for _, action := range actions {
		path := map[string]string{`images`: `/images/prune`, `volumes`: `/volumes/prune`, `containers`: `/containers/prune`, `builder`: `/build/prune`, `networks`: `/networks/prune`, `system`: `/system/prune`}[action]
		if path == `` {
			return typedInventoryPruneResponse{}, errors.New(`typed Docker prune action was not mapped`)
		}
		query := `?force=true`
		if action == `images` || action == `system` {
			query = `?all=true`
			if input.PreserveRollbackImages == nil || *input.PreserveRollbackImages {
				query += `&filters=` + url.QueryEscape(`{"label":["com.upstand.rollback.keep!=true"]}`)
			}
		}
		body, _, err := engine.request(ctx, http.MethodPost, path+query, nil)
		if err != nil {
			return typedInventoryPruneResponse{}, err
		}
		output = append(output, action+`: `+string(body))
	}
	return typedInventoryPruneResponse{Success: true, Output: output}, nil
}

func typedTimeString(seconds int64) *string {
	if seconds <= 0 {
		return nil
	}
	value := time.Unix(seconds, 0).UTC().Format(time.RFC3339Nano)
	return &value
}

func typedFallback(value, fallback string) string {
	if value == `` {
		return fallback
	}
	return value
}
