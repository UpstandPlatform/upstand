package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	typedResourceFilesPath      = typedServerPrefix + `resource-files`
	typedResourceCommandPath    = typedServerPrefix + `resource-command`
	maxResourceFileSizeBytes    = 10 << 20
	maxResourceFilePathLength   = 4096
	maxResourceFileQueryLength  = 100
	maxResourceFileContentChars = 14 << 20
	maxResourceCommandBytes     = 32 << 10
	maxResourceCommandTimeout   = 30 * time.Minute
	maxResourceCommandOutput    = 8 << 20
)

var typedResourceFileOperationPattern = regexp.MustCompile(`^(mounts|list|read|write|create|rename|delete|chmod|search)$`)
var resourceIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)
var resourceFileModePattern = regexp.MustCompile(`^[0-7]{3,4}$`)

type typedResourceFileRequest struct {
	Operation     string `json:"operation"`
	ResourceID    string `json:"resource_id"`
	ContainerID   string `json:"container_id"`
	MountPath     string `json:"mount_path,omitempty"`
	Path          string `json:"path,omitempty"`
	OldPath       string `json:"old_path,omitempty"`
	NewPath       string `json:"new_path,omitempty"`
	ContentBase64 string `json:"content_base64,omitempty"`
	Type          string `json:"type,omitempty"`
	Mode          string `json:"mode,omitempty"`
	Query         string `json:"query,omitempty"`
}

type typedResourceFileMountResponse struct {
	Name      string `json:"name"`
	MountPath string `json:"mountPath"`
	ReadOnly  bool   `json:"readOnly"`
}

type typedResourceFileContentResponse struct {
	Content string `json:"content"`
}

type typedResourceFileOutputResponse struct {
	Output string `json:"output"`
}

type typedResourceFileSuccessResponse struct {
	Success bool `json:"success"`
}

type typedResourceCommandRequest struct {
	ResourceID     string `json:"resource_id"`
	ContainerID    string `json:"container_id"`
	ServiceName    string `json:"service_name"`
	Command        string `json:"command"`
	TimeoutSeconds int    `json:"timeout_seconds,omitempty"`
	MaxOutputBytes int    `json:"max_output_bytes,omitempty"`
}

type typedResourceCommandResponse struct {
	Output   string `json:"output"`
	Stderr   string `json:"stderr,omitempty"`
	ExitCode int    `json:"exitCode"`
}

func validateTypedResourceCommandRequest(body []byte) (typedResourceCommandRequest, error) {
	var input typedResourceCommandRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return input, fmt.Errorf(`invalid typed resource command body: %w`, err)
	}
	for field := range fields {
		if field != `resource_id` && field != `container_id` && field != `service_name` && field != `command` && field != `timeout_seconds` && field != `max_output_bytes` {
			return input, fmt.Errorf(`typed resource command does not accept field %q`, field)
		}
	}
	if !resourceIDPattern.MatchString(input.ResourceID) || (input.ContainerID != `` && input.ServiceName != ``) {
		return input, errors.New(`typed resource command identity is invalid`)
	}
	if input.ContainerID != `` && !swarmNodeIDPattern.MatchString(input.ContainerID) {
		return input, errors.New(`typed resource command container ID is invalid`)
	}
	if input.ServiceName != `` && !swarmNamePattern.MatchString(input.ServiceName) {
		return input, errors.New(`typed resource command service name is invalid`)
	}
	if input.Command == `` || len(input.Command) > maxResourceCommandBytes || strings.Contains(input.Command, "\x00") {
		return input, errors.New(`typed resource command is empty or out of bounds`)
	}
	if input.TimeoutSeconds == 0 {
		input.TimeoutSeconds = 300
	}
	if input.TimeoutSeconds < 1 || time.Duration(input.TimeoutSeconds)*time.Second > maxResourceCommandTimeout {
		return input, errors.New(`typed resource command timeout is out of bounds`)
	}
	if input.MaxOutputBytes == 0 {
		input.MaxOutputBytes = maxResourceCommandOutput
	}
	if input.MaxOutputBytes < 1024 || input.MaxOutputBytes > maxResourceCommandOutput {
		return input, errors.New(`typed resource command output limit is out of bounds`)
	}
	return input, nil
}

