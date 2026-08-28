package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
)

const typedResourceTeardownPath = typedServerPrefix + `resource-teardown`

type typedResourceTeardownRequest struct {
	Operation     string `json:"operation"`
	ResourceID    string `json:"resource_id"`
	ProjectName   string `json:"project_name"`
	ComposeType   string `json:"compose_type"`
	DeleteVolumes bool   `json:"delete_volumes,omitempty"`
}

func validateTypedResourceTeardownRequest(body []byte) (typedResourceTeardownRequest, error) {
	var input typedResourceTeardownRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	var fields map[string]any
	if err := json.Unmarshal(body, &fields); err != nil {
		return input, fmt.Errorf(`invalid typed resource teardown body: %w`, err)
	}
	for field := range fields {
		if field != `operation` && field != `resource_id` && field != `project_name` && field != `compose_type` && field != `delete_volumes` {
			return input, fmt.Errorf(`typed resource teardown does not accept field %q`, field)
		}
	}
	if input.Operation != `remove` ||
		!resourceIDPattern.MatchString(input.ResourceID) ||
		!swarmNamePattern.MatchString(input.ProjectName) ||
		(input.ComposeType != `compose` && input.ComposeType != `stack`) {
		return input, errors.New(`typed resource teardown identity or operation is invalid`)
	}
	return input, nil
}

func (engine *dockerEngineClient) resourceTeardownOperation(ctx context.Context, body []byte) error {
	input, err := validateTypedResourceTeardownRequest(body)
	if err != nil {
		return err
	}
	if input.ComposeType == `compose` {
		if err := engine.removeOwnedComposeContainers(ctx, input); err != nil {
			return err
		}
		if err := engine.removeOwnedProjectNetworks(ctx, input); err != nil {
			return err
		}
		if input.DeleteVolumes {
			return engine.removeOwnedProjectVolumes(ctx, input)
		}
		return nil
	}
	if err := engine.removeOwnedStackServices(ctx, input); err != nil {
		return err
	}
	if err := engine.removeOwnedProjectNetworks(ctx, input); err != nil {
		return err
	}
	if input.DeleteVolumes {
		return engine.removeOwnedProjectVolumes(ctx, input)
	}
	return nil
}

func (engine *dockerEngineClient) removeOwnedComposeContainers(ctx context.Context, input typedResourceTeardownRequest) error {
	filter := url.QueryEscape(`{"label":["com.docker.compose.project=` + input.ProjectName + `"]}`)
	body, _, err := engine.request(ctx, http.MethodGet, `/containers/json?all=true&filters=`+filter, nil)
	if err != nil {
		return err
	}
	var containers []struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal(body, &containers); err != nil {
		return fmt.Errorf(`invalid Docker Compose container listing: %w`, err)
	}
	for _, container := range containers {
		if container.ID == `` {
			return errors.New(`Docker Compose container listing contained an empty ID`)
		}
		if err := engine.assertOwnedContainer(ctx, container.ID, input.ResourceID); err != nil {
			return err
		}
	}
	for _, container := range containers {
		_, status, err := engine.request(ctx, http.MethodDelete, `/containers/`+url.PathEscape(container.ID)+`?force=true`, nil)
		if err != nil && status != http.StatusNotFound {
			return err
		}
	}
	return nil
}

func (engine *dockerEngineClient) removeOwnedStackServices(ctx context.Context, input typedResourceTeardownRequest) error {
	filter := url.QueryEscape(`{"label":["com.docker.stack.namespace=` + input.ProjectName + `"]}`)
	body, _, err := engine.request(ctx, http.MethodGet, `/services?filters=`+filter, nil)
	if err != nil {
		return err
	}
	var services []struct {
		ID string `json:"ID"`
	}
	if err := json.Unmarshal(body, &services); err != nil {
		return fmt.Errorf(`invalid Docker stack service listing: %w`, err)
	}
	for _, service := range services {
		if service.ID == `` {
			return errors.New(`Docker stack service listing contained an empty ID`)
		}
		serviceBody, _, err := engine.request(ctx, http.MethodGet, `/services/`+url.PathEscape(service.ID), nil)
		if err != nil {
			return err
		}
		var inspection struct {
			Spec struct {
				Labels map[string]string `json:"Labels"`
			} `json:"Spec"`
		}
		if err := json.Unmarshal(serviceBody, &inspection); err != nil {
			return fmt.Errorf(`invalid Docker stack service inspection: %w`, err)
		}
		if inspection.Spec.Labels[`com.upstand.resource-id`] != input.ResourceID {
			return errors.New(`Docker stack service is not owned by the requested Upstand resource`)
		}
	}
	for _, service := range services {
		_, status, err := engine.request(ctx, http.MethodDelete, `/services/`+url.PathEscape(service.ID), nil)
		if err != nil && status != http.StatusNotFound {
			return err
		}
	}
	return nil
}

