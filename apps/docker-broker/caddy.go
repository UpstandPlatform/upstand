package main

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const (
	typedCaddyPath              = typedBrokerPrefix + `caddy`
	typedCaddyConfigurationPath = typedCaddyPath + `/configure`
	typedCaddyContainerName     = `upstand-caddy`
	typedCaddyImage             = `caddy:2.8-alpine@sha256:af32e97399febea808609119bb21544d0265c58a02836576e32a2d082c262c17`
	typedCaddyRuntimeVolume     = `upstand-caddy-runtime`
	typedCaddyDataVolume        = `upstand-caddy-data`
	typedCaddyConfigVolume      = `upstand-caddy-config`
	typedCaddyLogsVolume        = `upstand-caddy-logs`
	maxTypedCaddyfileBytes      = 2 << 20
	maxTypedCaddyEnvironment    = 128
	maxTypedCaddyEnvironmentB   = 4 << 20
	maxTypedCaddyPorts          = 32
	maxTypedCaddyCertificates   = 256
	maxTypedCaddyCertificateB   = 512 << 10
	maxTypedCaddyArchiveBytes   = 8 << 20
)

var typedCaddyEnvironmentKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)
var typedCaddyCertificateIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type typedCaddyPort struct {
	Protocol      string `json:"protocol"`
	TargetPort    int    `json:"target_port"`
	PublishedPort int    `json:"published_port"`
}

type typedCaddyRequest struct {
	Operation       string           `json:"operation"`
	NetworkName     string           `json:"network_name"`
	CaddyfileBase64 string           `json:"caddyfile_base64"`
	Environment     []string         `json:"environment"`
	Ports           []typedCaddyPort `json:"ports"`
	ForceRecreate   bool             `json:"force_recreate,omitempty"`
}

type typedCaddyCertificate struct {
	ID          string `json:"id"`
	Certificate string `json:"certificate_pem"`
	PrivateKey  string `json:"private_key_pem"`
}

type typedCaddyConfigurationRequest struct {
	Operation       string                  `json:"operation"`
	CaddyfileBase64 string                  `json:"caddyfile_base64"`
	Certificates    []typedCaddyCertificate `json:"certificates"`
}

func validateTypedCaddyRequest(body []byte) (typedCaddyRequest, error) {
	var input typedCaddyRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return input, fmt.Errorf(`invalid typed Caddy body: %w`, err)
	}
	for field := range fields {
		switch field {
		case `operation`, `network_name`, `caddyfile_base64`, `environment`, `ports`, `force_recreate`:
		default:
			return input, fmt.Errorf(`typed Caddy operation does not accept field %q`, field)
		}
	}
	if input.Operation != `ensure` {
		return input, errors.New(`typed Caddy operation is not supported`)
	}
	if !managedNetworkPattern.MatchString(input.NetworkName) ||
		(!strings.HasPrefix(input.NetworkName, `upstand-`) && !strings.HasPrefix(input.NetworkName, `upstand_`)) {
		return input, errors.New(`typed Caddy network is outside the managed namespace`)
	}
	if input.CaddyfileBase64 == `` || len(input.CaddyfileBase64) > maxTypedCaddyfileBytes*2 {
		return input, errors.New(`typed Caddy configuration is missing or too large`)
	}
	decoded, err := base64.StdEncoding.DecodeString(input.CaddyfileBase64)
	if err != nil || len(decoded) == 0 || len(decoded) > maxTypedCaddyfileBytes || strings.IndexByte(string(decoded), 0) >= 0 {
		return input, errors.New(`typed Caddy configuration is not valid bounded text`)
	}
	if len(input.Environment) == 0 || len(input.Environment) > maxTypedCaddyEnvironment {
		return input, errors.New(`typed Caddy environment is missing or too large`)
	}
	environmentBytes := 0
	seenEnvironmentKeys := make(map[string]struct{}, len(input.Environment))
	hasConfigurationEnvironment := false
	for _, entry := range input.Environment {
		environmentBytes += len(entry)
		if len(entry) == 0 || environmentBytes > maxTypedCaddyEnvironmentB {
			return input, errors.New(`typed Caddy environment is too large`)
		}
		key, value, ok := strings.Cut(entry, `=`)
		if !ok || !typedCaddyEnvironmentKeyPattern.MatchString(key) || value == `` {
			return input, errors.New(`typed Caddy environment contains an invalid entry`)
		}
		if _, exists := seenEnvironmentKeys[key]; exists {
			return input, errors.New(`typed Caddy environment contains duplicate keys`)
		}
		seenEnvironmentKeys[key] = struct{}{}
		for _, character := range entry {
			if character < 0x20 && character != '\t' || character == 0x7f {
				return input, errors.New(`typed Caddy environment contains a control character`)
			}
		}
		if key == `UPSTAND_CADDYFILE_B64` {
			hasConfigurationEnvironment = value == input.CaddyfileBase64
		}
	}
	if !hasConfigurationEnvironment {
		return input, errors.New(`typed Caddy environment must carry the exact managed configuration`)
	}
	if len(input.Ports) == 0 || len(input.Ports) > maxTypedCaddyPorts {
		return input, errors.New(`typed Caddy port bindings are missing or too large`)
	}
	seenPorts := make(map[string]struct{}, len(input.Ports))
	seenPublished := make(map[string]struct{}, len(input.Ports))
	for _, port := range input.Ports {
		if (port.Protocol != `tcp` && port.Protocol != `udp`) ||
			port.TargetPort < 1 || port.TargetPort > 65535 ||
			port.PublishedPort < 1 || port.PublishedPort > 65535 {
			return input, errors.New(`typed Caddy port binding is invalid`)
		}
		key := fmt.Sprintf(`%d/%s`, port.TargetPort, port.Protocol)
		publishedKey := fmt.Sprintf(`%d/%s`, port.PublishedPort, port.Protocol)
		if _, exists := seenPorts[key]; exists {
			return input, errors.New(`typed Caddy contains duplicate target ports`)
		}
		if _, exists := seenPublished[publishedKey]; exists {
			return input, errors.New(`typed Caddy contains duplicate published ports`)
		}
		seenPorts[key] = struct{}{}
		seenPublished[publishedKey] = struct{}{}
	}
	return input, nil
}

