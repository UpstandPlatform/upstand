package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
)

const typedResourceVolumePath = typedServerPrefix + `resource-volume`

var typedResourceVolumeOperationPattern = regexp.MustCompile(`^remove$`)
var typedResourceVolumePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$`)

type typedResourceVolumeRequest struct {
	Operation  string `json:"operation"`
	ResourceID string `json:"resource_id"`
	VolumeID   string `json:"volume_id"`
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
		if field != `operation` && field != `resource_id` && field != `volume_id` {
			return input, fmt.Errorf(`typed resource volume does not accept field %q`, field)
		}
	}
	if !typedResourceVolumeOperationPattern.MatchString(input.Operation) {
		return input, errors.New(`typed resource volume operation is not supported`)
	}
	if !resourceIDPattern.MatchString(input.ResourceID) ||
		!typedResourceVolumePattern.MatchString(input.VolumeID) {
		return input, errors.New(`typed resource volume identity is invalid`)
	}
	return input, nil
}

func (engine *dockerEngineClient) resourceVolumeOperation(ctx context.Context, body []byte) error {
	input, err := validateTypedResourceVolumeRequest(body)
	if err != nil {
		return err
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
