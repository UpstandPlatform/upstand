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
	"time"
)

const typedResourceNetworkPath = typedServerPrefix + `resource-network`

var typedResourceNetworkOperationPattern = regexp.MustCompile(`^remove$`)

type typedResourceNetworkRequest struct {
	Operation  string `json:"operation"`
	ResourceID string `json:"resource_id"`
	NetworkID  string `json:"network_id"`
}

func validateTypedResourceNetworkRequest(body []byte) (typedResourceNetworkRequest, error) {
	var input typedResourceNetworkRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	var fields map[string]any
	if err := decodeTypedJSON(body, &fields); err != nil {
		return input, err
	}
	for field := range fields {
		if field != `operation` && field != `resource_id` && field != `network_id` {
			return input, fmt.Errorf(`typed resource network does not accept field %q`, field)
		}
	}
	if !typedResourceNetworkOperationPattern.MatchString(input.Operation) {
		return input, errors.New(`typed resource network operation is not supported`)
	}
	if !resourceIDPattern.MatchString(input.ResourceID) ||
		!typedResourceServiceNetworkPattern.MatchString(input.NetworkID) {
		return input, errors.New(`typed resource network identity is invalid`)
	}
	return input, nil
}

func (engine *dockerEngineClient) resourceNetworkOperation(ctx context.Context, body []byte) error {
	input, err := validateTypedResourceNetworkRequest(body)
	if err != nil {
		return err
	}

	body, status, err := engine.request(
		ctx,
		http.MethodGet,
		`/networks/`+url.PathEscape(input.NetworkID),
		nil,
	)
	if err != nil {
		if status == http.StatusNotFound {
			return nil
		}
		return err
	}
	var inspection struct {
		ID         string            `json:"Id"`
		Name       string            `json:"Name"`
		Driver     string            `json:"Driver"`
		Scope      string            `json:"Scope"`
		Attachable bool              `json:"Attachable"`
		Labels     map[string]string `json:"Labels"`
	}
	if err := json.Unmarshal(body, &inspection); err != nil {
		return fmt.Errorf(`invalid Docker network inspection: %w`, err)
	}
	expectedName := resourceOverlayNetworkName(input.ResourceID)
	if inspection.ID == `` || inspection.Name != expectedName ||
		inspection.Driver != `overlay` || inspection.Scope != `swarm` ||
		!inspection.Attachable ||
		inspection.Labels[`com.upstand.managed`] != `true` ||
		inspection.Labels[`com.upstand.purpose`] != `resource-isolation` {
		return errors.New(`Docker network is not the managed isolated network owned by the requested Upstand resource`)
	}

	for attempt := 0; attempt < 10; attempt++ {
		_, status, err = engine.request(
			ctx,
			http.MethodDelete,
			`/networks/`+url.PathEscape(inspection.ID),
			nil,
		)
		if err == nil || status == http.StatusNotFound {
			return nil
		}
		if status != http.StatusConflict || attempt == 9 {
			return err
		}
		timer := time.NewTimer(500 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return errors.New(`managed isolated network removal exhausted its retry budget`)
}

func resourceOverlayNetworkName(resourceID string) string {
	suffix := strings.Map(func(character rune) rune {
		if (character >= 'a' && character <= 'z') ||
			(character >= '0' && character <= '9') || character == '-' {
			return character
		}
		if character >= 'A' && character <= 'Z' {
			return character + ('a' - 'A')
		}
		return '-'
	}, resourceID)
	name := `upstand-resource-` + suffix
	if len(name) > 63 {
		return name[:63]
	}
	return name
}