func validateTypedCaddyConfigurationRequest(body []byte) (typedCaddyConfigurationRequest, error) {
	var input typedCaddyConfigurationRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return input, fmt.Errorf(`invalid typed Caddy configuration body: %w`, err)
	}
	for field := range fields {
		switch field {
		case `operation`, `caddyfile_base64`, `certificates`:
		default:
			return input, fmt.Errorf(`typed Caddy configuration does not accept field %q`, field)
		}
	}
	if input.Operation != `apply_configuration` {
		return input, errors.New(`typed Caddy configuration operation is not supported`)
	}
	if _, err := decodeTypedCaddyfile(input.CaddyfileBase64); err != nil {
		return input, err
	}
	if len(input.Certificates) > maxTypedCaddyCertificates {
		return input, errors.New(`typed Caddy certificate count is too large`)
	}
	seenIDs := make(map[string]struct{}, len(input.Certificates))
	totalBytes := 0
	for _, certificate := range input.Certificates {
		if !typedCaddyCertificateIDPattern.MatchString(certificate.ID) ||
			len(certificate.Certificate) == 0 || len(certificate.Certificate) > maxTypedCaddyCertificateB ||
			len(certificate.PrivateKey) == 0 || len(certificate.PrivateKey) > maxTypedCaddyCertificateB {
			return input, errors.New(`typed Caddy certificate contains an invalid bounded value`)
		}
		if _, exists := seenIDs[certificate.ID]; exists {
			return input, errors.New(`typed Caddy certificate IDs must be unique`)
		}
		seenIDs[certificate.ID] = struct{}{}
		totalBytes += len(certificate.Certificate) + len(certificate.PrivateKey)
		if totalBytes > maxTypedCaddyArchiveBytes {
			return input, errors.New(`typed Caddy certificate archive is too large`)
		}
		for _, value := range []string{certificate.Certificate, certificate.PrivateKey} {
			if strings.IndexByte(value, 0) >= 0 {
				return input, errors.New(`typed Caddy certificate contains a NUL byte`)
			}
		}
	}
	return input, nil
}