func (engine *dockerEngineClient) removeOwnedProjectNetworks(ctx context.Context, input typedResourceTeardownRequest) error {
	label := `com.docker.compose.project=` + input.ProjectName
	if input.ComposeType == `stack` {
		label = `com.docker.stack.namespace=` + input.ProjectName
	}
	filter := url.QueryEscape(`{"label":["` + label + `"]}`)
	body, _, err := engine.request(ctx, http.MethodGet, `/networks?filters=`+filter, nil)
	if err != nil {
		return err
	}
	var networks []struct {
		ID     string            `json:"Id"`
		Labels map[string]string `json:"Labels"`
	}
	if err := json.Unmarshal(body, &networks); err != nil {
		return fmt.Errorf(`invalid Docker project network listing: %w`, err)
	}
	for _, network := range networks {
		if network.ID == `` || network.Labels[labelKey(input)] != input.ProjectName {
			return errors.New(`Docker project network ownership could not be verified`)
		}
	}
	for _, network := range networks {
		_, status, err := engine.request(ctx, http.MethodDelete, `/networks/`+url.PathEscape(network.ID), nil)
		if err != nil && status != http.StatusNotFound {
			return err
		}
	}
	return nil
}

func (engine *dockerEngineClient) removeOwnedProjectVolumes(ctx context.Context, input typedResourceTeardownRequest) error {
	label := labelKey(input)
	filter := url.QueryEscape(`{"label":["` + label + `=` + input.ProjectName + `"]}`)
	body, _, err := engine.request(ctx, http.MethodGet, `/volumes?filters=`+filter, nil)
	if err != nil {
		return err
	}
	var listing struct {
		Volumes []struct {
			Name    string            `json:"Name"`
			Driver  string            `json:"Driver"`
			Options map[string]string `json:"Options"`
			Labels  map[string]string `json:"Labels"`
		} `json:"Volumes"`
	}
	if err := json.Unmarshal(body, &listing); err != nil {
		return fmt.Errorf(`invalid Docker project volume listing: %w`, err)
	}
	for _, volume := range listing.Volumes {
		if volume.Name == `` || volume.Labels[label] != input.ProjectName || volume.Driver != `local` || len(volume.Options) != 0 {
			return errors.New(`Docker project volume is not a managed local volume owned by the requested project`)
		}
	}
	for _, volume := range listing.Volumes {
		_, status, err := engine.request(ctx, http.MethodDelete, `/volumes/`+url.PathEscape(volume.Name), nil)
		if err != nil && status != http.StatusNotFound {
			return err
		}
	}
	return nil
}

func labelKey(input typedResourceTeardownRequest) string {
	if input.ComposeType == `stack` {
		return `com.docker.stack.namespace`
	}
	return `com.docker.compose.project`
}

func (engine *dockerEngineClient) assertOwnedContainer(ctx context.Context, containerID, resourceID string) error {
	body, _, err := engine.request(ctx, http.MethodGet, `/containers/`+url.PathEscape(containerID)+`/json`, nil)
	if err != nil {
		return err
	}
	var inspection struct {
		Config struct {
			Labels map[string]string `json:"Labels"`
		} `json:"Config"`
	}
	if err := json.Unmarshal(body, &inspection); err != nil {
		return fmt.Errorf(`invalid Docker container inspection: %w`, err)
	}
	if inspection.Config.Labels[`com.upstand.resource-id`] != resourceID {
		return errors.New(`Docker Compose container is not owned by the requested Upstand resource`)
	}
	return nil
}