func (engine *dockerEngineClient) resourceCommandOperation(ctx context.Context, body []byte) (typedResourceCommandResponse, error) {
	input, err := validateTypedResourceCommandRequest(body)
	if err != nil {
		return typedResourceCommandResponse{}, err
	}
	containerID := input.ContainerID
	if containerID == `` && input.ServiceName == `` {
		containerID, err = engine.resolveResourceContainer(ctx, input.ResourceID)
		if err != nil {
			return typedResourceCommandResponse{}, err
		}
	}
	if input.ServiceName != `` {
		containerID, err = engine.resolveResourceServiceContainer(ctx, input.ServiceName)
		if err != nil {
			return typedResourceCommandResponse{}, err
		}
	}
	if err := engine.authorizeResourceContainer(ctx, containerID, input.ResourceID); err != nil {
		return typedResourceCommandResponse{}, err
	}
	commandContext, cancel := context.WithTimeout(ctx, time.Duration(input.TimeoutSeconds)*time.Second)
	defer cancel()
	return engine.runResourceCommand(commandContext, containerID, input.Command, input.MaxOutputBytes)
}

func (engine *dockerEngineClient) resolveResourceContainer(ctx context.Context, resourceID string) (string, error) {
	filters, err := json.Marshal(map[string][]string{
		`label`: {`com.upstand.resource-id=` + resourceID},
	})
	if err != nil {
		return ``, err
	}
	body, _, err := engine.request(ctx, http.MethodGet, `/containers/json?all=0&filters=`+url.QueryEscape(string(filters)), nil)
	if err != nil {
		return ``, err
	}
	var containers []struct {
		ID     string            `json:"Id"`
		Labels map[string]string `json:"Labels"`
	}
	if err := json.Unmarshal(body, &containers); err != nil {
		return ``, fmt.Errorf(`invalid Docker container response: %w`, err)
	}
	for _, container := range containers {
		if container.Labels[`com.upstand.resource-id`] == resourceID && swarmNodeIDPattern.MatchString(container.ID) {
			return container.ID, nil
		}
	}
	return ``, errors.New(`resource has no running container`)
}

func (engine *dockerEngineClient) resolveResourceServiceContainer(ctx context.Context, serviceName string) (string, error) {
	filters := url.QueryEscape(`{"service":["` + serviceName + `"],"desired-state":["running"]}`)
	body, _, err := engine.request(ctx, http.MethodGet, `/tasks?filters=`+filters, nil)
	if err != nil {
		return ``, err
	}
	var tasks []struct {
		Status struct {
			State           string `json:"State"`
			ContainerStatus struct {
				ContainerID string `json:"ContainerID"`
			} `json:"ContainerStatus"`
		} `json:"Status"`
	}
	if err := json.Unmarshal(body, &tasks); err != nil {
		return ``, fmt.Errorf(`invalid Docker task response: %w`, err)
	}
	for _, task := range tasks {
		if task.Status.State == `running` && swarmNodeIDPattern.MatchString(task.Status.ContainerStatus.ContainerID) {
			return task.Status.ContainerStatus.ContainerID, nil
		}
	}
	return ``, errors.New(`resource service has no running container`)
}

