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

var typedResourceNetworkOperationPattern = regexp.MustCompile(`^(ensure|remove)$`)

type typedResourceNetworkRequest struct {
	Operation  string `json:"operation"`
	ResourceID string `json:"resource_id"`
	NetworkID  string `json:"network_id"`
}

type typedResourceNetworkResponse struct {
	ID      string `json:"id,omitempty"`
	Name    string `json:"name,omitempty"`
	Created bool   `json:"created,omitempty"`
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
	if !resourceIDPattern.MatchString(input.ResourceID) {
		return input, errors.New(`typed resource network identity is invalid`)
	}
	if input.Operation == `remove` && !typedResourceServiceNetworkPattern.MatchString(input.NetworkID) {
		return input, errors.New(`typed resource network identity is invalid`)
	}
	if input.Operation == `ensure` && input.NetworkID != `` && !typedResourceServiceNetworkPattern.MatchString(input.NetworkID) {
		return input, errors.New(`typed resource network identity is invalid`)
	}
	if input.NetworkID != `` && input.NetworkID != resourceOverlayNetworkName(input.ResourceID) {
		return input, errors.New(`typed resource network name does not match the requested resource`)
	}
	return input, nil
}

func (engine *dockerEngineClient) resourceNetworkOperation(ctx context.Context, body []byte) (typedResourceNetworkResponse, error) {
	input, err := validateTypedResourceNetworkRequest(body)
	if err != nil {
		return typedResourceNetworkResponse{}, err
	}
	expectedName := resourceOverlayNetworkName(input.ResourceID)
	if input.NetworkID != `` && input.NetworkID != expectedName {
		return typedResourceNetworkResponse{}, errors.New(`Docker resource network name does not match the requested resource`)
	}

	if input.Operation == `ensure` {
		return engine.ensureResourceNetwork(ctx, input.ResourceID, expectedName)
	}

	body, status, err := engine.request(
		ctx,
		http.MethodGet,
		`/networks/`+url.PathEscape(input.NetworkID),
		nil,
	)
	if err != nil {
		if status == http.StatusNotFound {
			return typedResourceNetworkResponse{}, nil
		}
		return typedResourceNetworkResponse{}, err
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
		return typedResourceNetworkResponse{}, fmt.Errorf(`invalid Docker network inspection: %w`, err)
	}
	if inspection.ID == `` || inspection.Name != expectedName ||
		inspection.Driver != `overlay` || inspection.Scope != `swarm` ||
		!inspection.Attachable ||
		inspection.Labels[`com.upstand.managed`] != `true` ||
		inspection.Labels[`com.upstand.purpose`] != `resource-isolation` ||
		inspection.Labels[`com.upstand.resource-id`] != input.ResourceID {
		return typedResourceNetworkResponse{}, errors.New(`Docker network is not the managed isolated network owned by the requested Upstand resource`)
	}

	for attempt := 0; attempt < 10; attempt++ {
		_, status, err = engine.request(
			ctx,
			http.MethodDelete,
			`/networks/`+url.PathEscape(inspection.ID),
			nil,
		)
		if err == nil || status == http.StatusNotFound {
			return typedResourceNetworkResponse{}, nil
		}
		if status != http.StatusConflict || attempt == 9 {
			return typedResourceNetworkResponse{}, err
		}
		timer := time.NewTimer(500 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return typedResourceNetworkResponse{}, ctx.Err()
		case <-timer.C:
		}
	}
	return typedResourceNetworkResponse{}, errors.New(`managed isolated network removal exhausted its retry budget`)
}

func (engine *dockerEngineClient) ensureResourceNetwork(ctx context.Context, resourceID, name string) (typedResourceNetworkResponse, error) {
	inspect := func() (typedResourceNetworkResponse, int, error) {
		body, status, err := engine.request(
			ctx,
			http.MethodGet,
			`/networks/`+url.PathEscape(name),
			nil,
		)
		if err != nil {
			return typedResourceNetworkResponse{}, status, err
		}
		var network struct {
			ID         string            `json:"Id"`
			Name       string            `json:"Name"`
			Driver     string            `json:"Driver"`
			Scope      string            `json:"Scope"`
			Attachable bool              `json:"Attachable"`
			Labels     map[string]string `json:"Labels"`
		}
		if err := json.Unmarshal(body, &network); err != nil {
			return typedResourceNetworkResponse{}, status, fmt.Errorf(`invalid Docker network inspection: %w`, err)
		}
		if network.ID == `` || network.Name != name || network.Driver != `overlay` ||
			network.Scope != `swarm` || !network.Attachable ||
			network.Labels[`com.upstand.managed`] != `true` ||
			network.Labels[`com.upstand.purpose`] != `resource-isolation` ||
			network.Labels[`com.upstand.resource-id`] != resourceID {
			return typedResourceNetworkResponse{}, status, errors.New(`Docker network is not the managed isolated network owned by the requested Upstand resource`)
		}
		return typedResourceNetworkResponse{ID: network.ID, Name: network.Name}, status, nil
	}

	if network, status, err := inspect(); err == nil {
		network.Created = false
		return network, nil
	} else if status != http.StatusNotFound {
		return typedResourceNetworkResponse{}, err
	}

	createBody, err := json.Marshal(map[string]any{
		`Name`:           name,
		`Driver`:         `overlay`,
		`Attachable`:     true,
		`CheckDuplicate`: true,
		`Options`:        map[string]string{`encrypted`: ``},
		`Labels`: map[string]string{
			`com.upstand.managed`:     `true`,
			`com.upstand.purpose`:     `resource-isolation`,
			`com.upstand.resource-id`: resourceID,
		},
	})
	if err != nil {
		return typedResourceNetworkResponse{}, err
	}
	createdBody, status, createErr := engine.request(ctx, http.MethodPost, `/networks/create`, createBody)
	if createErr != nil {
		if status != http.StatusConflict {
			return typedResourceNetworkResponse{}, createErr
		}
		network, _, inspectErr := inspect()
		if inspectErr != nil {
			return typedResourceNetworkResponse{}, inspectErr
		}
		network.Created = false
		return network, nil
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal(createdBody, &created); err != nil || created.ID == `` {
		return typedResourceNetworkResponse{}, errors.New(`Docker resource network creation returned no ID`)
	}
	return typedResourceNetworkResponse{ID: created.ID, Name: name, Created: true}, nil
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
