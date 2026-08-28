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
	"strings"
)

const (
	typedResourcePushPath   = typedServerPrefix + `resource-push`
	maxResourcePushResponse = 8 << 20
)

type typedResourcePushRequest struct {
	ResourceID string `json:"resource_id"`
	Image      string `json:"image"`
}

func validateTypedResourcePushRequest(body []byte) (typedResourcePushRequest, error) {
	var input typedResourcePushRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	if !resourceIDPattern.MatchString(input.ResourceID) {
		return input, errors.New(`typed resource push resource ID is invalid`)
	}
	if len(input.Image) == 0 || len(input.Image) > maxResourceBuildImageLength || !resourceBuildImagePattern.MatchString(input.Image) {
		return input, errors.New(`typed resource push image reference is invalid`)
	}
	return input, nil
}

func (engine *dockerEngineClient) resourcePushOperation(ctx context.Context, body []byte, registryAuth string) error {
	input, err := validateTypedResourcePushRequest(body)
	if err != nil {
		return err
	}
	registryAuth, err = validateTypedResourceServiceRegistryAuth(registryAuth)
	if err != nil {
		return err
	}
	if registryAuth == `` {
		return errors.New(`typed resource push requires registry authentication`)
	}

	inspectionBody, _, err := engine.request(
		ctx,
		http.MethodGet,
		`/images/`+url.PathEscape(input.Image)+`/json`,
		nil,
	)
	if err != nil {
		return err
	}
	var inspection struct {
		ID     string `json:"Id"`
		Config struct {
			Labels map[string]string `json:"Labels"`
		} `json:"Config"`
	}
	if err := json.Unmarshal(inspectionBody, &inspection); err != nil {
		return fmt.Errorf(`invalid Docker image inspection: %w`, err)
	}
	if inspection.ID == `` || inspection.Config.Labels[`com.upstand.resource-id`] != input.ResourceID {
		return errors.New(`Docker image is not owned by the requested Upstand resource`)
	}

	separator := strings.LastIndexByte(input.Image, ':')
	if separator <= 0 || separator == len(input.Image)-1 {
		return errors.New(`typed resource push image reference is invalid`)
	}
	repository := input.Image[:separator]
	tag := input.Image[separator+1:]
	pushBody, status, err := engine.requestWithHeaders(
		ctx,
		http.MethodPost,
		`/images/`+url.PathEscape(repository)+`/push?tag=`+url.QueryEscape(tag),
		nil,
		registryAuth,
	)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return errors.New(`Docker image push failed`)
	}
	if len(pushBody) > maxResourcePushResponse {
		return errors.New(`Docker image push response exceeded its size limit`)
	}

	decoder := json.NewDecoder(bytes.NewReader(pushBody))
	for {
		var event struct {
			Error string `json:"error"`
		}
		if err := decoder.Decode(&event); err != nil {
			if err == io.EOF {
				return nil
			}
			return errors.New(`Docker image push returned an invalid response`)
		}
		if event.Error != `` {
			return errors.New(`Docker image push failed`)
		}
	}
}