func validateTypedResourceFileRequest(body []byte) (typedResourceFileRequest, error) {
	var input typedResourceFileRequest
	if err := decodeTypedJSON(body, &input); err != nil {
		return input, err
	}
	if !typedResourceFileOperationPattern.MatchString(input.Operation) {
		return input, errors.New(`typed resource file operation is not supported`)
	}
	if !resourceIDPattern.MatchString(input.ResourceID) {
		return input, errors.New(`typed resource file resource ID is invalid`)
	}
	if !swarmNodeIDPattern.MatchString(input.ContainerID) {
		return input, errors.New(`typed resource file container ID is invalid`)
	}
	if err := validateResourceFileFieldSet(body, input.Operation); err != nil {
		return input, err
	}
	if input.Operation != `mounts` {
		if err := validateResourceFilePath(input.MountPath, false); err != nil {
			return input, fmt.Errorf(`typed resource file mount path is invalid: %w`, err)
		}
	}
	switch input.Operation {
	case `list`, `read`, `search`:
		if err := validateResourceFilePath(input.Path, false); err != nil {
			return input, fmt.Errorf(`typed resource file path is invalid: %w`, err)
		}
	case `write`, `create`, `delete`, `chmod`:
		if err := validateResourceFilePath(input.Path, true); err != nil {
			return input, fmt.Errorf(`typed resource file path is invalid: %w`, err)
		}
	case `rename`:
		if err := validateResourceFilePath(input.OldPath, true); err != nil {
			return input, fmt.Errorf(`typed resource file old path is invalid: %w`, err)
		}
		if err := validateResourceFilePath(input.NewPath, true); err != nil {
			return input, fmt.Errorf(`typed resource file new path is invalid: %w`, err)
		}
	}
	if input.Operation == `write` {
		if len(input.ContentBase64) == 0 || len(input.ContentBase64) > maxResourceFileContentChars {
			return input, errors.New(`typed resource file content is out of bounds`)
		}
		decoded, err := base64.StdEncoding.DecodeString(input.ContentBase64)
		if err != nil || len(decoded) > maxResourceFileSizeBytes {
			return input, errors.New(`typed resource file content is not valid bounded base64`)
		}
	}
	if input.Operation == `create` {
		if input.Type != `file` && input.Type != `directory` {
			return input, errors.New(`typed resource file item type is unsupported`)
		}
	}
	if input.Operation == `chmod` && !resourceFileModePattern.MatchString(input.Mode) {
		return input, errors.New(`typed resource file mode is invalid`)
	}
	if input.Operation == `search` {
		if input.Query == `` || len(input.Query) > maxResourceFileQueryLength || hasResourceFileControlCharacters(input.Query) {
			return input, errors.New(`typed resource file search query is invalid`)
		}
	}
	return input, nil
}

func validateResourceFileFieldSet(body []byte, operation string) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return fmt.Errorf(`invalid typed resource file body: %w`, err)
	}
	allowed := map[string]struct{}{
		`operation`: {}, `resource_id`: {}, `container_id`: {},
	}
	for _, field := range []string{`mount_path`, `path`, `old_path`, `new_path`, `content_base64`, `type`, `mode`, `query`} {
		switch operation {
		case `mounts`:
			// Only the resource and container identity are accepted.
		case `list`, `read`, `search`:
			if field == `mount_path` || field == `path` || (operation == `search` && field == `query`) {
				allowed[field] = struct{}{}
			}
		case `write`:
			if field == `mount_path` || field == `path` || field == `content_base64` {
				allowed[field] = struct{}{}
			}
		case `create`:
			if field == `mount_path` || field == `path` || field == `type` {
				allowed[field] = struct{}{}
			}
		case `rename`:
			if field == `mount_path` || field == `old_path` || field == `new_path` {
				allowed[field] = struct{}{}
			}
		case `delete`:
			if field == `mount_path` || field == `path` {
				allowed[field] = struct{}{}
			}
		case `chmod`:
			if field == `mount_path` || field == `path` || field == `mode` {
				allowed[field] = struct{}{}
			}
		}
	}
	for field := range fields {
		if _, ok := allowed[field]; !ok {
			return fmt.Errorf(`typed resource file operation %q does not accept field %q`, operation, field)
		}
	}
	return nil
}

func hasResourceFileControlCharacters(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}

