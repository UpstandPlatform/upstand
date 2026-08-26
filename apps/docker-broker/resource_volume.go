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

const typedResourceVolumePath = typedServerPrefix + `resource-volume`

var typedResourceVolumeOperationPattern = regexp.MustCompile(`^(ensure|remove)$`)
var typedResourceVolumePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$`)
var typedResourceVolumeKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`)

type typedResourceVolumeRequest struct {
	Operation   string `json:"operation"`
	ResourceID  string `json:"resource_id"`
	VolumeID    string `json:"volume_id,omitempty"`
	VolumeKey   string `json:"volume_key,omitempty"`
	ProjectName string `json:"project_name,omitempty"`
	ComposeType string `json:"compose_type,omitempty"`
}

func validateTypedResourceVolumeRequest(body []byte) (typedResourceVolumeRequest, error) {
	var input typedResourceVolumeRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	var fields map[string]any
	if err := json.Unmarshal(body, &fields); err != nil {
		return input, fmt.Errorf(`invalid typed resource volume body: %w`, err)
	}
	for field := range fields {
		if field != `operation` && field != `resource_id` && field != `volume_id` && field != `volume_key` && field != `project_name` && field != `compose_type` {
			return input, fmt.Errorf(`typed resource volume does not accept field %q`, field)
		}
	}
	if !typedResourceVolumeOperationPattern.MatchString(input.Operation) {
		return input, errors.New(`typed resource volume operation is not supported`)
	}
	if !resourceIDPattern.MatchString(input.ResourceID) {
		return input, errors.New(`typed resource volume identity is invalid`)
	}
	if input.ProjectName != `` && !swarmNamePattern.MatchString(input.ProjectName) {
		return input, errors.New(`typed resource volume project name is invalid`)
	}
	if input.ComposeType != `` && input.ComposeType != `compose` && input.ComposeType != `stack` {
		return input, errors.New(`typed resource volume compose type is invalid`)
	}
	if input.Operation == `remove` {
		if !typedResourceVolumePattern.MatchString(input.VolumeID) || input.VolumeKey != `` || input.ProjectName != `` || input.ComposeType != `` {
			return input, errors.New(`typed resource volume removal identity is invalid`)
		}
	} else if input.VolumeID != `` || !typedResourceVolumeKeyPattern.MatchString(input.VolumeKey) || input.ProjectName == `` || input.ComposeType == `` {
		return input, errors.New(`typed resource volume ensure identity is invalid`)
	}
	return input, nil
}

func (engine *dockerEngineClient) resourceVolumeOperation(ctx context.Context, body []byte) error {
	input, err := validateTypedResourceVolumeRequest(body)
	if err != nil {
		return err
	}
	if input.Operation == `ensure` {
		return engine.ensureResourceVolume(ctx, input)
	}

	body, status, err := engine.request(
		ctx,
		http.MethodGet,
		`/volumes/`+url.PathEscape(input.VolumeID),
		nil,
	)
	if err != nil {
		if status == http.StatusNotFound {
			return nil
		}
		return err
	}
	var inspection struct {
		Name    string            `json:"Name"`
		Driver  string            `json:"Driver"`
		Options map[string]string `json:"Options"`
	}
	if err := json.Unmarshal(body, &inspection); err != nil {
		return fmt.Errorf(`invalid Docker volume inspection: %w`, err)
	}
	expectedName := `upstand-db-data-` + input.ResourceID
	if inspection.Name != expectedName || inspection.Driver != `local` || len(inspection.Options) != 0 {
		return errors.New(`Docker volume is not the unconfigured resource-owned database volume`)
	}

	_, status, err = engine.request(
		ctx,
		http.MethodDelete,
		`/volumes/`+url.PathEscape(inspection.Name),
		nil,
	)
	if err != nil && status == http.StatusNotFound {
		return nil
	}
	return err
}

func (engine *dockerEngineClient) ensureResourceVolume(ctx context.Context, input typedResourceVolumeRequest) error {
	name := resourceVolumeName(input.ResourceID, input.VolumeKey)
	projectLabel := labelForComposeType(input.ComposeType)
	labels := map[string]string{
		`com.upstand.managed`:     `true`,
		`com.upstand.purpose`:     `resource-isolation`,
		`com.upstand.resource-id`: input.ResourceID,
		projectLabel:              input.ProjectName,
	}
	inspect := func() (int, error) {
		body, status, err := engine.request(ctx, http.MethodGet, `/volumes/`+url.PathEscape(name), nil)
		if err != nil {
			return status, err
		}
		var volume struct {
			Name    string            `json:"Name"`
			Driver  string            `json:"Driver"`
			Options map[string]string `json:"Options"`
			Labels  map[string]string `json:"Labels"`
		}
		if err := json.Unmarshal(body, &volume); err != nil {
			return status, fmt.Errorf(`invalid Docker volume inspection: %w`, err)
		}
		if volume.Name != name || volume.Driver != `local` || len(volume.Options) != 0 ||
			volume.Labels[`com.upstand.managed`] != `true` ||
			volume.Labels[`com.upstand.purpose`] != `resource-isolation` ||
			volume.Labels[`com.upstand.resource-id`] != input.ResourceID ||
			volume.Labels[projectLabel] != input.ProjectName {
			return status, errors.New(`Docker volume is not the managed resource-owned local volume`)
		}
		return status, nil
	}

	if status, err := inspect(); err == nil {
		return nil
	} else if status != http.StatusNotFound {
		return err
	}
	createBody, err := json.Marshal(map[string]any{
		`Name`:   name,
		`Driver`: `local`,
		`Labels`: labels,
	})
	if err != nil {
		return err
	}
	_, status, createErr := engine.request(ctx, http.MethodPost, `/volumes/create`, createBody)
	if createErr != nil {
		if status != http.StatusConflict {
			return createErr
		}
		if _, inspectErr := inspect(); inspectErr != nil {
			return inspectErr
		}
	}
	return nil
}

func resourceVolumeName(resourceID, volumeKey string) string {
	return `upstand-resource-` + strings.ToLower(resourceID) + `-volume-` + volumeKey
}
