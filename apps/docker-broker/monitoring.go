package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"strings"
	"time"
)

const (
	typedMonitoringPath          = typedServerPrefix + `monitoring`
	typedMonitoringContainerName = `upstand-monitoring-agent`
	typedMonitoringVolumeName    = `upstand-monitoring-data`
	typedMonitoringHealthTimeout = 60 * time.Second
)

var typedMonitoringImageReferencePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,510}@sha256:[a-fA-F0-9]{64}$`)

type typedMonitoringRequest struct {
	Operation       string `json:"operation"`
	Image           string `json:"image"`
	Token           string `json:"token"`
	CPUThreshold    int    `json:"cpu_threshold"`
	MemoryThreshold int    `json:"memory_threshold"`
	NetworkName     string `json:"network_name"`
	CallbackPort    int    `json:"callback_port"`
}

type typedMonitoringContainerInspection struct {
	Config struct {
		Image  string            `json:"Image"`
		Env    []string          `json:"Env"`
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	HostConfig typedMonitoringHostConfig `json:"HostConfig"`
	State      typedMonitoringState      `json:"State"`
}

type typedMonitoringHostConfig struct {
	Binds          []string           `json:"Binds"`
	CapDrop        []string           `json:"CapDrop"`
	LogConfig      typedLogConfig     `json:"LogConfig"`
	Memory         int64              `json:"Memory"`
	NetworkMode    string             `json:"NetworkMode"`
	PidsLimit      *int64             `json:"PidsLimit"`
	ReadonlyRootfs bool               `json:"ReadonlyRootfs"`
	RestartPolicy  typedRestartPolicy `json:"RestartPolicy"`
	SecurityOpt    []string           `json:"SecurityOpt"`
	Tmpfs          map[string]string  `json:"Tmpfs"`
}

type typedLogConfig struct {
	Type   string            `json:"Type"`
	Config map[string]string `json:"Config"`
}

type typedRestartPolicy struct {
	Name string `json:"Name"`
}

type typedMonitoringState struct {
	Running bool `json:"Running"`
	Health  struct {
		Status string `json:"Status"`
	} `json:"Health"`
}

func validateTypedMonitoringRequest(body []byte) (typedMonitoringRequest, error) {
	var input typedMonitoringRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	if input.Operation != `ensure` {
		return input, errors.New(`typed monitoring operation is not supported`)
	}
	if !typedMonitoringImageReferencePattern.MatchString(strings.TrimSpace(input.Image)) {
		return input, errors.New(`typed monitoring requires an immutable image reference`)
	}
	if input.Token == `` || len(input.Token) > 4096 || hasMonitoringControlCharacter(input.Token) {
		return input, errors.New(`typed monitoring token is invalid`)
	}
	if input.CPUThreshold < 0 || input.CPUThreshold > 100 || input.MemoryThreshold < 0 || input.MemoryThreshold > 100 {
		return input, errors.New(`typed monitoring thresholds must be between 0 and 100`)
	}
	if !managedNetworkPattern.MatchString(input.NetworkName) {
		return input, errors.New(`typed monitoring network name is invalid`)
	}
	if input.CallbackPort < 1 || input.CallbackPort > 65535 {
		return input, errors.New(`typed monitoring callback port is invalid`)
	}
	return input, nil
}

func hasMonitoringControlCharacter(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}

func (engine *dockerEngineClient) ensureMonitoringContainer(ctx context.Context, input typedMonitoringRequest) error {
	if err := engine.ensureTypedMonitoringNetwork(ctx, input.NetworkName); err != nil {
		return err
	}
	if err := engine.ensureTypedMonitoringVolume(ctx); err != nil {
		return err
	}
	if err := engine.ensureTypedMonitoringImage(ctx, input.Image); err != nil {
		return err
	}

	containerBody, status, inspectErr := engine.request(ctx, http.MethodGet, `/containers/`+url.PathEscape(typedMonitoringContainerName)+`/json`, nil)
	if inspectErr != nil && status != http.StatusNotFound {
		return inspectErr
	}
	if status != http.StatusNotFound {
		var inspection typedMonitoringContainerInspection
		if err := json.Unmarshal(containerBody, &inspection); err != nil || inspection.Config.Image == `` {
			return errors.New(`typed monitoring container inspection was incomplete`)
		}
		if inspection.Config.Labels[`com.upstand.component`] != `monitoring-agent` || inspection.Config.Labels[`com.upstand.platform`] != `true` {
			return errors.New(`existing monitoring container is not owned by Upstand`)
		}
		if typedMonitoringContainerMatches(inspection, input) {
			if !inspection.State.Running {
				if _, _, err := engine.request(ctx, http.MethodPost, `/containers/`+url.PathEscape(typedMonitoringContainerName)+`/start`, nil); err != nil {
					return err
				}
			}
			return engine.waitForTypedMonitoringHealth(ctx)
		}
		if _, _, err := engine.request(ctx, http.MethodDelete, `/containers/`+url.PathEscape(typedMonitoringContainerName)+`?force=true`, nil); err != nil {
			return err
		}
	}

	configBody, err := typedMonitoringContainerConfig(input)
	if err != nil {
		return err
	}
	createdBody, _, err := engine.request(ctx, http.MethodPost, `/containers/create?name=`+url.QueryEscape(typedMonitoringContainerName), configBody)
	if err != nil {
		return err
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal(createdBody, &created); err != nil || created.ID == `` {
		return errors.New(`typed monitoring creation returned no container ID`)
	}
	if _, _, err := engine.request(ctx, http.MethodPost, `/containers/`+url.PathEscape(created.ID)+`/start`, nil); err != nil {
		_, _, _ = engine.request(ctx, http.MethodDelete, `/containers/`+url.PathEscape(created.ID)+`?force=true`, nil)
		return err
	}
	return engine.waitForTypedMonitoringHealth(ctx)
}

func (engine *dockerEngineClient) ensureTypedMonitoringNetwork(ctx context.Context, name string) error {
	body, _, err := engine.request(ctx, http.MethodGet, `/networks/`+url.PathEscape(name), nil)
	if err != nil {
		return fmt.Errorf(`monitoring control network inspection failed: %w`, err)
	}
	var network struct {
		Name       string            `json:"Name"`
		Driver     string            `json:"Driver"`
		Scope      string            `json:"Scope"`
		Attachable bool              `json:"Attachable"`
		Internal   bool              `json:"Internal"`
		Options    map[string]string `json:"Options"`
	}
	if err := json.Unmarshal(body, &network); err != nil {
		return fmt.Errorf(`invalid monitoring control network inspection: %w`, err)
	}
	if network.Name != name || network.Driver != `overlay` || network.Scope != `swarm` || !network.Attachable || !network.Internal || !encryptedNetworkOption(network.Options) {
		return errors.New(`monitoring control network is not an encrypted, internal, attachable Swarm overlay`)
	}
	return nil
}

func encryptedNetworkOption(options map[string]string) bool {
	for key, value := range options {
		if strings.EqualFold(key, `encrypted`) && !strings.EqualFold(strings.TrimSpace(value), `false`) {
			return true
		}
	}
	return false
}

func (engine *dockerEngineClient) ensureTypedMonitoringVolume(ctx context.Context) error {
	body, status, err := engine.request(ctx, http.MethodGet, `/volumes/`+url.PathEscape(typedMonitoringVolumeName), nil)
	if err != nil && status != http.StatusNotFound {
		return err
	}
	if status == http.StatusNotFound {
		createBody, marshalErr := json.Marshal(map[string]any{
			`Name`: typedMonitoringVolumeName, `Driver`: `local`,
			`Labels`: map[string]string{`com.upstand.managed`: `true`, `com.upstand.component`: `monitoring-agent`},
		})
		if marshalErr != nil {
			return marshalErr
		}
		_, createStatus, createErr := engine.request(ctx, http.MethodPost, `/volumes/create`, createBody)
		if createErr != nil && createStatus != http.StatusConflict {
			return createErr
		}
		return nil
	}
	var volume struct {
		Name    string            `json:"Name"`
		Driver  string            `json:"Driver"`
		Options map[string]string `json:"Options"`
	}
	if err := json.Unmarshal(body, &volume); err != nil {
		return fmt.Errorf(`invalid monitoring volume inspection: %w`, err)
	}
	if volume.Name != typedMonitoringVolumeName || volume.Driver != `local` || len(volume.Options) != 0 {
		return errors.New(`existing monitoring volume is not a plain local volume`)
	}
	return nil
}

func (engine *dockerEngineClient) ensureTypedMonitoringImage(ctx context.Context, image string) error {
	body, status, err := engine.request(ctx, http.MethodGet, `/images/`+url.PathEscape(image)+`/json`, nil)
	if err != nil && status != http.StatusNotFound {
		return err
	}
	if status == http.StatusNotFound {
		if _, _, err := engine.request(ctx, http.MethodPost, `/images/create?fromImage=`+url.QueryEscape(image), nil); err != nil {
			return err
		}
		body, _, err = engine.request(ctx, http.MethodGet, `/images/`+url.PathEscape(image)+`/json`, nil)
		if err != nil {
			return err
		}
	}
	var inspection struct {
		RepoDigests []string `json:"RepoDigests"`
	}
	if err := json.Unmarshal(body, &inspection); err != nil {
		return fmt.Errorf(`invalid monitoring image inspection: %w`, err)
	}
	parts := strings.SplitN(image, `@`, 2)
	found := false
	for _, repoDigest := range inspection.RepoDigests {
		if repoDigest == image || (len(parts) == 2 && strings.HasSuffix(repoDigest, `@`+parts[1])) {
			found = true
			break
		}
	}
	if !found {
		return errors.New(`pulled monitoring image did not match the pinned digest`)
	}
	return nil
}

func typedMonitoringContainerConfig(input typedMonitoringRequest) ([]byte, error) {
	metricsConfig, err := json.Marshal(map[string]any{
		`server`: map[string]any{
			`serverId`: `local`, `refreshRate`: 25, `port`: 3001, `serverType`: `Upstand`,
			`token`:         input.Token,
			`urlCallback`:   fmt.Sprintf(`http://server:%d/api/monitoring/alerts`, input.CallbackPort),
			`retentionDays`: 7, `cronJob`: `0 0 * * *`,
			`thresholds`: map[string]int{`cpu`: input.CPUThreshold, `memory`: input.MemoryThreshold},
		},
		`containers`: map[string]any{`refreshRate`: 25, `services`: map[string]any{`include`: []string{}, `exclude`: []string{}}},
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{
		`Labels`: map[string]string{`com.upstand.component`: `monitoring-agent`, `com.upstand.platform`: `true`},
		`Image`:  input.Image,
		`Env`:    []string{`METRICS_CONFIG=` + string(metricsConfig), `DB_PATH=/data/monitoring.db`, `DOCKER_HOST=https://docker-broker:2375`},
		`HostConfig`: typedMonitoringHostConfig{
			RestartPolicy: typedRestartPolicy{Name: `always`}, NetworkMode: input.NetworkName,
			Binds:     []string{`/proc:/host/proc:ro`, `/sys:/host/sys:ro`, `/etc/os-release:/etc/os-release:ro`, typedMonitoringVolumeName + `:/data`},
			CapDrop:   []string{`ALL`},
			LogConfig: typedLogConfig{Type: `json-file`, Config: map[string]string{`max-size`: `10m`, `max-file`: `3`}},
			Memory:    256 * 1024 * 1024, PidsLimit: int64Pointer(128), ReadonlyRootfs: true,
			SecurityOpt: []string{`no-new-privileges:true`}, Tmpfs: map[string]string{`/tmp`: `rw,noexec,nosuid,nodev,size=16m`},
		},
		`ExposedPorts`: map[string]map[string]any{`3001/tcp`: {}},
	})
}