func validateResourceFilePath(value string, mutation bool) error {
	if len(value) == 0 || len(value) > maxResourceFilePathLength || !strings.HasPrefix(value, `/`) || strings.Contains(value, "\\") || strings.Contains(value, `//`) {
		return errors.New(`path must be a bounded absolute POSIX path`)
	}
	if hasResourceFileControlCharacters(value) {
		return errors.New(`path contains unsupported control characters`)
	}
	for _, part := range strings.Split(value, `/`) {
		if part == `.` || part == `..` {
			return errors.New(`path contains an unsupported segment`)
		}
	}
	if mutation && value == `/` {
		return errors.New(`path cannot target the mount root`)
	}
	return nil
}

func resourceFileShellQuote(value string) string {
	return `'` + strings.ReplaceAll(value, `'`, `'\''`) + `'`
}

func resourceFileContext(mountPath, filePath string) string {
	relative := strings.TrimPrefix(filePath, `/`)
	return strings.Join([]string{
		`set -eu`,
		`root=` + resourceFileShellQuote(mountPath),
		`relative=` + resourceFileShellQuote(relative),
		`test -d "$root"`,
		`root=$(cd -- "$root" && pwd -P)`,
		`target="$root"`,
		`[ -z "$relative" ] || target="$root/$relative"`,
		`case "$target" in "$root"|"$root"/*) ;; *) echo "path escapes mount" >&2; exit 1 ;; esac`,
	}, `; `)
}

func resourceFileExistingGuard() string {
	return strings.Join([]string{
		`[ -e "$target" ] || [ -L "$target" ]`,
		`[ ! -L "$target" ] || { echo "symlink paths are not supported" >&2; exit 1; }`,
		`resolved=$(readlink -f -- "$target")`,
		`[ "$resolved" = "$target" ] || { echo "symlink paths are not supported" >&2; exit 1; }`,
	}, `; `)
}

func resourceFileParentGuard() string {
	return strings.Join([]string{
		`parent="${target%/*}"`,
		`test -d "$parent"`,
		`parent_resolved=$(readlink -f -- "$parent")`,
		`[ "$parent_resolved" = "$parent" ] || { echo "symlink paths are not supported" >&2; exit 1; }`,
		`[ ! -e "$target" ] || [ ! -L "$target" ] || { echo "symlink paths are not supported" >&2; exit 1; }`,
	}, `; `)
}

func (engine *dockerEngineClient) resourceFileOperation(ctx context.Context, body []byte) (any, error) {
	input, err := validateTypedResourceFileRequest(body)
	if err != nil {
		return nil, err
	}
	if input.Operation == `mounts` {
		return engine.resourceFileMounts(ctx, input)
	}
	if err := engine.authorizeResourceContainer(ctx, input.ContainerID, input.ResourceID); err != nil {
		return nil, err
	}
	if err := engine.authorizeResourceMount(ctx, input.ContainerID, input.MountPath, input.Operation == `write` || input.Operation == `create` || input.Operation == `rename` || input.Operation == `delete` || input.Operation == `chmod`); err != nil {
		return nil, err
	}
	if input.Operation == `read` {
		output, err := engine.runResourceFileShell(ctx, input.ContainerID, strings.Join([]string{
			resourceFileContext(input.MountPath, input.Path),
			resourceFileExistingGuard(),
			`test -f "$target" || { echo "path is not a regular file" >&2; exit 1; }`,
			`bytes=$(wc -c < "$target")`,
			fmt.Sprintf(`[ "$bytes" -le %d ] || { echo "file exceeds the 10 MB size limit" >&2; exit 1; }`, maxResourceFileSizeBytes),
			`base64 "$target" | tr -d "\n"`,
		}, `\n`))
		if err != nil {
			return nil, err
		}
		return typedResourceFileContentResponse{Content: strings.TrimSpace(output)}, nil
	}
	if input.Operation == `list` || input.Operation == `search` {
		return engine.resourceFileListing(ctx, input)
	}
	script, err := resourceFileMutationScript(input)
	if err != nil {
		return nil, err
	}
	if _, err := engine.runResourceFileShell(ctx, input.ContainerID, script); err != nil {
		return nil, err
	}
	return typedResourceFileSuccessResponse{Success: true}, nil
}

