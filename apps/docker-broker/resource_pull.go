package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
)

const typedResourcePullPath = typedServerPrefix + `resource-pull`

// Pulls accept the same conservative image-reference character set as the
// domain layer. Pulling an image does not need the build route's tag-only
// restriction; Docker supports stable untagged references and content
// digests, both of which are valid persisted resource configuration.
var resourcePullImagePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,510}$`)

type typedResourcePullRequest struct {
	ResourceID string `json:"resource_id"`
	Image      string `json:"image"`
}

func validateTypedResourcePullRequest(body []byte) (typedResourcePullRequest, error) {
	var input typedResourcePullRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return input, fmt.Errorf(`invalid typed resource pull body: %w`, err)
	}
	for field := range fields {
		if field != `resource_id` && field != `image` {
			return input, fmt.Errorf(`typed resource pull does not accept field %q`, field)
		}
	}
	if !resourceIDPattern.MatchString(input.ResourceID) {
		return input, errors.New(`typed resource pull resource ID is invalid`)
	}
	if len(input.Image) == 0 || len(input.Image) > maxResourceBuildImageLength ||
		!resourcePullImagePattern.MatchString(input.Image) {
		return input, errors.New(`typed resource pull image reference is invalid`)
	}
	return input, nil
}

func (engine *dockerEngineClient) resourcePullOperation(
	ctx context.Context,
	body []byte,
	registryAuth string,
) error {
	input, err := validateTypedResourcePullRequest(body)
	if err != nil {
		return err
	}
	registryAuth, err = validateTypedResourceServiceRegistryAuth(registryAuth)
	if err != nil {
		return err
	}
	values := url.Values{}
	values.Set(`fromImage`, input.Image)
	pullBody, _, err := engine.requestWithHeaders(
		ctx,
		http.MethodPost,
		`/images/create?`+values.Encode(),
		nil,
		registryAuth,
	)
	if err != nil {
		return err
	}

	// Docker returns a newline-delimited progress stream. Consume it inside
	// the broker so callers receive only a bounded completion response and
	// provider error text never becomes part of the capability contract.
	decoder := json.NewDecoder(bytes.NewReader(pullBody))
	for {
		var event struct {
			Error string `json:"error"`
		}
		if err := decoder.Decode(&event); err != nil {
			if err == io.EOF {
				return nil
			}
			return errors.New(`Docker image pull returned an invalid response`)
		}
		if event.Error != `` {
			return errors.New(`Docker image pull failed`)
		}
	}
}
