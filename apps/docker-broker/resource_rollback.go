package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const typedResourceRollbackPath = typedServerPrefix + `resource-rollback`

type typedResourceRollbackRequest struct {
	ResourceID string `json:"resource_id"`
	Image      string `json:"image"`
}

func validateTypedResourceRollbackRequest(body []byte) (typedResourceRollbackRequest, error) {
	var input typedResourceRollbackRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return input, fmt.Errorf(`invalid typed resource rollback body: %w`, err)
	}
	for field := range fields {
		if field != `resource_id` && field != `image` {
			return input, fmt.Errorf(`typed resource rollback does not accept field %q`, field)
		}
	}
	if !resourceIDPattern.MatchString(input.ResourceID) ||
		!resourceBuildImagePattern.MatchString(input.Image) {
		return input, errors.New(`typed resource rollback identity or image is invalid`)
	}
	return input, nil
}

func (engine *dockerEngineClient) resourceRollbackOperation(ctx context.Context, body []byte) error {
	input, err := validateTypedResourceRollbackRequest(body)
	if err != nil {
		return err
	}
	imageRepository, imageTag, ok := splitTaggedImageReference(input.Image)
	if !ok {
		return errors.New(`typed resource rollback requires a tagged image`)
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
		Config struct {
			Labels map[string]string `json:"Labels"`
		} `json:"Config"`
	}
	if err := json.Unmarshal(inspectionBody, &inspection); err != nil {
		return fmt.Errorf(`invalid Docker image inspection: %w`, err)
	}
	if inspection.Config.Labels[`com.upstand.resource-id`] != input.ResourceID &&
		imageRepository != `upstand-app-`+input.ResourceID {
		return errors.New(`image is not owned by the requested Upstand resource`)
	}

	markerHash := fmt.Sprintf(`%x`, sha256.Sum256([]byte(
		input.ResourceID+"\x00"+input.Image+"\x00"+time.Now().UTC().Format(time.RFC3339Nano),
	)))[:16]
	markerRepository := `upstand-rollback-marker-` + markerHash
	markerImage := markerRepository + `:` + markerHash
	containerName := `upstand-rollback-marker-` + markerHash
	var containerID string
	cleanup := func() {
		if containerID != `` {
			_, _, _ = engine.request(ctx, http.MethodDelete, `/containers/`+url.PathEscape(containerID)+`?force=true`, nil)
		}
		_, _, _ = engine.request(ctx, http.MethodDelete, `/images/`+url.PathEscape(markerImage)+`?force=true`, nil)
	}
	defer cleanup()

	createBody, err := json.Marshal(map[string]any{
		`Image`: input.Image,
		`Labels`: map[string]string{
			`com.upstand.resource-id`: input.ResourceID,
		},
	})
	if err != nil {
		return err
	}
	createdBody, _, err := engine.request(
		ctx,
		http.MethodPost,
		`/containers/create?name=`+url.QueryEscape(containerName),
		createBody,
	)
	if err != nil {
		return err
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal(createdBody, &created); err != nil || created.ID == `` {
		return errors.New(`Docker rollback marker creation returned no container ID`)
	}
	containerID = created.ID

	commitPath := `/commit?container=` + url.QueryEscape(containerID) +
		`&repo=` + url.QueryEscape(markerRepository) +
		`&tag=` + url.QueryEscape(markerHash) +
		`&changes=` + url.QueryEscape(`LABEL com.upstand.rollback.keep=true`)
	if _, _, err := engine.request(ctx, http.MethodPost, commitPath, nil); err != nil {
		return err
	}
	if _, _, err := engine.request(
		ctx,
		http.MethodPost,
		`/images/`+url.PathEscape(markerImage)+`/tag?repo=`+url.QueryEscape(imageRepository)+`&tag=`+url.QueryEscape(imageTag),
		nil,
	); err != nil {
		return err
	}
	return nil
}

func splitTaggedImageReference(image string) (string, string, bool) {
	separator := strings.LastIndexByte(image, ':')
	if separator <= 0 || separator == len(image)-1 {
		return ``, ``, false
	}
	return image[:separator], image[separator+1:], true
}