func (engine *dockerEngineClient) authorizeResourceContainer(ctx context.Context, containerID, resourceID string) error {
	body, _, err := engine.request(ctx, http.MethodGet, `/containers/`+resourceFileShellSafeID(containerID)+`/json`, nil)
	if err != nil {
		return err
	}
	var raw struct {
		Config struct {
			Labels map[string]string `json:"Labels"`
		} `json:"Config"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return fmt.Errorf(`invalid Docker container inspection: %w`, err)
	}
	if raw.Config.Labels[`com.upstand.resource-id`] != resourceID {
		return errors.New(`container is not owned by the requested Upstand resource`)
	}
	return nil
}

func resourceFileShellSafeID(value string) string {
	return urlPathEscape(value)
}

func (engine *dockerEngineClient) authorizeResourceMount(ctx context.Context, containerID, mountPath string, mutation bool) error {
	body, _, err := engine.request(ctx, http.MethodGet, `/containers/`+resourceFileShellSafeID(containerID)+`/json`, nil)
	if err != nil {
		return err
	}
	var raw struct {
		Mounts []struct {
			Type        string `json:"Type"`
			Name        string `json:"Name"`
			Destination string `json:"Destination"`
			RW          bool   `json:"RW"`
		} `json:"Mounts"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return fmt.Errorf(`invalid Docker mount inspection: %w`, err)
	}
	for _, mount := range raw.Mounts {
		if mount.Type == `volume` && mount.Name != `` && mount.Destination == mountPath {
			if mutation && !mount.RW {
				return errors.New(`the requested volume is mounted read-only`)
			}
			return nil
		}
	}
	return errors.New(`requested mount is not a named Docker volume`)
}

func (engine *dockerEngineClient) resourceFileMounts(ctx context.Context, input typedResourceFileRequest) ([]typedResourceFileMountResponse, error) {
	body, _, err := engine.request(ctx, http.MethodGet, `/containers/`+resourceFileShellSafeID(input.ContainerID)+`/json`, nil)
	if err != nil {
		return nil, err
	}
	var raw struct {
		Config struct {
			Labels map[string]string `json:"Labels"`
		} `json:"Config"`
		Mounts []struct {
			Type        string `json:"Type"`
			Name        string `json:"Name"`
			Destination string `json:"Destination"`
			RW          bool   `json:"RW"`
		} `json:"Mounts"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf(`invalid Docker mount inspection: %w`, err)
	}
	if raw.Config.Labels[`com.upstand.resource-id`] != input.ResourceID {
		return nil, errors.New(`container is not owned by the requested Upstand resource`)
	}
	result := make([]typedResourceFileMountResponse, 0, len(raw.Mounts))
	for _, mount := range raw.Mounts {
		if mount.Type != `volume` || mount.Name == `` || validateResourceFilePath(mount.Destination, false) != nil {
			continue
		}
		result = append(result, typedResourceFileMountResponse{Name: mount.Name, MountPath: mount.Destination, ReadOnly: !mount.RW})
	}
	return result, nil
}

func (engine *dockerEngineClient) resourceFileListing(ctx context.Context, input typedResourceFileRequest) (typedResourceFileOutputResponse, error) {
	parts := []string{resourceFileContext(input.MountPath, input.Path)}
	if input.Operation == `list` {
		parts = append(parts,
			`test -d "$target"`,
			`for entry in "$target"/* "$target"/.[!.]* "$target"/..?*; do`,
			`  [ -e "$entry" ] || [ -L "$entry" ] || continue`,
			`  name="${entry##*/}"`,
			`  if [ -L "$entry" ]; then type=symlink; elif [ -d "$entry" ]; then type=directory; elif [ -f "$entry" ]; then type=file; else type=other; fi`,
			`  size=0; mode=000; updated=0`,
			`  stat_out=$(stat -c "%s|%a|%Y" -- "$entry" 2>/dev/null || true)`,
			`  [ -z "$stat_out" ] || IFS="|" read -r size mode updated <<EOF`,
			`$stat_out`,
			`EOF`,
			`  encoded=$(printf "%s" "$name" | base64 | tr -d "\n")`,
			`  printf "%s|%s|%s|%s|%s\n" "$type" "$size" "$mode" "$updated" "$encoded"`,
			`done`,
		)
	} else {
		parts = append(parts,
			`test -d "$target"`,
			`query=`+resourceFileShellQuote(input.Query),
			`find -P "$target" -mindepth 1 -maxdepth 4 -print 2>/dev/null | while IFS= read -r entry; do`,
			`  name="${entry##*/}"`,
			`  case "$name" in *"$query"*) ;; *) continue ;; esac`,
			`  if [ -L "$entry" ]; then type=symlink; elif [ -d "$entry" ]; then type=directory; elif [ -f "$entry" ]; then type=file; else type=other; fi`,
			`  size=0; mode=000; updated=0`,
			`  stat_out=$(stat -c "%s|%a|%Y" -- "$entry" 2>/dev/null || true)`,
			`  [ -z "$stat_out" ] || IFS="|" read -r size mode updated <<EOF`,
			`$stat_out`,
			`EOF`,
			`  relative="${entry#"$root"}"; encoded=$(printf "%s" "$relative" | base64 | tr -d "\n")`,
			`  printf "%s|%s|%s|%s|%s\n" "$type" "$size" "$mode" "$updated" "$encoded"`,
			`done`,
		)
	}
	output, err := engine.runResourceFileShell(ctx, input.ContainerID, strings.Join(parts, "\n"))
	return typedResourceFileOutputResponse{Output: output}, err
}