func decodeTypedCaddyfile(value string) ([]byte, error) {
	if value == `` || len(value) > maxTypedCaddyfileBytes*2 {
		return nil, errors.New(`typed Caddy configuration is missing or too large`)
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(decoded) == 0 || len(decoded) > maxTypedCaddyfileBytes || strings.IndexByte(string(decoded), 0) >= 0 {
		return nil, errors.New(`typed Caddy configuration is not valid bounded text`)
	}
	return decoded, nil
}

func (engine *dockerEngineClient) ensureCaddyContainer(ctx context.Context, input typedCaddyRequest) error {
	networkID, err := engine.ensureTypedCaddyNetwork(ctx, input.NetworkName)
	if err != nil {
		return err
	}
	for _, volumeName := range []string{
		typedCaddyRuntimeVolume,
		typedCaddyDataVolume,
		typedCaddyConfigVolume,
		typedCaddyLogsVolume,
	} {
		if err := engine.ensureTypedCaddyVolume(ctx, volumeName); err != nil {
			return err
		}
	}
	if err := engine.ensureTypedCaddyImage(ctx); err != nil {
		return err
	}

	containerBody, status, inspectErr := engine.request(
		ctx,
		http.MethodGet,
		`/containers/`+url.PathEscape(typedCaddyContainerName)+`/json`,
		nil,
	)
	if inspectErr != nil && status != http.StatusNotFound {
		return inspectErr
	}
	if status != http.StatusNotFound {
		var inspection typedCaddyContainerInspection
		if err := json.Unmarshal(containerBody, &inspection); err != nil || inspection.ID == `` {
			return errors.New(`typed Caddy container inspection was incomplete`)
		}
		if inspection.Config.Labels[`com.upstand.component`] != `caddy` ||
			inspection.Config.Labels[`com.upstand.platform`] != `true` {
			return errors.New(`existing Caddy container is not owned by Upstand`)
		}
		if input.ForceRecreate || !typedCaddyContainerMatches(inspection, input) {
			if inspection.State.Running {
				if _, _, err := engine.request(ctx, http.MethodPost, `/containers/`+url.PathEscape(inspection.ID)+`/stop`, nil); err != nil {
					return err
				}
			}
			if _, _, err := engine.request(ctx, http.MethodDelete, `/containers/`+url.PathEscape(inspection.ID)+`?force=true`, nil); err != nil {
				return err
			}
		} else {
			if err := engine.connectTypedCaddyNetwork(ctx, networkID, inspection.ID); err != nil {
				return err
			}
			if !inspection.State.Running {
				_, _, err := engine.request(ctx, http.MethodPost, `/containers/`+url.PathEscape(inspection.ID)+`/start`, nil)
				return err
			}
			return nil
		}
	}

	configBody, err := typedCaddyContainerConfig(input)
	if err != nil {
		return err
	}
	createdBody, _, err := engine.request(
		ctx,
		http.MethodPost,
		`/containers/create?name=`+url.QueryEscape(typedCaddyContainerName),
		configBody,
	)
	if err != nil {
		return err
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal(createdBody, &created); err != nil || created.ID == `` {
		return errors.New(`typed Caddy creation returned no container ID`)
	}
	if err := engine.connectTypedCaddyNetwork(ctx, networkID, created.ID); err != nil {
		_, _, _ = engine.request(ctx, http.MethodDelete, `/containers/`+url.PathEscape(created.ID)+`?force=true`, nil)
		return err
	}
	if _, _, err := engine.request(ctx, http.MethodPost, `/containers/`+url.PathEscape(created.ID)+`/start`, nil); err != nil {
		_, _, _ = engine.request(ctx, http.MethodDelete, `/containers/`+url.PathEscape(created.ID)+`?force=true`, nil)
		return err
	}
	return nil
}

type typedCaddyContainerInspection struct {
	ID     string `json:"Id"`
	Config struct {
		Image      string            `json:"Image"`
		Labels     map[string]string `json:"Labels"`
		Entrypoint []string          `json:"Entrypoint"`
		Cmd        []string          `json:"Cmd"`
	} `json:"Config"`
	HostConfig struct {
		Mounts       []typedCaddyMount                  `json:"Mounts"`
		PortBindings map[string][]typedCaddyPortBinding `json:"PortBindings"`
	} `json:"HostConfig"`
	State struct {
		Running bool `json:"Running"`
	} `json:"State"`
}

type typedCaddyMount struct {
	Type        string `json:"Type"`
	Name        string `json:"Name"`
	Source      string `json:"Source"`
	Destination string `json:"Destination"`
}

type typedCaddyPortBinding struct {
	HostPort string `json:"HostPort"`
}

func typedCaddyContainerMatches(inspection typedCaddyContainerInspection, input typedCaddyRequest) bool {
	if inspection.Config.Image != typedCaddyImage {
		return false
	}
	wantEntrypoint := []string{`/bin/sh`, `-ec`}
	if !equalStringSlices(inspection.Config.Entrypoint, wantEntrypoint) {
		return false
	}
	wantCmd := []string{`if [ ! -s /etc/caddy/Caddyfile ]; then printf '%s' "$UPSTAND_CADDYFILE_B64" | base64 -d > /etc/caddy/Caddyfile; fi; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`}
	if !equalStringSlices(inspection.Config.Cmd, wantCmd) {
		return false
	}
	wantMounts := map[string]string{
		`/etc/caddy`:     typedCaddyRuntimeVolume,
		`/data`:          typedCaddyDataVolume,
		`/config`:        typedCaddyConfigVolume,
		`/var/log/caddy`: typedCaddyLogsVolume,
	}
	gotMounts := make(map[string]string, len(inspection.HostConfig.Mounts))
	for _, mount := range inspection.HostConfig.Mounts {
		if mount.Type == `volume` {
			gotMounts[mount.Destination] = mount.Name
		}
	}
	if len(gotMounts) != len(wantMounts) {
		return false
	}
	for destination, volume := range wantMounts {
		if gotMounts[destination] != volume {
			return false
		}
	}
	wantBindings := typedCaddyPortBindings(input.Ports)
	return equalCaddyPortBindings(inspection.HostConfig.PortBindings, wantBindings)
}

func typedCaddyContainerConfig(input typedCaddyRequest) ([]byte, error) {
	bindings := typedCaddyPortBindings(input.Ports)
	exposed := make(map[string]map[string]any, len(bindings))
	for key := range bindings {
		exposed[key] = map[string]any{}
	}
	return json.Marshal(map[string]any{
		`Labels`: map[string]string{
			`com.upstand.component`: `caddy`,
			`com.upstand.platform`:  `true`,
		},
		`Image`:        typedCaddyImage,
		`Env`:          input.Environment,
		`Entrypoint`:   []string{`/bin/sh`, `-ec`},
		`Cmd`:          []string{`if [ ! -s /etc/caddy/Caddyfile ]; then printf '%s' "$UPSTAND_CADDYFILE_B64" | base64 -d > /etc/caddy/Caddyfile; fi; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`},
		`ExposedPorts`: exposed,
		`HostConfig`: map[string]any{
			`RestartPolicy`: map[string]string{`Name`: `always`},
			`PortBindings`:  bindings,
			`Mounts`: []map[string]string{
				{`Type`: `volume`, `Source`: typedCaddyRuntimeVolume, `Target`: `/etc/caddy`},
				{`Type`: `volume`, `Source`: typedCaddyDataVolume, `Target`: `/data`},
				{`Type`: `volume`, `Source`: typedCaddyConfigVolume, `Target`: `/config`},
				{`Type`: `volume`, `Source`: typedCaddyLogsVolume, `Target`: `/var/log/caddy`},
			},
		},
	})
}

func typedCaddyPortBindings(ports []typedCaddyPort) map[string][]map[string]string {
	bindings := make(map[string][]map[string]string, len(ports))
	for _, port := range ports {
		key := fmt.Sprintf(`%d/%s`, port.TargetPort, port.Protocol)
		bindings[key] = []map[string]string{{`HostPort`: strconv.Itoa(port.PublishedPort)}}
	}
	return bindings
}

func equalCaddyPortBindings(left map[string][]typedCaddyPortBinding, right map[string][]map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, expected := range right {
		actual, ok := left[key]
		if !ok || len(actual) != len(expected) || actual[0].HostPort != expected[0][`HostPort`] {
			return false
		}
	}
	return true
}

func equalStringSlices(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func (engine *dockerEngineClient) ensureTypedCaddyNetwork(ctx context.Context, name string) (string, error) {
	body, status, err := engine.request(ctx, http.MethodGet, `/networks/`+url.PathEscape(name), nil)
	if err != nil && status != http.StatusNotFound {
		return ``, err
	}
	if status == http.StatusNotFound {
		createBody, marshalErr := json.Marshal(map[string]any{
			`Name`: name, `Driver`: `overlay`, `Attachable`: true, `CheckDuplicate`: true,
			`Options`: map[string]string{`encrypted`: ``},
			`Labels`:  map[string]string{`com.upstand.managed`: `true`, `com.upstand.purpose`: `application-routing`},
		})
		if marshalErr != nil {
			return ``, marshalErr
		}
		_, createStatus, createErr := engine.request(ctx, http.MethodPost, `/networks/create`, createBody)
		if createErr != nil && createStatus != http.StatusConflict {
			return ``, createErr
		}
		body, _, err = engine.request(ctx, http.MethodGet, `/networks/`+url.PathEscape(name), nil)
		if err != nil {
			return ``, err
		}
	}
	var network struct {
		ID         string            `json:"Id"`
		Name       string            `json:"Name"`
		Driver     string            `json:"Driver"`
		Scope      string            `json:"Scope"`
		Attachable bool              `json:"Attachable"`
		Options    map[string]string `json:"Options"`
	}
	if err := json.Unmarshal(body, &network); err != nil {
		return ``, fmt.Errorf(`invalid Caddy network inspection: %w`, err)
	}
	if network.ID == `` || network.Name != name || network.Driver != `overlay` || network.Scope != `swarm` || !network.Attachable || !hasEncryptedNetworkOption(network.Options) {
		return ``, errors.New(`Caddy network is not an encrypted attachable Swarm overlay`)
	}
	return network.ID, nil
}

func hasEncryptedNetworkOption(options map[string]string) bool {
	for key := range options {
		if strings.EqualFold(key, `encrypted`) {
			return true
		}
	}
	return false
}

func (engine *dockerEngineClient) ensureTypedCaddyVolume(ctx context.Context, name string) error {
	body, status, err := engine.request(ctx, http.MethodGet, `/volumes/`+url.PathEscape(name), nil)
	if err != nil && status != http.StatusNotFound {
		return err
	}
	if status == http.StatusNotFound {
		createBody, marshalErr := json.Marshal(map[string]any{
			`Name`: name, `Driver`: `local`,
			`Labels`: map[string]string{`com.upstand.managed`: `true`, `com.upstand.component`: `caddy`},
		})
		if marshalErr != nil {
			return marshalErr
		}
		_, _, err = engine.request(ctx, http.MethodPost, `/volumes/create`, createBody)
		return err
	}
	var volume struct {
		Name    string            `json:"Name"`
		Driver  string            `json:"Driver"`
		Options map[string]string `json:"Options"`
	}
	if err := json.Unmarshal(body, &volume); err != nil {
		return fmt.Errorf(`invalid Caddy volume inspection: %w`, err)
	}
	if volume.Name != name || volume.Driver != `local` || len(volume.Options) != 0 {
		return errors.New(`existing Caddy volume is not a plain local managed volume`)
	}
	return nil
}

func (engine *dockerEngineClient) ensureTypedCaddyImage(ctx context.Context) error {
	body, _, err := engine.request(ctx, http.MethodGet, `/images/json`, nil)
	if err != nil {
		return err
	}
	if typedCaddyImagePresent(body) {
		return nil
	}
	_, _, err = engine.request(ctx, http.MethodPost, `/images/create?fromImage=`+url.QueryEscape(typedCaddyImage), nil)
	if err != nil {
		return err
	}
	body, _, err = engine.request(ctx, http.MethodGet, `/images/json`, nil)
	if err != nil || !typedCaddyImagePresent(body) {
		if err != nil {
			return err
		}
		return errors.New(`pulled Caddy image did not match the pinned digest`)
	}
	return nil
}

func typedCaddyImagePresent(body []byte) bool {
	var images []struct {
		RepoDigests []string `json:"RepoDigests"`
	}
	if json.Unmarshal(body, &images) != nil {
		return false
	}
	imageParts := strings.Split(typedCaddyImage, `@`)
	if len(imageParts) != 2 {
		return false
	}
	repository := imageParts[0]
	repository = strings.TrimSuffix(repository, `:2.8-alpine`)
	digest := imageParts[1]
	for _, image := range images {
		for _, repoDigest := range image.RepoDigests {
			if strings.HasPrefix(repoDigest, repository+`@`) && strings.HasSuffix(repoDigest, `@`+digest) {
				return true
			}
		}
	}
	return false
}

func (engine *dockerEngineClient) connectTypedCaddyNetwork(ctx context.Context, networkID, containerID string) error {
	body, err := json.Marshal(map[string]string{`Container`: containerID})
	if err != nil {
		return err
	}
	_, status, err := engine.request(ctx, http.MethodPost, `/networks/`+url.PathEscape(networkID)+`/connect`, body)
	if err != nil && (status == http.StatusForbidden || status == http.StatusConflict) {
		return nil
	}
	return err
}

func (engine *dockerEngineClient) applyTypedCaddyConfiguration(ctx context.Context, input typedCaddyConfigurationRequest) (bool, error) {
	containerBody, _, err := engine.request(
		ctx,
		http.MethodGet,
		`/containers/`+url.PathEscape(typedCaddyContainerName)+`/json`,
		nil,
	)
	if err != nil {
		return false, err
	}
	var inspection typedCaddyContainerInspection
	if err := json.Unmarshal(containerBody, &inspection); err != nil || inspection.ID == `` ||
		inspection.Config.Image != typedCaddyImage ||
		inspection.Config.Labels[`com.upstand.component`] != `caddy` ||
		inspection.Config.Labels[`com.upstand.platform`] != `true` {
		return false, errors.New(`existing Caddy container is not the managed pinned container`)
	}
	archive, err := typedCaddyConfigurationArchive(input)
	if err != nil {
		return false, err
	}
	_, _, err = engine.requestRaw(
		ctx,
		http.MethodPut,
		`/containers/`+url.PathEscape(inspection.ID)+`/archive?path=`+url.QueryEscape(`/etc/caddy`),
		archive,
		`application/x-tar`,
	)
	if err != nil {
		return false, err
	}
	if _, err := engine.runTypedCaddyCommand(ctx, inspection.ID, []string{`caddy`, `fmt`, `--overwrite`, `/etc/caddy/Caddyfile.next`}); err != nil {
		return false, err
	}
	active, err := engine.runTypedCaddyCommand(ctx, inspection.ID, []string{`cat`, `/etc/caddy/Caddyfile`})
	if err != nil {
		return false, err
	}
	candidate, err := engine.runTypedCaddyCommand(ctx, inspection.ID, []string{`cat`, `/etc/caddy/Caddyfile.next`})
	if err != nil {
		return false, err
	}
	if active == candidate {
		_, err = engine.runTypedCaddyCommand(ctx, inspection.ID, []string{`/bin/sh`, `-ec`, `rm -f /etc/caddy/Caddyfile.next`})
		return false, err
	}
	if _, err = engine.runTypedCaddyCommand(ctx, inspection.ID, []string{`/bin/sh`, `-ec`, `cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.previous`}); err != nil {
		return false, err
	}
	if _, err = engine.runTypedCaddyCommand(ctx, inspection.ID, []string{`caddy`, `validate`, `--config`, `/etc/caddy/Caddyfile.next`, `--adapter`, `caddyfile`}); err != nil {
		return false, engine.rollbackTypedCaddyConfiguration(ctx, inspection.ID, err)
	}
	if _, err = engine.runTypedCaddyCommand(ctx, inspection.ID, []string{`/bin/sh`, `-ec`, `mv /etc/caddy/Caddyfile.next /etc/caddy/Caddyfile`}); err != nil {
		return false, engine.rollbackTypedCaddyConfiguration(ctx, inspection.ID, err)
	}
	if _, err = engine.runTypedCaddyCommand(ctx, inspection.ID, []string{`caddy`, `reload`, `--config`, `/etc/caddy/Caddyfile`, `--adapter`, `caddyfile`}); err != nil {
		return false, engine.rollbackTypedCaddyConfiguration(ctx, inspection.ID, err)
	}
	if _, err = engine.runTypedCaddyCommand(ctx, inspection.ID, []string{`/bin/sh`, `-ec`, `rm -f /etc/caddy/Caddyfile.previous`}); err != nil {
		return false, err
	}
	return true, nil
}

func (engine *dockerEngineClient) rollbackTypedCaddyConfiguration(ctx context.Context, containerID string, original error) error {
	_, rollbackErr := engine.runTypedCaddyCommand(ctx, containerID, []string{`/bin/sh`, `-ec`, `if [ -f /etc/caddy/Caddyfile.previous ]; then mv /etc/caddy/Caddyfile.previous /etc/caddy/Caddyfile; fi; rm -f /etc/caddy/Caddyfile.next`})
	if rollbackErr != nil {
		return fmt.Errorf(`Caddy configuration failed and rollback failed: %v`, original)
	}
	return original
}

func typedCaddyConfigurationArchive(input typedCaddyConfigurationRequest) ([]byte, error) {
	archive := new(bytes.Buffer)
	writer := tar.NewWriter(archive)
	configuration, err := decodeTypedCaddyfile(input.CaddyfileBase64)
	if err != nil {
		return nil, err
	}
	writeEntry := func(name string, content []byte, mode int64) error {
		if err := writer.WriteHeader(&tar.Header{Name: name, Mode: mode, Size: int64(len(content))}); err != nil {
			return err
		}
		_, err := writer.Write(content)
		return err
	}
	if err := writeEntry(`Caddyfile.next`, configuration, 0o644); err != nil {
		return nil, err
	}
	for _, certificate := range input.Certificates {
		if err := writeEntry(`certificates/`+certificate.ID+`.crt`, []byte(certificate.Certificate), 0o644); err != nil {
			return nil, err
		}
		if err := writeEntry(`certificates/`+certificate.ID+`.key`, []byte(certificate.PrivateKey), 0o600); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	if archive.Len() > maxTypedCaddyArchiveBytes {
		return nil, errors.New(`typed Caddy configuration archive is too large`)
	}
	return archive.Bytes(), nil
}

func (engine *dockerEngineClient) runTypedCaddyCommand(ctx context.Context, containerID string, command []string) (string, error) {
	createBody, err := json.Marshal(map[string]any{
		`Cmd`: command, `AttachStdout`: true, `AttachStderr`: true, `Tty`: false,
	})
	if err != nil {
		return ``, err
	}
	createdBody, _, err := engine.request(ctx, http.MethodPost, `/containers/`+url.PathEscape(containerID)+`/exec`, createBody)
	if err != nil {
		return ``, err
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal(createdBody, &created); err != nil || created.ID == `` {
		return ``, errors.New(`typed Caddy exec creation returned no ID`)
	}
	startBody, err := json.Marshal(map[string]bool{`Detach`: false, `Tty`: false})
	if err != nil {
		return ``, err
	}
	output, _, err := engine.request(ctx, http.MethodPost, `/exec/`+url.PathEscape(created.ID)+`/start`, startBody)
	if err != nil {
		return ``, err
	}
	inspectBody, _, err := engine.request(ctx, http.MethodGet, `/exec/`+url.PathEscape(created.ID)+`/json`, nil)
	if err != nil {
		return ``, err
	}
	var inspection struct {
		Running  bool `json:"Running"`
		ExitCode int  `json:"ExitCode"`
	}
	if err := json.Unmarshal(inspectBody, &inspection); err != nil || inspection.Running {
		return ``, errors.New(`typed Caddy exec did not settle`)
	}
	cleaned := decodeTypedCaddyExecOutput(output)
	if inspection.ExitCode != 0 {
		return ``, errors.New(`typed Caddy command failed`)
	}
	return string(cleaned), nil
}

func decodeTypedCaddyExecOutput(output []byte) []byte {
	if len(output) < 8 {
		return output
	}
	var cleaned bytes.Buffer
	for offset := 0; offset+8 <= len(output); {
		size := int(binary.BigEndian.Uint32(output[offset+4 : offset+8]))
		if size < 0 || offset+8+size > len(output) {
			return output
		}
		cleaned.Write(output[offset+8 : offset+8+size])
		offset += 8 + size
	}
	if cleaned.Len() == 0 && len(output) != 0 {
		return output
	}
	return cleaned.Bytes()
}

func (engine *dockerEngineClient) requestRaw(ctx context.Context, method, path string, body []byte, contentType string) ([]byte, int, error) {
	request, err := http.NewRequestWithContext(ctx, method, `http://docker-engine`+path, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set(`Content-Type`, contentType)
	request.ContentLength = int64(len(body))
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
