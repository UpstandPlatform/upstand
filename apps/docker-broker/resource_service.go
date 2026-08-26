package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

const (
	typedResourceServicePath    = typedServerPrefix + `resource-service`
	maxResourceServiceSpecBytes = 512 << 10
	maxRegistryAuthHeaderBytes  = 16 << 10
)

var (
	typedResourceServiceOperationPattern = regexp.MustCompile(`^(upsert|ensure_network|remove|promote_revision|scale)$`)
	typedResourceServiceNetworkPattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$`)
)

type typedResourceServiceRequest struct {
	Operation           string          `json:"operation"`
	ResourceID          string          `json:"resource_id"`
	ServiceName         string          `json:"service_name"`
	RevisionServiceName string          `json:"revision_service_name,omitempty"`
	NetworkID           string          `json:"network_id,omitempty"`
	Replicas            *int            `json:"replicas,omitempty"`
	Spec                json.RawMessage `json:"spec,omitempty"`
}

func validateTypedResourceServiceRequest(body []byte) (typedResourceServiceRequest, error) {
	var input typedResourceServiceRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return input, fmt.Errorf(`invalid typed resource service body: %w`, err)
	}
	for field := range fields {
		if field != `operation` && field != `resource_id` && field != `service_name` && field != `revision_service_name` && field != `network_id` && field != `replicas` && field != `spec` {
			return input, fmt.Errorf(`typed resource service does not accept field %q`, field)
		}
	}
	if !typedResourceServiceOperationPattern.MatchString(input.Operation) {
		return input, errors.New(`typed resource service operation is not supported`)
	}
	if !resourceIDPattern.MatchString(input.ResourceID) || !swarmNamePattern.MatchString(input.ServiceName) {
		return input, errors.New(`typed resource service identity is invalid`)
	}
	switch input.Operation {
	case `upsert`:
		if len(input.Spec) == 0 || len(input.Spec) > maxResourceServiceSpecBytes {
			return input, errors.New(`typed resource service spec is missing or out of bounds`)
		}
		if input.NetworkID != `` {
			return input, errors.New(`typed resource service upsert does not accept a network ID`)
		}
		if err := validateTypedResourceServiceSpec(input.Spec, input.ResourceID, input.ServiceName); err != nil {
			return input, err
		}
	case `ensure_network`:
		if !typedResourceServiceNetworkPattern.MatchString(input.NetworkID) {
			return input, errors.New(`typed resource service network ID is invalid`)
		}
		if len(input.Spec) != 0 {
			return input, errors.New(`typed resource service network attachment does not accept a service spec`)
		}
	case `remove`:
		if input.RevisionServiceName != `` || input.NetworkID != `` || len(input.Spec) != 0 {
			return input, errors.New(`typed resource service removal does not accept network or service spec fields`)
		}
	case `promote_revision`:
		if input.RevisionServiceName == `` || !swarmNamePattern.MatchString(input.RevisionServiceName) {
			return input, errors.New(`typed resource revision service name is invalid`)
		}
		if !strings.HasPrefix(input.RevisionServiceName, input.ServiceName+`-`) {
			return input, errors.New(`typed resource revision service name does not belong to the base service`)
		}
		if input.NetworkID != `` || len(input.Spec) != 0 {
			return input, errors.New(`typed resource revision promotion does not accept network or service spec fields`)
		}
	case `scale`:
		if input.Replicas == nil || *input.Replicas < 0 || *input.Replicas > 1000 {
			return input, errors.New(`typed resource service replica count is invalid`)
		}
		if input.RevisionServiceName != `` || input.NetworkID != `` || len(input.Spec) != 0 {
			return input, errors.New(`typed resource service scaling does not accept revision, network, or service spec fields`)
		}
	}
	return input, nil
}

func validateTypedResourceServiceRegistryAuth(value string) (string, error) {
	if value == `` {
		return ``, nil
	}
	if len(value) > maxRegistryAuthHeaderBytes {
		return ``, errors.New(`typed registry authentication exceeds its size limit`)
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(decoded) == 0 || len(decoded) > maxRegistryAuthHeaderBytes {
		return ``, errors.New(`typed registry authentication is not valid base64`)
	}
	var auth struct {
		Username      string `json:"username"`
		Password      string `json:"password"`
		ServerAddress string `json:"serveraddress,omitempty"`
	}
	decoder := json.NewDecoder(bytes.NewReader(decoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&auth); err != nil || auth.Username == `` || auth.Password == `` {
		return ``, errors.New(`typed registry authentication has an invalid shape`)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return ``, errors.New(`typed registry authentication contains trailing data`)
	}
	if len(auth.Username) > 4096 || len(auth.Password) > 4096 || len(auth.ServerAddress) > 4096 {
		return ``, errors.New(`typed registry authentication contains an oversized value`)
	}
	for _, item := range []string{auth.Username, auth.Password, auth.ServerAddress} {
		for _, character := range item {
			if character < 0x20 || character == 0x7f {
				return ``, errors.New(`typed registry authentication contains a control character`)
			}
		}
	}
	return value, nil
}

func validateTypedResourceServiceSpec(body []byte, resourceID, serviceName string) error {
	if err := rejectHostEscapeJSON(body); err != nil {
		return fmt.Errorf(`typed resource service spec violates the host-escape policy: %w`, err)
	}
	var spec map[string]json.RawMessage
	if err := json.Unmarshal(body, &spec); err != nil {
		return fmt.Errorf(`invalid typed resource service spec: %w`, err)
	}
	if len(spec) == 0 {
		return errors.New(`typed resource service spec must be an object`)
	}
	for field := range spec {
		switch field {
		case `Name`, `Labels`, `TaskTemplate`, `Mode`, `UpdateConfig`, `RollbackConfig`, `EndpointSpec`:
		default:
			return fmt.Errorf(`typed resource service spec does not accept field %q`, field)
		}
	}
	var name string
	if raw, ok := spec[`Name`]; !ok || json.Unmarshal(raw, &name) != nil || name != serviceName {
		return errors.New(`typed resource service spec name does not match the requested service`)
	}
	var labels map[string]string
	rawLabels, ok := spec[`Labels`]
	if !ok || json.Unmarshal(rawLabels, &labels) != nil || labels[`com.upstand.resource-id`] != resourceID {
		return errors.New(`typed resource service spec must carry the exact resource ownership label`)
	}
	if len(labels) > 64 {
		return errors.New(`typed resource service spec contains too many labels`)
	}
	for key, value := range labels {
		if !isSafeSwarmLabel(key, 128) || !isSafeSwarmLabel(value, 512) {
			return errors.New(`typed resource service spec contains an unsafe label`)
		}
	}
	if rawTaskTemplate, ok := spec[`TaskTemplate`]; ok {
		var taskTemplate map[string]json.RawMessage
		if err := json.Unmarshal(rawTaskTemplate, &taskTemplate); err != nil || len(taskTemplate) == 0 {
			return errors.New(`typed resource service task template is invalid`)
		}
		for field := range taskTemplate {
			switch field {
			case `ContainerSpec`, `Resources`, `RestartPolicy`, `Placement`, `Networks`, `ForceUpdate`, `Runtime`, `LogDriver`:
			default:
				return fmt.Errorf(`typed resource service task template does not accept field %q`, field)
			}
		}
		if rawNetworks, ok := taskTemplate[`Networks`]; ok {
			var networks []struct {
				Target string `json:"Target"`
			}
			if json.Unmarshal(rawNetworks, &networks) != nil || len(networks) > 32 {
				return errors.New(`typed resource service networks are invalid or unbounded`)
			}
			for _, network := range networks {
				if !typedResourceServiceNetworkPattern.MatchString(network.Target) {
					return errors.New(`typed resource service network target is invalid`)
				}
			}
		}
		if rawContainerSpec, ok := taskTemplate[`ContainerSpec`]; ok {
			if err := validateTypedResourceContainerSpec(rawContainerSpec); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateTypedResourceContainerSpec(body []byte) error {
	var containerSpec map[string]json.RawMessage
	if err := json.Unmarshal(body, &containerSpec); err != nil || len(containerSpec) == 0 {
		return errors.New(`typed resource service container spec is invalid`)
	}
	rawMounts, ok := containerSpec[`Mounts`]
	if !ok {
		return nil
	}
	var mounts []struct {
		Type   string `json:"Type"`
		Source string `json:"Source"`
		Target string `json:"Target"`
	}
	if err := json.Unmarshal(rawMounts, &mounts); err != nil || len(mounts) > 64 {
		return errors.New(`typed resource service mounts are invalid or unbounded`)
	}
	for _, mount := range mounts {
		// A typed resource service may use Docker-managed named volumes, but it
		// must never turn the broker into a host bind-mount primitive. The
		// source-side Compose validator applies the same boundary to Compose.
		if mount.Type != `volume` || !swarmNamePattern.MatchString(mount.Source) ||
			mount.Target == `` || !strings.HasPrefix(mount.Target, `/`) ||
			strings.Contains(mount.Target, `..`) {
			return errors.New(`typed resource service mounts must use safe named Docker volumes`)
		}
	}
	return nil
}

func (engine *dockerEngineClient) resourceServiceOperation(ctx context.Context, body []byte, registryAuth string) error {
	input, err := validateTypedResourceServiceRequest(body)
	if err != nil {
		return err
	}
	if input.Operation == `remove` {
		if registryAuth != `` {
			return errors.New(`typed registry authentication is only valid for service upsert`)
		}
		return engine.removeResourceService(ctx, input)
	}
	if input.Operation == `promote_revision` {
		if registryAuth != `` {
			return errors.New(`typed registry authentication is not valid for revision promotion`)
		}
		return engine.promoteResourceServiceRevision(ctx, input)
	}
	if input.Operation == `scale` {
		if registryAuth != `` {
			return errors.New(`typed registry authentication is not valid for service scaling`)
		}
		return engine.scaleResourceService(ctx, input)
	}
	if input.Operation == `ensure_network` {
		if registryAuth != `` {
			return errors.New(`typed registry authentication is only valid for service upsert`)
		}
		return engine.ensureResourceServiceNetwork(ctx, input)
	}
	registryAuth, err = validateTypedResourceServiceRegistryAuth(registryAuth)
	if err != nil {
		return err
	}

	serviceBody, status, inspectErr := engine.request(
		ctx,
		http.MethodGet,
		`/services/`+url.PathEscape(input.ServiceName),
		nil,
	)
	if inspectErr != nil && status != http.StatusNotFound {
		return inspectErr
	}
	if status == http.StatusNotFound {
		_, _, err = engine.requestWithHeaders(ctx, http.MethodPost, `/services/create`, input.Spec, registryAuth)
		return err
	}

	var inspection struct {
		ID      string `json:"ID"`
		Version struct {
			Index uint64 `json:"Index"`
		} `json:"Version"`
		Spec map[string]any `json:"Spec"`
	}
	if err := json.Unmarshal(serviceBody, &inspection); err != nil {
		return fmt.Errorf(`invalid Docker service inspection: %w`, err)
	}
	if inspection.ID == `` || inspection.Version.Index == 0 || inspection.Spec == nil {
		return errors.New(`Docker service inspection was incomplete`)
	}
	if !resourceServiceHasOwnerLabel(inspection.Spec, input.ResourceID) {
		return errors.New(`existing Docker service is not owned by the requested Upstand resource`)
	}

	var requested map[string]any
	if err := json.Unmarshal(input.Spec, &requested); err != nil {
		return fmt.Errorf(`invalid typed resource service update: %w`, err)
	}
	for _, field := range []string{`Name`, `Labels`, `TaskTemplate`, `Mode`, `UpdateConfig`, `RollbackConfig`, `EndpointSpec`} {
		if value, ok := requested[field]; ok {
			inspection.Spec[field] = value
		}
	}
	inspection.Spec[`Name`] = input.ServiceName
	updateBody, err := json.Marshal(inspection.Spec)
	if err != nil {
		return err
	}
	_, _, err = engine.requestWithHeaders(
		ctx,
		http.MethodPost,
		`/services/`+url.PathEscape(inspection.ID)+`/update?version=`+fmt.Sprint(inspection.Version.Index),
		updateBody,
		registryAuth,
	)
	return err
}

func (engine *dockerEngineClient) scaleResourceService(ctx context.Context, input typedResourceServiceRequest) error {
	serviceBody, _, err := engine.request(ctx, http.MethodGet, `/services/`+url.PathEscape(input.ServiceName), nil)
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
	if err := json.Unmarshal(serviceBody, &inspection); err != nil || inspection.ID == `` || inspection.Version.Index == 0 || inspection.Spec == nil {
		return errors.New(`Docker service inspection was incomplete`)
	}
	if !resourceServiceHasOwnerLabel(inspection.Spec, input.ResourceID) {
		return errors.New(`existing Docker service is not owned by the requested Upstand resource`)
	}
	update := map[string]any{
		`Name`:           input.ServiceName,
		`Mode`:           map[string]any{`Replicated`: map[string]any{`Replicas`: *input.Replicas}},
		`TaskTemplate`:   inspection.Spec[`TaskTemplate`],
		`EndpointSpec`:   inspection.Spec[`EndpointSpec`],
		`UpdateConfig`:   inspection.Spec[`UpdateConfig`],
		`RollbackConfig`: inspection.Spec[`RollbackConfig`],
	}
	updateBody, err := json.Marshal(update)
	if err != nil {
		return err
	}
	_, _, err = engine.request(ctx, http.MethodPost, `/services/`+url.PathEscape(inspection.ID)+`/update?version=`+fmt.Sprint(inspection.Version.Index), updateBody)
	return err
}

func (engine *dockerEngineClient) promoteResourceServiceRevision(ctx context.Context, input typedResourceServiceRequest) error {
	baseBody, _, err := engine.request(ctx, http.MethodGet, `/services/`+url.PathEscape(input.ServiceName), nil)
	if err != nil {
		return err
	}
	revisionBody, _, err := engine.request(ctx, http.MethodGet, `/services/`+url.PathEscape(input.RevisionServiceName), nil)
	if err != nil {
		return err
	}
	var base struct {
		ID      string `json:"ID"`
		Version struct {
			Index uint64 `json:"Index"`
		} `json:"Version"`
		Spec map[string]any `json:"Spec"`
	}
	var revision struct {
		Spec map[string]any `json:"Spec"`
	}
	if err := json.Unmarshal(baseBody, &base); err != nil || base.ID == `` || base.Version.Index == 0 || base.Spec == nil {
		return errors.New(`base Docker service inspection was incomplete`)
	}
	if err := json.Unmarshal(revisionBody, &revision); err != nil || revision.Spec == nil {
		return errors.New(`revision Docker service inspection was incomplete`)
	}
	if !resourceServiceHasOwnerLabel(base.Spec, input.ResourceID) {
		return errors.New(`base Docker service is not owned by the requested Upstand resource`)
	}
	if !resourceServiceHasOwnerLabel(revision.Spec, input.ResourceID) || !resourceServiceIsRevision(revision.Spec) {
		return errors.New(`deployment revision does not belong to the requested Upstand resource`)
	}
	update := map[string]any{
		`Name`:           input.ServiceName,
		`Mode`:           base.Spec[`Mode`],
		`TaskTemplate`:   revision.Spec[`TaskTemplate`],
		`EndpointSpec`:   base.Spec[`EndpointSpec`],
		`UpdateConfig`:   base.Spec[`UpdateConfig`],
		`RollbackConfig`: base.Spec[`RollbackConfig`],
	}
	updateBody, err := json.Marshal(update)
	if err != nil {
		return err
	}
	_, _, err = engine.request(ctx, http.MethodPost, `/services/`+url.PathEscape(base.ID)+`/update?version=`+fmt.Sprint(base.Version.Index), updateBody)
	return err
}

func (engine *dockerEngineClient) removeResourceService(ctx context.Context, input typedResourceServiceRequest) error {
	serviceBody, status, err := engine.request(
		ctx,
		http.MethodGet,
		`/services/`+url.PathEscape(input.ServiceName),
		nil,
	)
	if err != nil {
		if status == http.StatusNotFound {
			return nil
		}
		return err
	}
	var inspection struct {
		ID   string         `json:"ID"`
		Spec map[string]any `json:"Spec"`
	}
	if err := json.Unmarshal(serviceBody, &inspection); err != nil {
		return fmt.Errorf(`invalid Docker service inspection: %w`, err)
	}
	if inspection.ID == `` || inspection.Spec == nil {
		return errors.New(`Docker service inspection was incomplete`)
	}
	if !resourceServiceHasOwnerLabel(inspection.Spec, input.ResourceID) {
		return errors.New(`existing Docker service is not owned by the requested Upstand resource`)
	}
	_, status, err = engine.request(
		ctx,
		http.MethodDelete,
		`/services/`+url.PathEscape(inspection.ID),
		nil,
	)
	if err != nil && status == http.StatusNotFound {
		return nil
	}
	return err
}

func (engine *dockerEngineClient) ensureResourceServiceNetwork(ctx context.Context, input typedResourceServiceRequest) error {
	serviceBody, _, err := engine.request(ctx, http.MethodGet, `/services/`+url.PathEscape(input.ServiceName), nil)
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
	if err := json.Unmarshal(serviceBody, &inspection); err != nil {
		return fmt.Errorf(`invalid Docker service inspection: %w`, err)
	}
	if inspection.ID == `` || inspection.Version.Index == 0 || inspection.Spec == nil || !resourceServiceHasOwnerLabel(inspection.Spec, input.ResourceID) {
		return errors.New(`existing Docker service is not owned by the requested Upstand resource`)
	}
	networkBody, _, err := engine.request(ctx, http.MethodGet, `/networks/`+url.PathEscape(input.NetworkID), nil)
	if err != nil {
		return err
	}
	var network struct {
		Driver string `json:"Driver"`
	}
	if err := json.Unmarshal(networkBody, &network); err != nil || network.Driver != `overlay` {
		return errors.New(`typed resource service network must be an overlay network`)
	}
	taskTemplate, ok := inspection.Spec[`TaskTemplate`].(map[string]any)
	if !ok {
		return errors.New(`Docker service inspection has no task template`)
	}
	networks, _ := taskTemplate[`Networks`].([]any)
	for _, value := range networks {
		if network, ok := value.(map[string]any); ok && network[`Target`] == input.NetworkID {
			return nil
		}
	}
	taskTemplate[`Networks`] = append(networks, map[string]any{`Target`: input.NetworkID})
	inspection.Spec[`TaskTemplate`] = taskTemplate
	updateBody, err := json.Marshal(inspection.Spec)
	if err != nil {
		return err
	}
	_, _, err = engine.request(ctx, http.MethodPost, `/services/`+url.PathEscape(inspection.ID)+`/update?version=`+fmt.Sprint(inspection.Version.Index), updateBody)
	return err
}

func resourceServiceHasOwnerLabel(spec map[string]any, resourceID string) bool {
	labels, ok := spec[`Labels`].(map[string]any)
	if !ok {
		return false
	}
	owner, ok := labels[`com.upstand.resource-id`].(string)
	return ok && owner == resourceID
}

func resourceServiceIsRevision(spec map[string]any) bool {
	labels, ok := spec[`Labels`].(map[string]any)
	if !ok {
		return false
	}
	value, ok := labels[`com.upstand.deployment-revision`].(string)
	return ok && value == `true`
}