func resourceFileMutationScript(input typedResourceFileRequest) (string, error) {
	context := resourceFileContext(input.MountPath, input.Path)
	switch input.Operation {
	case `write`:
		return strings.Join([]string{
			context,
			resourceFileParentGuard(),
			`tmp=$(mktemp "$target.upstand.XXXXXX")`,
			`cleanup() { rm -f -- "$tmp"; }`,
			`trap cleanup EXIT`,
			`printf "%s" ` + resourceFileShellQuote(input.ContentBase64) + ` | base64 -d > "$tmp"`,
			fmt.Sprintf(`bytes=$(wc -c < "$tmp"); [ "$bytes" -le %d ] || { echo "file exceeds the 10 MB size limit" >&2; exit 1; }`, maxResourceFileSizeBytes),
			`if [ -e "$target" ]; then chmod --reference="$target" "$tmp" 2>/dev/null || true; fi`,
			`mv -f -- "$tmp" "$target"`,
			`trap - EXIT`,
		}, "; "), nil
	case `create`:
		create := `: > "$target"`
		if input.Type == `directory` {
			create = `mkdir -- "$target"`
		}
		return strings.Join([]string{context, resourceFileParentGuard(), `[ ! -e "$target" ] && [ ! -L "$target" ]`, create}, "; "), nil
	case `rename`:
		oldContext := resourceFileContext(input.MountPath, input.OldPath)
		newRelative := strings.TrimPrefix(input.NewPath, `/`)
		return strings.Join([]string{
			oldContext,
			`new_relative=` + resourceFileShellQuote(newRelative),
			`new_target="$root"`,
			`[ -z "$new_relative" ] || new_target="$root/$new_relative"`,
			`case "$new_target" in "$root"|"$root"/*) ;; *) echo "path escapes mount" >&2; exit 1 ;; esac`,
			resourceFileExistingGuard(),
			`target="$new_target"`,
			resourceFileParentGuard(),
			`[ ! -e "$target" ] && [ ! -L "$target" ]`,
			`target="$root/$relative"`,
			`mv -- "$target" "$new_target"`,
		}, "; "), nil
	case `delete`:
		return strings.Join([]string{context, resourceFileExistingGuard(), `rm -rf -- "$target"`}, "; "), nil
	case `chmod`:
		return strings.Join([]string{context, resourceFileExistingGuard(), `chmod -- ` + resourceFileShellQuote(input.Mode) + ` "$target"`}, "; "), nil
	default:
		return ``, errors.New(`typed resource file mutation is not supported`)
	}
}

