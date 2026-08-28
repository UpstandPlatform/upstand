package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	typedResourceBuildPath      = typedServerPrefix + `resource-build`
	maxResourceBuildContext     = int64(512 << 20)
	maxResourceBuildResponse    = int64(64 << 20)
	maxResourceBuildPathLength  = 1024
	maxResourceBuildImageLength = 512
	maxResourceBuildArguments   = 64
	maxResourceBuildArgumentB   = 8 << 10
	maxResourceBuildArgumentsB  = 512 << 10
)

var (
	resourceBuildImagePattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,510}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	resourceBuildTargetPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
)

type typedResourceBuildRequest struct {
	ResourceID string
	Image      string
	Dockerfile string
	Target     string
	NoCache    bool
	Rollback   bool
	BuildArgs  map[string]string
}

func validateTypedResourceBuildHeaders(header http.Header) (typedResourceBuildRequest, error) {
	input := typedResourceBuildRequest{
		ResourceID: strings.TrimSpace(header.Get(`X-Upstand-Resource-ID`)),
		Image:      strings.TrimSpace(header.Get(`X-Upstand-Image`)),
		Dockerfile: strings.TrimSpace(header.Get(`X-Upstand-Dockerfile`)),
		Target:     strings.TrimSpace(header.Get(`X-Upstand-Build-Target`)),
	}
	if !resourceIDPattern.MatchString(input.ResourceID) {
		return input, errors.New(`typed resource build resource ID is invalid`)
	}
	if len(input.Image) == 0 || len(input.Image) > maxResourceBuildImageLength || !resourceBuildImagePattern.MatchString(input.Image) {
		return input, errors.New(`typed resource build image reference is invalid`)
	}
	if len(input.Dockerfile) == 0 || len(input.Dockerfile) > maxResourceBuildPathLength || strings.HasPrefix(input.Dockerfile, `/`) || strings.Contains(input.Dockerfile, `\`) {
		return input, errors.New(`typed resource build Dockerfile path is invalid`)
	}
	for _, segment := range strings.Split(input.Dockerfile, `/`) {
		if segment == `` || segment == `.` || segment == `..` {
			return input, errors.New(`typed resource build Dockerfile path contains an invalid segment`)
		}
	}
	if input.Target != `` && !resourceBuildTargetPattern.MatchString(input.Target) {
		return input, errors.New(`typed resource build target is invalid`)
	}
	input.NoCache = strings.EqualFold(strings.TrimSpace(header.Get(`X-Upstand-Docker-No-Cache`)), `true`)
	input.Rollback = strings.EqualFold(strings.TrimSpace(header.Get(`X-Upstand-Rollback`)), `true`)
	if value := strings.TrimSpace(header.Get(`X-Upstand-Build-Args`)); value != `` {
		decoded, err := base64.RawURLEncoding.DecodeString(value)
		if err != nil {
			return input, errors.New(`typed resource build arguments are not valid base64url`)
		}
		if len(decoded) > maxResourceBuildArgumentsB {
			return input, errors.New(`typed resource build arguments exceed their size limit`)
		}
		var buildArgs map[string]string
		if err := json.Unmarshal(decoded, &buildArgs); err != nil || buildArgs == nil {
			return input, errors.New(`typed resource build arguments are not valid JSON`)
		}
		if len(buildArgs) > maxResourceBuildArguments {
			return input, errors.New(`typed resource build has too many build arguments`)
		}
		for key, argument := range buildArgs {
			if !resourceBuildTargetPattern.MatchString(key) || len(argument) > maxResourceBuildArgumentB || hasControlCharacter(argument) || isSensitiveBuildArgument(key) {
				return input, errors.New(`typed resource build argument is invalid or sensitive`)
			}
		}
		input.BuildArgs = buildArgs
	}
	if value := strings.TrimSpace(header.Get(`X-Upstand-Build-Secrets`)); value != `` {
		return input, errors.New(`typed resource build does not accept build secrets`)
	}
	return input, nil
}

func (engine *dockerEngineClient) resourceBuildOperation(ctx context.Context, input typedResourceBuildRequest, body io.Reader, contentLength int64) (*http.Response, error) {
	if contentLength > maxResourceBuildContext {
		return nil, errors.New(`typed resource build context exceeds its size limit`)
	}
	values := url.Values{}
	values.Set(`dockerfile`, input.Dockerfile)
	values.Set(`t`, input.Image)
	if len(input.BuildArgs) > 0 {
		encoded, err := json.Marshal(input.BuildArgs)
		if err != nil {
			return nil, err
		}
		values.Set(`buildargs`, string(encoded))
	}
	if input.NoCache {
		values.Set(`nocache`, `1`)
	}
	if input.Target != `` {
		values.Set(`target`, input.Target)
	}
	labels := `{"com.upstand.resource-id":"` + input.ResourceID + `"`
	if input.Rollback {
		labels += `,"com.upstand.rollback.keep":"true"`
	}
	values.Set(`labels`, labels+`}`)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, `http://docker-engine/build?`+values.Encode(), body)
	if err != nil {
		return nil, err
	}
	request.Header.Set(`Content-Type`, `application/x-tar`)
	request.Header.Set(`Accept`, `application/json`)
	if contentLength >= 0 {
		request.ContentLength = contentLength
	}
	response, err := engine.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	return response, nil
}

func hasControlCharacter(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}

func isSensitiveBuildArgument(key string) bool {
	key = strings.ToLower(key)
	for _, marker := range []string{`password`, `secret`, `token`, `api_key`, `apikey`, `private_key`, `credential`} {
		if strings.Contains(key, marker) {
			return true
		}
	}
	return false
}

func serveTypedResourceBuild(w http.ResponseWriter, r *http.Request, socketPath string) int {
	input, err := validateTypedResourceBuildHeaders(r.Header)
	if err != nil {
		http.Error(w, `Docker typed operation denied by Upstand policy`, http.StatusForbidden)
		return http.StatusForbidden
	}
	if r.ContentLength > maxResourceBuildContext {
		http.Error(w, `Docker build context exceeds its size limit`, http.StatusRequestEntityTooLarge)
		return http.StatusRequestEntityTooLarge
	}
	engine := newDockerEngineClient(socketPath)
	engine.httpClient.Timeout = 30 * time.Minute
	buildContext := &boundedBuildReader{reader: r.Body, remaining: maxResourceBuildContext}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	response, err := engine.resourceBuildOperation(ctx, input, buildContext, r.ContentLength)
	if err != nil {
		if errors.Is(err, errBuildContextTooLarge) {
			http.Error(w, `Docker build context exceeds its size limit`, http.StatusRequestEntityTooLarge)
			return http.StatusRequestEntityTooLarge
		}
		log.Printf(`Docker broker typed resource build failed: %v`, err)
		http.Error(w, `Docker typed build operation failed`, http.StatusBadGateway)
		return http.StatusBadGateway
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxResourceBuildResponse))
		http.Error(w, `Docker typed build operation failed`, http.StatusBadGateway)
		return http.StatusBadGateway
	}
	if contentType := response.Header.Get(`Content-Type`); contentType != `` {
		w.Header().Set(`Content-Type`, contentType)
	}
	w.WriteHeader(response.StatusCode)
	if _, err := io.Copy(w, io.LimitReader(response.Body, maxResourceBuildResponse)); err != nil {
		return response.StatusCode
	}
	return response.StatusCode
}

var errBuildContextTooLarge = errors.New(`Docker build context exceeded its size limit`)

type boundedBuildReader struct {
	reader    io.Reader
	remaining int64
}

func (reader *boundedBuildReader) Read(buffer []byte) (int, error) {
	if reader.remaining <= 0 {
		return 0, errBuildContextTooLarge
	}
	if int64(len(buffer)) > reader.remaining {
		buffer = buffer[:reader.remaining]
	}
	count, err := reader.reader.Read(buffer)
	reader.remaining -= int64(count)
	if err == nil && reader.remaining == 0 {
		return count, nil
	}
	return count, err
}