func int64Pointer(value int64) *int64 {
	return &value
}

func typedMonitoringContainerMatches(inspection typedMonitoringContainerInspection, input typedMonitoringRequest) bool {
	config, err := typedMonitoringContainerConfig(input)
	if err != nil {
		return false
	}
	var desired struct {
		Labels     map[string]string         `json:"Labels"`
		Image      string                    `json:"Image"`
		Env        []string                  `json:"Env"`
		HostConfig typedMonitoringHostConfig `json:"HostConfig"`
	}
	if json.Unmarshal(config, &desired) != nil {
		return false
	}
	return inspection.Config.Image == desired.Image &&
		reflect.DeepEqual(inspection.Config.Labels, desired.Labels) &&
		reflect.DeepEqual(inspection.Config.Env, desired.Env) &&
		reflect.DeepEqual(inspection.HostConfig, desired.HostConfig)
}

func (engine *dockerEngineClient) waitForTypedMonitoringHealth(ctx context.Context) error {
	deadline := time.Now().Add(typedMonitoringHealthTimeout)
	for time.Now().Before(deadline) {
		body, _, err := engine.request(ctx, http.MethodGet, `/containers/`+url.PathEscape(typedMonitoringContainerName)+`/json`, nil)
		if err != nil {
			return err
		}
		var inspection typedMonitoringContainerInspection
		if err := json.Unmarshal(body, &inspection); err != nil {
			return fmt.Errorf(`invalid monitoring health inspection: %w`, err)
		}
		if inspection.State.Health.Status == `healthy` {
			return nil
		}
		if !inspection.State.Running || inspection.State.Health.Status == `unhealthy` {
			return fmt.Errorf(`monitoring container is not healthy: running=%t status=%s`, inspection.State.Running, inspection.State.Health.Status)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return errors.New(`monitoring container did not become healthy before the broker timeout`)
}