func (engine *dockerEngineClient) runResourceFileShell(ctx context.Context, containerID, script string) (string, error) {
	createBody, err := json.Marshal(map[string]any{
		`Cmd`:          []string{`sh`, `-c`, script},
		`AttachStdout`: true,
		`AttachStderr`: true,
		`Tty`:          false,
	})
	if err != nil {
		return ``, err
	}
	execBody, _, err := engine.request(ctx, http.MethodPost, `/containers/`+resourceFileShellSafeID(containerID)+`/exec`, createBody)
	if err != nil {
		return ``, err
	}
	var execution struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal(execBody, &execution); err != nil || execution.ID == `` {
		return ``, errors.New(`Docker exec creation returned no execution ID`)
	}
	startBody := []byte(`{"Detach":false,"Tty":false}`)
	outputBody, _, err := engine.request(ctx, http.MethodPost, `/exec/`+resourceFileShellSafeID(execution.ID)+`/start`, startBody)
	if err != nil {
		return ``, err
	}
	inspectionBody, _, err := engine.request(ctx, http.MethodGet, `/exec/`+resourceFileShellSafeID(execution.ID)+`/json`, nil)
	if err != nil {
		return ``, err
	}
	var inspection struct {
		ExitCode int `json:"ExitCode"`
	}
	if err := json.Unmarshal(inspectionBody, &inspection); err != nil {
		return ``, err
	}
	output := decodeDockerLogStream(outputBody)
	if inspection.ExitCode != 0 {
		return ``, fmt.Errorf(`typed resource file operation exited with code %d`, inspection.ExitCode)
	}
	return output, nil
}

func (engine *dockerEngineClient) runResourceCommand(ctx context.Context, containerID, command string, maxOutputBytes int) (typedResourceCommandResponse, error) {
	createBody, err := json.Marshal(map[string]any{
		`Cmd`:          []string{`sh`, `-c`, command},
		`AttachStdout`: true,
		`AttachStderr`: true,
		`Tty`:          false,
	})
	if err != nil {
		return typedResourceCommandResponse{}, err
	}
	execBody, _, err := engine.request(ctx, http.MethodPost, `/containers/`+resourceFileShellSafeID(containerID)+`/exec`, createBody)
	if err != nil {
		return typedResourceCommandResponse{}, err
	}
	var execution struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal(execBody, &execution); err != nil || execution.ID == `` {
		return typedResourceCommandResponse{}, errors.New(`Docker exec creation returned no execution ID`)
	}
	outputBody, _, err := engine.request(ctx, http.MethodPost, `/exec/`+resourceFileShellSafeID(execution.ID)+`/start`, []byte(`{"Detach":false,"Tty":false}`))
	if err != nil {
		return typedResourceCommandResponse{}, err
	}
	inspectionBody, _, err := engine.request(ctx, http.MethodGet, `/exec/`+resourceFileShellSafeID(execution.ID)+`/json`, nil)
	if err != nil {
		return typedResourceCommandResponse{}, err
	}
	var inspection struct {
		ExitCode int `json:"ExitCode"`
	}
	if err := json.Unmarshal(inspectionBody, &inspection); err != nil {
		return typedResourceCommandResponse{}, err
	}
	output := decodeDockerLogStream(outputBody)
	if len(output) > maxOutputBytes {
		return typedResourceCommandResponse{}, fmt.Errorf(`typed resource command output exceeded %d bytes`, maxOutputBytes)
	}
	return typedResourceCommandResponse{Output: output, ExitCode: inspection.ExitCode}, nil
}

func urlPathEscape(value string) string {
	return strings.NewReplacer(`%`, `%25`, `/`, `%2F`, `?`, `%3F`, `#`, `%23`).Replace(value)
}
