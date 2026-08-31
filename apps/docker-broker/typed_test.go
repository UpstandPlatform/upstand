package main

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func dockerResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestApplySelfUpdateMutatesOnlyManagedServices(t *testing.T) {
	const serverDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	const schedulesDigest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	const webDigest = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	const fumadocsDigest = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	const monitoringDigest = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

	services := `[
  {"ID":"server-id","Version":{"Index":7},"Spec":{"Name":"upstand_server","TaskTemplate":{"ForceUpdate":2,"ContainerSpec":{"Image":"ghcr.io/upstandplatform/upstand-server:old","Env":["KEEP=value","UPSTAND_VERSION=old"]}},"UpdateConfig":{"Parallelism":1}}},
  {"ID":"schedules-id","Version":{"Index":10},"Spec":{"Name":"upstand_schedules","TaskTemplate":{"ForceUpdate":1,"ContainerSpec":{"Image":"ghcr.io/upstandplatform/upstand-schedules:old","Env":[]}}}},
  {"ID":"web-id","Version":{"Index":8},"Spec":{"Name":"upstand-web","TaskTemplate":{"ForceUpdate":4,"ContainerSpec":{"Image":"ghcr.io/upstandplatform/upstand-web@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","Env":[]}}}},
  {"ID":"fumadocs-id","Version":{"Index":11},"Spec":{"Name":"upstand_fumadocs","TaskTemplate":{"ForceUpdate":3,"ContainerSpec":{"Image":"ghcr.io/upstandplatform/upstand-fumadocs:old","Env":[]}}}},
  {"ID":"attacker-id","Version":{"Index":9},"Spec":{"Name":"attacker_service","TaskTemplate":{"ForceUpdate":99,"ContainerSpec":{"Image":"attacker:latest"}}}}
]`

	updated := make(map[string]map[string]any)
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method == http.MethodGet && request.URL.Path == "/services" {
				return dockerResponse(http.StatusOK, services), nil
			}
			if request.Method == http.MethodPost && strings.HasPrefix(request.URL.Path, "/services/") && strings.HasSuffix(request.URL.Path, "/update") {
				data, err := io.ReadAll(request.Body)
				if err != nil {
					return nil, err
				}
				var spec map[string]any
				if err := json.Unmarshal(data, &spec); err != nil {
					return nil, err
				}
				name, _ := spec["Name"].(string)
				updated[name] = spec
				return dockerResponse(http.StatusOK, `{}`), nil
			}
			return dockerResponse(http.StatusNotFound, `{}`), nil
		}),
	}}

	body := `{"version":"v0.2.25","repository":"upstandplatform/upstand","images":{"server":"` + serverDigest + `","schedules":"` + schedulesDigest + `","web":"` + webDigest + `","fumadocs":"` + fumadocsDigest + `","monitoring":"` + monitoringDigest + `"}}`
	count, err := engine.applySelfUpdate(context.Background(), []byte(body))
	if err != nil {
		t.Fatalf("expected typed self-update to succeed: %v", err)
	}
	if count != 4 {
		t.Fatalf("expected four managed services to update, got %d", count)
	}
	if _, ok := updated["attacker_service"]; ok {
		t.Fatal("typed self-update must not mutate an unmanaged service")
	}

	serverSpec := updated["upstand_server"]
	serverTaskTemplate, _ := serverSpec["TaskTemplate"].(map[string]any)
	serverContainerSpec, _ := serverTaskTemplate["ContainerSpec"].(map[string]any)
	if serverContainerSpec["Image"] != "ghcr.io/upstandplatform/upstand-server@"+serverDigest {
		t.Fatalf("unexpected server image: %v", serverContainerSpec["Image"])
	}
	if serverTaskTemplate["ForceUpdate"] != float64(3) {
		t.Fatalf("unexpected server force update: %v", serverTaskTemplate["ForceUpdate"])
	}
	env, _ := serverContainerSpec["Env"].([]any)
	assertEnvValue(t, env, "KEEP=value")
	assertEnvValue(t, env, "UPSTAND_VERSION=v0.2.25")
	assertEnvValue(t, env, "UPSTAND_UPDATE_COMPLETION_VERSION=v0.2.25")
	assertEnvValue(t, env, "UPSTAND_MONITORING_IMAGE=ghcr.io/upstandplatform/upstand-monitoring@"+monitoringDigest)
}

func TestResourceRollbackUsesOwnedTypedDockerOperations(t *testing.T) {
	var requests []string
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			requests = append(requests, request.Method+" "+request.URL.RequestURI())
			switch {
			case request.Method == http.MethodGet && strings.HasSuffix(request.URL.Path, "/images/upstand-app-resource-1:latest/json"):
				return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/containers/create":
				return dockerResponse(http.StatusCreated, `{"Id":"container-1"}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/commit":
				return dockerResponse(http.StatusCreated, `{"Id":"sha256:marker"}`), nil
			case request.Method == http.MethodPost && strings.HasSuffix(request.URL.Path, "/tag"):
				return dockerResponse(http.StatusCreated, `{}`), nil
			case request.Method == http.MethodDelete:
				return dockerResponse(http.StatusNoContent, `{}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	if err := engine.resourceRollbackOperation(
		context.Background(),
		[]byte(`{"resource_id":"resource-1","image":"upstand-app-resource-1:latest"}`),
	); err != nil {
		t.Fatalf("expected typed rollback to succeed: %v", err)
	}
	if len(requests) != 6 {
		t.Fatalf("expected inspect, create, commit, tag, and two cleanup calls; got %d: %v", len(requests), requests)
	}
	if !strings.Contains(requests[2], "repo=upstand-rollback-marker-") || !strings.Contains(requests[2], "tag=") {
		t.Fatalf("expected bounded marker repository and tag: %v", requests[2])
	}
	if !strings.Contains(requests[3], "repo=upstand-app-resource-1") || !strings.Contains(requests[3], "tag=latest") {
		t.Fatalf("expected source image to be retagged: %v", requests[3])
	}
}

func TestResourceRollbackRejectsAnotherResourceImage(t *testing.T) {
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`), nil
		}),
	}}
	if err := engine.resourceRollbackOperation(
		context.Background(),
		[]byte(`{"resource_id":"resource-1","image":"registry.example/app:latest"}`),
	); err == nil {
		t.Fatal("expected rollback of another resource image to be rejected")
	}
}

func TestApplySelfUpdateRejectsSourceInstallation(t *testing.T) {
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			return dockerResponse(http.StatusOK, `[
{"ID":"server-id","Version":{"Index":1},"Spec":{"Name":"upstand_server","TaskTemplate":{"ContainerSpec":{"Image":"upstand-server:source-local"}}}},
{"ID":"schedules-id","Version":{"Index":2},"Spec":{"Name":"upstand_schedules","TaskTemplate":{"ContainerSpec":{"Image":"upstand-schedules:old"}}}},
{"ID":"web-id","Version":{"Index":3},"Spec":{"Name":"upstand_web","TaskTemplate":{"ContainerSpec":{"Image":"upstand-web:old"}}}},
{"ID":"fumadocs-id","Version":{"Index":4},"Spec":{"Name":"upstand_fumadocs","TaskTemplate":{"ContainerSpec":{"Image":"upstand-fumadocs:old"}}}}
]`), nil
		}),
	}}
	_, err := engine.applySelfUpdate(context.Background(), []byte(`{"version":"canary","repository":"upstandplatform/upstand","images":{"server":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","schedules":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","web":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","fumadocs":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","monitoring":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}}`))
	if err == nil || !strings.Contains(err.Error(), "source installations") {
		t.Fatalf("expected source installation to be rejected, got %v", err)
	}
}

func TestApplySelfUpdateRejectsIncompleteInstallationBeforeMutation(t *testing.T) {
	updateCalls := 0
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method == http.MethodPost {
				updateCalls++
			}
			return dockerResponse(http.StatusOK, `[{"ID":"server-id","Version":{"Index":1},"Spec":{"Name":"upstand_server","TaskTemplate":{"ContainerSpec":{"Image":"upstand-server:old"}}}}]`), nil
		}),
	}}

	_, err := engine.applySelfUpdate(context.Background(), []byte(`{"version":"v0.3.17","repository":"upstandplatform/upstand","images":{"server":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","schedules":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","web":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","fumadocs":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","monitoring":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}}`))
	if err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("expected incomplete installation to be rejected, got %v", err)
	}
	if updateCalls != 0 {
		t.Fatalf("expected no mutation before preflight completed, got %d update calls", updateCalls)
	}
}

func TestApplySelfUpdateRollsBackWhenAServiceUpdateFails(t *testing.T) {
	services := `[
{"ID":"server-id","Version":{"Index":1},"Spec":{"Name":"upstand_server","TaskTemplate":{"ContainerSpec":{"Image":"upstand-server:old","Env":[]}}}},
{"ID":"schedules-id","Version":{"Index":2},"Spec":{"Name":"upstand_schedules","TaskTemplate":{"ContainerSpec":{"Image":"upstand-schedules:old","Env":[]}}}},
{"ID":"web-id","Version":{"Index":3},"Spec":{"Name":"upstand_web","TaskTemplate":{"ContainerSpec":{"Image":"upstand-web:old","Env":[]}}}},
{"ID":"fumadocs-id","Version":{"Index":4},"Spec":{"Name":"upstand_fumadocs","TaskTemplate":{"ContainerSpec":{"Image":"upstand-fumadocs:old","Env":[]}}}}
]`
	updateCalls := 0
	rollbackCalls := 0
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/services":
				return dockerResponse(http.StatusOK, services), nil
			case request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/services/"):
				return dockerResponse(http.StatusOK, `{"Version":{"Index":20}}`), nil
			case request.Method == http.MethodPost && strings.HasSuffix(request.URL.Path, "/update"):
				updateCalls++
				if updateCalls == 2 {
					return dockerResponse(http.StatusInternalServerError, `{"message":"update failed"}`), nil
				}
				if updateCalls > 2 {
					rollbackCalls++
				}
				return dockerResponse(http.StatusOK, `{}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	_, err := engine.applySelfUpdate(context.Background(), []byte(`{"version":"v0.3.17","repository":"upstandplatform/upstand","images":{"server":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","schedules":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","web":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","fumadocs":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","monitoring":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}}`))
	if err == nil || !strings.Contains(err.Error(), "rolled back") {
		t.Fatalf("expected failed update to roll back, got %v", err)
	}
	if rollbackCalls != 2 {
		t.Fatalf("expected failed update and prior update to be rolled back, got %d rollback calls", rollbackCalls)
	}
}

func TestSwarmOperationUsesScopedDockerCalls(t *testing.T) {
	var updateBody map[string]any
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/info":
				return dockerResponse(http.StatusOK, `{"Swarm":{"LocalNodeState":"active","ControlAvailable":true,"NodeID":"local-node","NodeAddr":"10.0.0.1","Nodes":1}}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/nodes":
				return dockerResponse(http.StatusOK, `[{"ID":"local-node","Version":{"Index":4},"Description":{"Hostname":"manager-1","Engine":{"EngineVersion":"27.0"}},"Spec":{"Role":"manager","Labels":{"com.upstand.role":"manager"},"Availability":"active"},"Status":{"State":"ready","Addr":"10.0.0.1"},"ManagerStatus":{"Leader":true,"Addr":"10.0.0.1:2377","Reachability":"reachable"}}]`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/nodes/node-1/update":
				data, err := io.ReadAll(request.Body)
				if err != nil {
					return nil, err
				}
				if err := json.Unmarshal(data, &updateBody); err != nil {
					return nil, err
				}
				return dockerResponse(http.StatusOK, `{}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	nodesValue, err := engine.swarmOperation(context.Background(), []byte(`{"operation":"list_nodes"}`))
	if err != nil {
		t.Fatalf("expected Swarm inventory operation to succeed: %v", err)
	}
	nodes, ok := nodesValue.([]typedSwarmNodeResponse)
	if !ok || len(nodes) != 1 || !nodes[0].IsLocalNode || !nodes[0].Leader {
		t.Fatalf("unexpected typed node response: %#v", nodesValue)
	}

	_, err = engine.swarmOperation(context.Background(), []byte(`{"operation":"update_node","node_id":"node-1","version":4,"name":"worker-1","labels":{"com.upstand.role":"worker"},"role":"worker","availability":"drain"}`))
	if err != nil {
		t.Fatalf("expected Swarm node update to succeed: %v", err)
	}
	if updateBody["Name"] != "worker-1" || updateBody["Role"] != "worker" || updateBody["Availability"] != "drain" {
		t.Fatalf("unexpected typed node update body: %#v", updateBody)
	}
}

func TestInventoryOperationMapsAndControlsScopedResources(t *testing.T) {
	var controlMethod string
	var controlPath string
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/info":
				return dockerResponse(http.StatusOK, `{"Name":"node-1","ServerVersion":"27.0","OperatingSystem":"linux","Architecture":"amd64","Containers":2,"Images":3,"MemTotal":4096,"Swarm":{"LocalNodeState":"active"}}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/containers/json":
				return dockerResponse(http.StatusOK, `[{"Id":"abc123","Names":["/upstand_server"],"Image":"upstand-server@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","State":"running","Status":"Up 2 minutes","Created":1700000000,"Ports":[{"PublicPort":443,"PrivatePort":443}],"Mounts":[{"Name":"data","Destination":"/data"}],"Networks":{"upstand-network":{}},"Labels":{"com.upstand.managed":"true"}}]`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/containers/abc123/restart":
				controlMethod = request.Method
				controlPath = request.URL.Path
				return dockerResponse(http.StatusNoContent, ``), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	infoValue, err := engine.inventoryOperation(context.Background(), []byte(`{"operation":"info"}`))
	if err != nil {
		t.Fatalf("expected typed info operation to succeed: %v", err)
	}
	info, ok := infoValue.(typedInventoryInfoResponse)
	if !ok || info.Name != "node-1" || info.Containers != 2 || info.SwarmState != "active" {
		t.Fatalf("unexpected typed info response: %#v", infoValue)
	}

	containersValue, err := engine.inventoryOperation(context.Background(), []byte(`{"operation":"containers","state":"running","search":"upstand"}`))
	if err != nil {
		t.Fatalf("expected typed container inventory to succeed: %v", err)
	}
	containers, ok := containersValue.([]typedInventoryContainerResponse)
	if !ok || len(containers) != 1 || containers[0].Name != "upstand_server" || containers[0].Labels[0] != "com.upstand.managed=true" {
		t.Fatalf("unexpected typed container response: %#v", containersValue)
	}

	_, err = engine.inventoryOperation(context.Background(), []byte(`{"operation":"control_container","container_id":"abc123","command":"restart"}`))
	if err != nil {
		t.Fatalf("expected typed container control to succeed: %v", err)
	}
	if controlMethod != http.MethodPost || controlPath != "/containers/abc123/restart" {
		t.Fatalf("unexpected typed container control request: %s %s", controlMethod, controlPath)
	}
}

func TestResourceFileOperationRequiresOwnedVolumeAndUsesFixedShellScript(t *testing.T) {
	var execBody map[string]any
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/tasks":
				return dockerResponse(http.StatusOK, `[{"Status":{"State":"running","ContainerStatus":{"ContainerID":"abc123"}}}]`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/containers/abc123/json":
				return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}},"Mounts":[{"Type":"volume","Name":"data","Destination":"/data","RW":true}]}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/containers/abc123/exec":
				data, err := io.ReadAll(request.Body)
				if err != nil {
					return nil, err
				}
				if err := json.Unmarshal(data, &execBody); err != nil {
					return nil, err
				}
				return dockerResponse(http.StatusOK, `{"Id":"exec-1"}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/exec/exec-1/start":
				return dockerResponse(http.StatusOK, string([]byte{1, 0, 0, 0, 0, 0, 0, 4})+"aGk="), nil
			case request.Method == http.MethodGet && request.URL.Path == "/exec/exec-1/json":
				return dockerResponse(http.StatusOK, `{"ExitCode":0}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	value, err := engine.resourceFileOperation(context.Background(), []byte(`{"operation":"read","resource_id":"resource-1","container_id":"abc123","mount_path":"/data","path":"/config.txt"}`))
	if err != nil {
		t.Fatalf("expected resource file read to succeed: %v", err)
	}
	content, ok := value.(typedResourceFileContentResponse)
	if !ok || content.Content != "aGk=" {
		t.Fatalf("unexpected resource file response: %#v", value)
	}
	command, _ := execBody["Cmd"].([]any)
	if len(command) != 3 || command[0] != "sh" || command[1] != "-c" {
		t.Fatalf("expected a fixed shell wrapper, got %#v", execBody["Cmd"])
	}

	if _, err := engine.resourceFileOperation(context.Background(), []byte(`{"operation":"read","resource_id":"resource-2","container_id":"abc123","mount_path":"/data","path":"/config.txt"}`)); err == nil {
		t.Fatal("expected a resource label mismatch to be rejected")
	}
}

func TestResourceCommandOperationRequiresOwnedContainer(t *testing.T) {
	var execBody map[string]any
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/containers/json":
				return dockerResponse(http.StatusOK, `[{"Id":"abc123","Labels":{"com.upstand.resource-id":"resource-1"}}]`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/tasks":
				return dockerResponse(http.StatusOK, `[{"Status":{"State":"running","ContainerStatus":{"ContainerID":"abc123"}}}]`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/containers/abc123/json":
				return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/containers/abc123/exec":
				data, err := io.ReadAll(request.Body)
				if err != nil {
					return nil, err
				}
				if err := json.Unmarshal(data, &execBody); err != nil {
					return nil, err
				}
				return dockerResponse(http.StatusOK, `{"Id":"exec-1"}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/exec/exec-1/start":
				return dockerResponse(http.StatusOK, string([]byte{1, 0, 0, 0, 0, 0, 0, 2})+"ok"), nil
			case request.Method == http.MethodGet && request.URL.Path == "/exec/exec-1/json":
				return dockerResponse(http.StatusOK, `{"ExitCode":0}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	result, err := engine.resourceCommandOperation(context.Background(), []byte(`{"resource_id":"resource-1","container_id":"abc123","command":"printf ok"}`))
	if err != nil || result.Output != "ok" || result.ExitCode != 0 {
		t.Fatalf("expected resource command to succeed, result=%#v err=%v", result, err)
	}
	command, _ := execBody["Cmd"].([]any)
	if len(command) != 3 || command[0] != "sh" || command[1] != "-c" || command[2] != "printf ok" {
		t.Fatalf("unexpected command payload: %#v", execBody["Cmd"])
	}
	if _, err := engine.resourceCommandOperation(context.Background(), []byte(`{"resource_id":"resource-1","service_name":"resource-1","command":"printf ok"}`)); err != nil {
		t.Fatalf("expected service-scoped resource command to succeed: %v", err)
	}
	if _, err := engine.resourceCommandOperation(context.Background(), []byte(`{"resource_id":"resource-1","command":"printf ok"}`)); err != nil {
		t.Fatalf("expected label-resolved resource command to succeed: %v", err)
	}
}

func TestResourceCommandOutputLimitIsExplicitlyBounded(t *testing.T) {
	input, err := validateTypedResourceCommandRequest([]byte(`{"resource_id":"resource-1","container_id":"abc123","command":"printf ok","max_output_bytes":4096}`))
	if err != nil {
		t.Fatalf("expected a bounded output limit to be accepted: %v", err)
	}
	if input.MaxOutputBytes != 4096 {
		t.Fatalf("expected output limit to be preserved, got %d", input.MaxOutputBytes)
	}
	if _, err := validateTypedResourceCommandRequest([]byte(`{"resource_id":"resource-1","container_id":"abc123","command":"printf ok","max_output_bytes":8388609}`)); err == nil {
		t.Fatal("expected an oversized output limit to be rejected")
	}
}

func TestResourceConvergenceOperationRequiresOwnedServiceAndReturnsBoundedHealth(t *testing.T) {
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/services/resource-1":
				return dockerResponse(http.StatusOK, `{"Spec":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/tasks":
				return dockerResponse(http.StatusOK, `[{"DesiredState":"running","Status":{"State":"running","ContainerStatus":{"ContainerID":"abc123"}}}]`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/containers/abc123/json":
				return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}},"State":{"Health":{"Status":"healthy"}}}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	result, err := engine.resourceConvergenceOperation(context.Background(), []byte(`{"resource_id":"resource-1","service_name":"resource-1"}`))
	if err != nil || len(result.Tasks) != 1 || result.Tasks[0].Health != "healthy" {
		t.Fatalf("expected owned resource convergence response, result=%#v err=%v", result, err)
	}
	if _, err := engine.resourceConvergenceOperation(context.Background(), []byte(`{"resource_id":"resource-2","service_name":"resource-1"}`)); err == nil {
		t.Fatal("expected service ownership mismatch to be rejected")
	}
}

func TestResourceServiceOperationScopesCreateUpdateAndNetworkAttachment(t *testing.T) {
	var createdSpec map[string]any
	var updatedSpec map[string]any
	removedServiceID := ""
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/services/resource-1":
				return dockerResponse(http.StatusNotFound, `{}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/services/create":
				data, err := io.ReadAll(request.Body)
				if err != nil {
					return nil, err
				}
				if err := json.Unmarshal(data, &createdSpec); err != nil {
					return nil, err
				}
				return dockerResponse(http.StatusOK, `{"ID":"created"}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/services/owned-service":
				return dockerResponse(http.StatusOK, `{"ID":"service-id","Version":{"Index":5},"Spec":{"Name":"owned-service","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"old"}}}}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/services/service-id/update":
				data, err := io.ReadAll(request.Body)
				if err != nil {
					return nil, err
				}
				if err := json.Unmarshal(data, &updatedSpec); err != nil {
					return nil, err
				}
				return dockerResponse(http.StatusOK, `{}`), nil
			case request.Method == http.MethodDelete && request.URL.Path == "/services/service-id":
				removedServiceID = request.URL.Path
				return dockerResponse(http.StatusOK, `{}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/networks/network-1":
				return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"upstand-resource-resource-1","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/networks/foreign-network":
				return dockerResponse(http.StatusOK, `{"Id":"foreign-network","Name":"foreign-network","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-2"}}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	createBody := []byte(`{"operation":"upsert","resource_id":"resource-1","service_name":"resource-1","spec":{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest"}}}}`)
	if err := engine.resourceServiceOperation(context.Background(), createBody, ``); err != nil {
		t.Fatalf("expected owned resource service creation to succeed: %v", err)
	}
	if createdSpec["Name"] != "resource-1" {
		t.Fatalf("unexpected created service spec: %#v", createdSpec)
	}

	updateBody := []byte(`{"operation":"upsert","resource_id":"resource-1","service_name":"owned-service","spec":{"Name":"owned-service","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:next"}}}}`)
	if err := engine.resourceServiceOperation(context.Background(), updateBody, ``); err != nil {
		t.Fatalf("expected owned resource service update to succeed: %v", err)
	}
	taskTemplate, _ := updatedSpec["TaskTemplate"].(map[string]any)
	containerSpec, _ := taskTemplate["ContainerSpec"].(map[string]any)
	if containerSpec["Image"] != "example/app:next" {
		t.Fatalf("unexpected updated service spec: %#v", updatedSpec)
	}

	networkBody := []byte(`{"operation":"ensure_network","resource_id":"resource-1","service_name":"owned-service","network_id":"network-1"}`)
	if err := engine.resourceServiceOperation(context.Background(), networkBody, ``); err != nil {
		t.Fatalf("expected owned resource network attachment to succeed: %v", err)
	}
	updatedTaskTemplate, _ := updatedSpec["TaskTemplate"].(map[string]any)
	networks, _ := updatedTaskTemplate["Networks"].([]any)
	if len(networks) != 1 {
		t.Fatalf("expected one attached network, got %#v", taskTemplate["Networks"])
	}

	removeBody := []byte(`{"operation":"remove","resource_id":"resource-1","service_name":"owned-service"}`)
	if err := engine.resourceServiceOperation(context.Background(), removeBody, ``); err != nil {
		t.Fatalf("expected owned resource service removal to succeed: %v", err)
	}
	if removedServiceID != "/services/service-id" {
		t.Fatalf("expected the inspected owned service to be removed, got %q", removedServiceID)
	}

	if err := engine.resourceServiceOperation(context.Background(), []byte(`{"operation":"upsert","resource_id":"other-resource","service_name":"owned-service","spec":{"Name":"owned-service","Labels":{"com.upstand.resource-id":"other-resource"},"TaskTemplate":{"ContainerSpec":{"Image":"attacker"}}}}`), ``); err == nil {
		t.Fatal("expected an ownership mismatch to reject service mutation")
	}

	foreignNetwork := []byte(`{"operation":"upsert","resource_id":"resource-1","service_name":"resource-1","spec":{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"Networks":[{"Target":"foreign-network"}],"ContainerSpec":{"Image":"example/app:latest"}}}}`)
	if err := engine.resourceServiceOperation(context.Background(), foreignNetwork, ``); err == nil {
		t.Fatal("expected typed resource service mutation to reject a foreign network")
	}
}

func TestTypedResourceServiceRejectsUnsafeEndpointSpec(t *testing.T) {
	for _, test := range []struct {
		name string
		spec string
	}{
		{
			name: "host publish mode",
			spec: `{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"EndpointSpec":{"Ports":[{"Protocol":"tcp","TargetPort":8080,"PublishedPort":8080,"PublishMode":"host"}]}}`,
		},
		{
			name: "unsupported endpoint mode",
			spec: `{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"EndpointSpec":{"Mode":"host"}}`,
		},
		{
			name: "custom logging backend",
			spec: `{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"LogDriver":{"Name":"syslog"}}}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := []byte(`{"operation":"upsert","resource_id":"resource-1","service_name":"resource-1","spec":` + test.spec + `}`)
			if _, err := validateTypedResourceServiceRequest(body); err == nil {
				t.Fatalf("expected typed service policy to reject %s", test.name)
			}
		})
	}
}

func TestResourceServiceOperationRejectsForeignFileBackedResources(t *testing.T) {
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch request.URL.Path {
			case "/secrets/secret-foreign":
				return dockerResponse(http.StatusOK, `{"ID":"secret-foreign","Spec":{"Name":"upstand-resource-resource-2-secret-app","Labels":{"com.upstand.resource-id":"resource-2"}}}`), nil
			case "/services/resource-1":
				return dockerResponse(http.StatusNotFound, `{}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	body := []byte(`{"operation":"upsert","resource_id":"resource-1","service_name":"resource-1","spec":{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest","Secrets":[{"SecretID":"secret-foreign"}]}}}}`)
	if err := engine.resourceServiceOperation(context.Background(), body, ``); err == nil {
		t.Fatal("expected the typed resource service route to reject a foreign secret")
	}
}

func TestResourcePullOperationUsesBoundedResourcePullContract(t *testing.T) {
	var pullQuery string
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method != http.MethodPost || request.URL.Path != "/images/create" {
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
			pullQuery = request.URL.Query().Get("fromImage")
			return dockerResponse(http.StatusOK, "{\"status\":\"Pulling\"}\n{\"status\":\"Downloaded\"}\n"), nil
		}),
	}}

	if err := engine.resourcePullOperation(
		context.Background(),
		[]byte(`{"resource_id":"resource-1","image":"example/app:latest"}`),
		``,
	); err != nil {
		t.Fatalf("expected a bounded resource pull to succeed: %v", err)
	}
	if pullQuery != "example/app:latest" {
		t.Fatalf("expected the validated image to be pulled, got %q", pullQuery)
	}

	if _, err := validateTypedResourcePullRequest([]byte(`{"resource_id":"resource-1","image":"example/app"}`)); err != nil {
		t.Fatalf("expected an untagged image reference to remain supported: %v", err)
	}
	if _, err := validateTypedResourcePullRequest([]byte(`{"resource_id":"resource-1","image":"example/app@sha256:0123456789abcdef"}`)); err != nil {
		t.Fatalf("expected a digest image reference to remain supported: %v", err)
	}
	if _, err := validateTypedResourcePullRequest([]byte(`{"resource_id":"resource-1","image":"example/app:latest","command":"id"}`)); err == nil {
		t.Fatal("expected arbitrary pull fields to be rejected")
	}

	engine.httpClient.Transport = roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		return dockerResponse(http.StatusOK, "{\"error\":\"pull denied\"}\n"), nil
	})
	if err := engine.resourcePullOperation(
		context.Background(),
		[]byte(`{"resource_id":"resource-1","image":"example/app:latest"}`),
		``,
	); err == nil {
		t.Fatal("expected a Docker pull error event to fail the typed operation")
	}
}

func TestResourceServiceRevisionPromotionRequiresBothOwnedServices(t *testing.T) {
	var updateBody map[string]any
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/services/resource-1":
				return dockerResponse(http.StatusOK, `{"ID":"base-id","Version":{"Index":9},"Spec":{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"Mode":{"Replicated":{"Replicas":1}},"TaskTemplate":{"ContainerSpec":{"Image":"old"}},"EndpointSpec":{"Ports":[]},"UpdateConfig":{"Parallelism":1},"RollbackConfig":{"Parallelism":1}}}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/services/resource-1-revision":
				return dockerResponse(http.StatusOK, `{"ID":"revision-id","Spec":{"Name":"resource-1-revision","Labels":{"com.upstand.resource-id":"resource-1","com.upstand.deployment-revision":"true"},"TaskTemplate":{"ContainerSpec":{"Image":"new"}}}}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/services/base-id/update":
				data, err := io.ReadAll(request.Body)
				if err != nil {
					return nil, err
				}
				if err := json.Unmarshal(data, &updateBody); err != nil {
					return nil, err
				}
				return dockerResponse(http.StatusOK, `{}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	body := []byte(`{"operation":"promote_revision","resource_id":"resource-1","service_name":"resource-1","revision_service_name":"resource-1-revision"}`)
	if err := engine.resourceServiceOperation(context.Background(), body, ``); err != nil {
		t.Fatalf("expected owned revision promotion to succeed: %v", err)
	}
	taskTemplate, _ := updateBody["TaskTemplate"].(map[string]any)
	containerSpec, _ := taskTemplate["ContainerSpec"].(map[string]any)
	if containerSpec["Image"] != "new" {
		t.Fatalf("expected the revision task template to be promoted, got %#v", updateBody)
	}

	if err := engine.resourceServiceOperation(
		context.Background(),
		[]byte(`{"operation":"promote_revision","resource_id":"other-resource","service_name":"resource-1","revision_service_name":"resource-1-revision"}`),
		``,
	); err == nil {
		t.Fatal("expected a base-service ownership mismatch to be rejected")
	}
}

func TestResourceServiceScalingRequiresOwnershipAndBoundsReplicas(t *testing.T) {
	var updateBody map[string]any
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/services/resource-1":
				return dockerResponse(http.StatusOK, `{"ID":"base-id","Version":{"Index":3},"Spec":{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"app"}},"EndpointSpec":{}}}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/services/base-id/update":
				data, err := io.ReadAll(request.Body)
				if err != nil {
					return nil, err
				}
				if err := json.Unmarshal(data, &updateBody); err != nil {
					return nil, err
				}
				return dockerResponse(http.StatusOK, `{}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	if err := engine.resourceServiceOperation(
		context.Background(),
		[]byte(`{"operation":"scale","resource_id":"resource-1","service_name":"resource-1","replicas":4}`),
		``,
	); err != nil {
		t.Fatalf("expected owned service scaling to succeed: %v", err)
	}
	mode, _ := updateBody["Mode"].(map[string]any)
	replicated, _ := mode["Replicated"].(map[string]any)
	if replicated["Replicas"] != float64(4) {
		t.Fatalf("expected four replicas, got %#v", updateBody)
	}

	if _, err := validateTypedResourceServiceRequest([]byte(`{"operation":"scale","resource_id":"resource-1","service_name":"resource-1","replicas":1001}`)); err == nil {
		t.Fatal("expected an oversized replica count to be rejected")
	}
}

func TestTypedResourceServiceRejectsHostBindMounts(t *testing.T) {
	for _, mount := range []string{
		`{"Type":"bind","Source":"/etc","Target":"/etc"}`,
		`{"Type":"volume","Source":"../host","Target":"/data"}`,
		`{"Type":"tmpfs","Source":"tmp","Target":"/tmp"}`,
	} {
		body := []byte(`{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest","Mounts":[` + mount + `]}}}`)
		if err := validateTypedResourceServiceSpec(body, "resource-1", "resource-1"); err == nil {
			t.Fatalf("expected unsafe typed resource mount to be rejected: %s", mount)
		}
	}

	valid := []byte(`{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest","Mounts":[{"Type":"volume","Source":"upstand-resource-resource-1-volume-data","Target":"/data"}]}}}`)
	if err := validateTypedResourceServiceSpec(valid, "resource-1", "resource-1"); err != nil {
		t.Fatalf("expected named volume mount to remain valid: %v", err)
	}
}

func TestTypedResourceServiceRejectsCrossResourceVolumeMounts(t *testing.T) {
	for _, source := range []string{
		"upstand-db-data-resource-2",
		"upstand-resource-resource-2-volume-data",
		"unmanaged-volume",
	} {
		body := []byte(`{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest","Mounts":[{"Type":"volume","Source":"` + source + `","Target":"/data"}]}}}`)
		if err := validateTypedResourceServiceSpec(body, "resource-1", "resource-1"); err == nil {
			t.Fatalf("expected non-owned typed resource volume to be rejected: %s", source)
		}
	}

	lowerCaseMounts := []byte(`{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest","mounts":[{"type":"volume","source":"upstand-resource-resource-2-volume-data","target":"/data"}]}}}`)
	if err := validateTypedResourceServiceSpec(lowerCaseMounts, "resource-1", "resource-1"); err == nil {
		t.Fatal("expected case-insensitive Docker mount fields to remain resource-scoped")
	}

	valid := []byte(`{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest","Mounts":[{"Type":"volume","Source":"upstand-db-data-resource-1","Target":"/data"}]}}}`)
	if err := validateTypedResourceServiceSpec(valid, "resource-1", "resource-1"); err != nil {
		t.Fatalf("expected the resource database volume to remain valid: %v", err)
	}
}

func TestTypedResourceServiceRejectsUnknownContainerSpecFields(t *testing.T) {
	unknownField := []byte(`{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest","FutureDaemonCapability":true}}}`)
	if err := validateTypedResourceServiceSpec(unknownField, "resource-1", "resource-1"); err == nil {
		t.Fatal("expected unknown typed ContainerSpec fields to be rejected")
	}

	validFields := []byte(`{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest","Env":["APP_ENV=production"],"DNS":["1.1.1.1"],"DNSSearch":["example.internal"],"CapDrop":["ALL"],"SecurityOpt":["no-new-privileges:true"],"Privileged":false}}}`)
	if err := validateTypedResourceServiceSpec(validFields, "resource-1", "resource-1"); err != nil {
		t.Fatalf("expected reviewed typed ContainerSpec fields to remain valid: %v", err)
	}

	for _, option := range []string{"seccomp=unconfined", "no-new-privileges:false"} {
		body := []byte(`{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"example/app:latest","SecurityOpt":["` + option + `"]}}}`)
		if err := validateTypedResourceServiceSpec(body, "resource-1", "resource-1"); err == nil {
			t.Fatalf("expected unapproved security option to be rejected: %s", option)
		}
	}
}

func TestTypedCaddyProvisioningUsesOnlyManagedShape(t *testing.T) {
	const digest = "af32e97399febea808609119bb21544d0265c58a02836576e32a2d082c262c17"
	created := false
	connected := false
	started := false
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/networks/upstand-network":
				return dockerResponse(http.StatusOK, `{"Id":"network-id","Name":"upstand-network","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""}}`), nil
			case request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/volumes/"):
				return dockerResponse(http.StatusNotFound, `{}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/volumes/create":
				return dockerResponse(http.StatusCreated, `{"Name":"created"}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/images/json":
				return dockerResponse(http.StatusOK, `[{"RepoDigests":["caddy@sha256:`+digest+`"]}]`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/containers/upstand-caddy/json":
				return dockerResponse(http.StatusNotFound, `{}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/containers/create":
				created = true
				return dockerResponse(http.StatusCreated, `{"Id":"caddy-id"}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/networks/network-id/connect":
				connected = true
				return dockerResponse(http.StatusOK, `{}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/containers/caddy-id/start":
				started = true
				return dockerResponse(http.StatusNoContent, ``), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	body := []byte(`{"operation":"ensure","network_name":"upstand-network","caddyfile_base64":"c2l0ZQ==","environment":["UPSTAND_CADDYFILE_B64=c2l0ZQ=="],"ports":[{"protocol":"tcp","target_port":80,"published_port":80}]}`)
	input, err := validateTypedCaddyRequest(body)
	if err != nil {
		t.Fatalf("expected valid typed Caddy input: %v", err)
	}
	if err := engine.ensureCaddyContainer(context.Background(), input); err != nil {
		t.Fatalf("expected typed Caddy provisioning to succeed: %v", err)
	}
	if !created || !connected || !started {
		t.Fatalf("expected Caddy create, network connect, and start, got created=%t connected=%t started=%t", created, connected, started)
	}

	unsafe := []byte(`{"operation":"ensure","network_name":"upstand-network","caddyfile_base64":"c2l0ZQ==","environment":["UPSTAND_CADDYFILE_B64=c2l0ZQ=="],"ports":[{"protocol":"tcp","target_port":80,"published_port":80}],"host_config":{"Binds":["/:/host"]}}`)
	if _, err := validateTypedCaddyRequest(unsafe); err == nil {
		t.Fatal("expected host-escape fields to be rejected")
	}
}

func TestTypedCaddyNetworkHonorsAcceptanceEncryptionOverride(t *testing.T) {
	for _, test := range []struct {
		name        string
		allow       string
		wantSuccess bool
	}{
		{name: "production requires encryption", allow: "false", wantSuccess: false},
		{name: "acceptance may use hosted unencrypted overlay", allow: "true", wantSuccess: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("UPSTAND_ACCEPTANCE_ALLOW_UNENCRYPTED_NETWORK", test.allow)
			engine := &dockerEngineClient{httpClient: &http.Client{
				Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
					if request.Method == http.MethodGet && request.URL.Path == "/networks/upstand-network" {
						return dockerResponse(http.StatusOK, `{"Id":"network-id","Name":"upstand-network","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{}}`), nil
					}
					return dockerResponse(http.StatusNotFound, `{}`), nil
				}),
			}}

			_, err := engine.ensureTypedCaddyNetwork(context.Background(), "upstand-network")
			if (err == nil) != test.wantSuccess {
				t.Fatalf("expected success=%t, got error=%v", test.wantSuccess, err)
			}
		})
	}
}

func TestTypedCaddyProvisioningRejectsUnownedContainer(t *testing.T) {
	const digest = "af32e97399febea808609119bb21544d0265c58a02836576e32a2d082c262c17"
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/networks/upstand-network":
				return dockerResponse(http.StatusOK, `{"Id":"network-id","Name":"upstand-network","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""}}`), nil
			case request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/volumes/"):
				return dockerResponse(http.StatusOK, `{"Name":"volume","Driver":"local","Options":{}}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/images/json":
				return dockerResponse(http.StatusOK, `[{"RepoDigests":["caddy@sha256:`+digest+`"]}]`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/containers/upstand-caddy/json":
				return dockerResponse(http.StatusOK, `{"Id":"unexpected-id","Config":{"Labels":{"com.upstand.component":"other","com.upstand.platform":"true"}}}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	body := []byte(`{"operation":"ensure","network_name":"upstand-network","caddyfile_base64":"c2l0ZQ==","environment":["UPSTAND_CADDYFILE_B64=c2l0ZQ=="],"ports":[{"protocol":"tcp","target_port":80,"published_port":80}]}`)
	input, err := validateTypedCaddyRequest(body)
	if err != nil {
		t.Fatalf("expected valid typed Caddy input: %v", err)
	}
	if err := engine.ensureCaddyContainer(context.Background(), input); err == nil {
		t.Fatal("expected an unowned Caddy container to be rejected")
	}
}

func TestTypedControlPlaneAccessUpdatesOnlyManagedServices(t *testing.T) {
	updated := make(map[string]map[string]any)
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/services/"):
				name := strings.TrimPrefix(request.URL.Path, "/services/")
				return dockerResponse(http.StatusOK, `{"ID":"`+name+`-id","Version":{"Index":7},"Spec":{"Name":"`+name+`","Labels":{},"TaskTemplate":{},"EndpointSpec":{"Ports":[]}}}`), nil
			case request.Method == http.MethodPost && strings.HasSuffix(request.URL.Path, "/update"):
				body, err := io.ReadAll(request.Body)
				if err != nil {
					return nil, err
				}
				var spec map[string]any
				if err := json.Unmarshal(body, &spec); err != nil {
					return nil, err
				}
				serviceName, _ := spec["Name"].(string)
				updated[serviceName] = spec
				return dockerResponse(http.StatusOK, `{}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	body := []byte(`{"operation":"set_ip_access","enabled":true}`)
	input, err := validateTypedControlPlaneAccessRequest(body)
	if err != nil {
		t.Fatalf("expected valid typed control-plane access input: %v", err)
	}
	if err := engine.setTypedControlPlaneIpAccess(context.Background(), *input.Enabled); err != nil {
		t.Fatalf("expected typed control-plane access update to succeed: %v", err)
	}
	if len(updated) != 3 {
		t.Fatalf("expected all managed control-plane services to be updated, got %d", len(updated))
	}
	expectedPorts := map[string]float64{
		"upstand_server":   3000,
		"upstand_web":      3001,
		"upstand_fumadocs": 4000,
	}
	for name, spec := range updated {
		endpoint, ok := spec["EndpointSpec"].(map[string]any)
		if !ok {
			t.Fatalf("expected endpoint spec for %s, got %#v", name, spec["EndpointSpec"])
		}
		ports, ok := endpoint["Ports"].([]any)
		if !ok || len(ports) != 1 {
			t.Fatalf("expected one published port for %s, got %#v", name, endpoint["Ports"])
		}
		port, ok := ports[0].(map[string]any)
		if !ok || port["TargetPort"] != expectedPorts[name] || port["PublishedPort"] != expectedPorts[name] {
			t.Fatalf("expected the managed port mapping for %s, got %#v", name, ports[0])
		}
	}

	if _, err := validateTypedControlPlaneAccessRequest([]byte(`{"operation":"set_ip_access","enabled":true,"service_name":"attacker"}`)); err == nil {
		t.Fatal("expected control-plane access to reject unknown fields")
	}
}

func TestTypedCaddyConfigurationUsesBoundedArchiveAndTransactionalReload(t *testing.T) {
	commands := make(map[string][]string)
	archiveBody := []byte(nil)
	nextExec := 0
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/containers/upstand-caddy/json":
				return dockerResponse(http.StatusOK, `{"Id":"caddy-id","Config":{"Image":"`+typedCaddyImage+`","Labels":{"com.upstand.component":"caddy","com.upstand.platform":"true"}}}`), nil
			case request.Method == http.MethodPut && request.URL.Path == "/containers/caddy-id/archive":
				var err error
				archiveBody, err = io.ReadAll(request.Body)
				if err != nil {
					return nil, err
				}
				return dockerResponse(http.StatusOK, ``), nil
			case request.Method == http.MethodPost && request.URL.Path == "/containers/caddy-id/exec":
				var body struct {
					Cmd []string `json:"Cmd"`
				}
				if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
					return nil, err
				}
				nextExec++
				id := "exec-" + strconv.Itoa(nextExec)
				commands[id] = body.Cmd
				return dockerResponse(http.StatusCreated, `{"Id":"`+id+`"}`), nil
			case request.Method == http.MethodPost && strings.HasPrefix(request.URL.Path, "/exec/") && strings.HasSuffix(request.URL.Path, "/start"):
				id := strings.TrimSuffix(strings.TrimPrefix(request.URL.Path, "/exec/"), "/start")
				command := commands[id]
				output := []byte(nil)
				if len(command) == 2 && command[0] == "cat" {
					if command[1] == "/etc/caddy/Caddyfile" {
						output = []byte("old-config")
					} else {
						output = []byte("new-config")
					}
				}
				framed := make([]byte, 8+len(output))
				framed[0] = 1
				binary.BigEndian.PutUint32(framed[4:8], uint32(len(output)))
				copy(framed[8:], output)
				return dockerResponse(http.StatusOK, string(framed)), nil
			case request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/exec/") && strings.HasSuffix(request.URL.Path, "/json"):
				return dockerResponse(http.StatusOK, `{"Running":false,"ExitCode":0}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	input, err := validateTypedCaddyConfigurationRequest([]byte(`{"operation":"apply_configuration","caddyfile_base64":"bmV3LWNvbmZpZw==","certificates":[{"id":"example_com","certificate_pem":"CERT","private_key_pem":"KEY"}]}`))
	if err != nil {
		t.Fatalf("expected valid typed Caddy configuration: %v", err)
	}
	changed, err := engine.applyTypedCaddyConfiguration(context.Background(), input)
	if err != nil || !changed {
		t.Fatalf("expected transactional Caddy configuration update, changed=%t err=%v", changed, err)
	}
	if len(archiveBody) == 0 {
		t.Fatal("expected configuration archive upload")
	}
	reader := tar.NewReader(bytes.NewReader(archiveBody))
	entries := make(map[string]tar.Header)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("expected readable configuration archive: %v", err)
		}
		entries[header.Name] = *header
	}
	if entries["Caddyfile.next"].Mode != 0o644 || entries["certificates/example_com.key"].Mode != 0o600 {
		t.Fatalf("expected restrictive archive modes, got Caddyfile=%o key=%o", entries["Caddyfile.next"].Mode, entries["certificates/example_com.key"].Mode)
	}
	validated := false
	reloaded := false
	for _, command := range commands {
		if len(command) > 1 && command[0] == "caddy" && command[1] == "validate" {
			validated = true
		}
		if len(command) > 1 && command[0] == "caddy" && command[1] == "reload" {
			reloaded = true
		}
	}
	if !validated || !reloaded {
		t.Fatalf("expected validation and reload commands, validated=%t reloaded=%t", validated, reloaded)
	}
}

func TestTypedCaddyConfigurationRejectsArchiveTraversal(t *testing.T) {
	if _, err := validateTypedCaddyConfigurationRequest([]byte(`{"operation":"apply_configuration","caddyfile_base64":"YQ==","certificates":[{"id":"../escape","certificate_pem":"CERT","private_key_pem":"KEY"}]}`)); err == nil {
		t.Fatal("expected certificate archive traversal to be rejected")
	}
}

func TestResourceNetworkOperationRemovesOnlyManagedIsolatedNetwork(t *testing.T) {
	removedNetworkID := ""
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/networks/upstand-resource-resource-1":
				return dockerResponse(http.StatusOK, `{"Id":"network-id","Name":"upstand-resource-resource-1","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`), nil
			case request.Method == http.MethodDelete && request.URL.Path == "/networks/network-id":
				removedNetworkID = "network-id"
				return dockerResponse(http.StatusOK, `{}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	if _, err := engine.resourceNetworkOperation(
		context.Background(),
		[]byte(`{"operation":"remove","resource_id":"resource-1","network_id":"upstand-resource-resource-1"}`),
	); err != nil {
		t.Fatalf("expected managed isolated network removal to succeed: %v", err)
	}
	if removedNetworkID != "network-id" {
		t.Fatalf("expected inspected network to be removed, got %q", removedNetworkID)
	}

	if _, err := engine.resourceNetworkOperation(
		context.Background(),
		[]byte(`{"operation":"remove","resource_id":"resource-2","network_id":"upstand-resource-resource-1"}`),
	); err == nil {
		t.Fatal("expected network name ownership mismatch to be rejected")
	}
}

func TestResourceNetworkOperationEnsuresOwnedIsolatedNetwork(t *testing.T) {
	created := false
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/networks/upstand-resource-resource-1":
				return dockerResponse(http.StatusNotFound, `{}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/networks/create":
				created = true
				return dockerResponse(http.StatusOK, `{"Id":"created-network"}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	result, err := engine.resourceNetworkOperation(
		context.Background(),
		[]byte(`{"operation":"ensure","resource_id":"resource-1"}`),
	)
	if err != nil {
		t.Fatalf("expected managed isolated network creation to succeed: %v", err)
	}
	if !created || result.ID != "created-network" || result.Name != "upstand-resource-resource-1" || !result.Created {
		t.Fatalf("unexpected resource network result: created=%t result=%+v", created, result)
	}
}

func TestResourceNetworkOperationEnsuresNamedComposeNetwork(t *testing.T) {
	created := false
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/networks/upstand-resource-resource-1-private":
				return dockerResponse(http.StatusNotFound, `{}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/networks/create":
				var payload struct {
					Name       string            `json:"Name"`
					Driver     string            `json:"Driver"`
					Attachable bool              `json:"Attachable"`
					Internal   bool              `json:"Internal"`
					Options    map[string]string `json:"Options"`
					Labels     map[string]string `json:"Labels"`
				}
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					return nil, err
				}
				if payload.Name != "upstand-resource-resource-1-private" || payload.Driver != "overlay" || !payload.Attachable || !payload.Internal || payload.Options["encrypted"] != "" ||
					payload.Labels["com.upstand.managed"] != "true" || payload.Labels["com.upstand.purpose"] != "resource-isolation" || payload.Labels["com.upstand.resource-id"] != "resource-1" || payload.Labels["com.docker.stack.namespace"] != "resource-1" {
					return dockerResponse(http.StatusBadRequest, `{}`), nil
				}
				created = true
				return dockerResponse(http.StatusOK, `{"Id":"named-network"}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	result, err := engine.resourceNetworkOperation(
		context.Background(),
		[]byte(`{"operation":"ensure","resource_id":"resource-1","network_key":"private","project_name":"resource-1","compose_type":"stack","internal":true}`),
	)
	if err != nil {
		t.Fatalf("expected named managed network creation to succeed: %v", err)
	}
	if !created || result.ID != "named-network" || result.Name != "upstand-resource-resource-1-private" || !result.Created {
		t.Fatalf("unexpected named resource network result: created=%t result=%+v", created, result)
	}
}

func TestResourceNetworkOperationRejectsUnownedExistingNetwork(t *testing.T) {
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			return dockerResponse(http.StatusOK, `{"Id":"network-id","Name":"upstand-resource-resource-1","Driver":"overlay","Scope":"swarm","Attachable":true,"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"other-resource"}}`), nil
		}),
	}}

	if _, err := engine.resourceNetworkOperation(
		context.Background(),
		[]byte(`{"operation":"ensure","resource_id":"resource-1"}`),
	); err == nil {
		t.Fatal("expected an existing network with a different owner to be rejected")
	}
}

func TestTypedResourceNetworkRejectsNamesBeyondDockerLimit(t *testing.T) {
	resourceID := strings.Repeat("r", 120)
	if _, err := validateTypedResourceNetworkRequest([]byte(`{"operation":"ensure","resource_id":"` + resourceID + `","network_key":"private"}`)); err == nil {
		t.Fatal("expected a resource network name beyond Docker's limit to be rejected")
	}
}

func TestTypedResourceNetworkRequiresCompleteComposeScope(t *testing.T) {
	if _, err := validateTypedResourceNetworkRequest([]byte(`{"operation":"ensure","resource_id":"resource-1","network_key":"private"}`)); err == nil {
		t.Fatal("expected a named network without project scope to be rejected")
	}
	if _, err := validateTypedResourceNetworkRequest([]byte(`{"operation":"ensure","resource_id":"resource-1","project_name":"resource-1","compose_type":"compose"}`)); err == nil {
		t.Fatal("expected project scope without a network key to be rejected")
	}
}

func TestResourceVolumeOperationRemovesOnlyDeterministicLocalVolume(t *testing.T) {
	removedVolumeID := ""
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/volumes/upstand-db-data-resource-1":
				return dockerResponse(http.StatusOK, `{"Name":"upstand-db-data-resource-1","Driver":"local","Options":{}}`), nil
			case request.Method == http.MethodDelete && request.URL.Path == "/volumes/upstand-db-data-resource-1":
				removedVolumeID = "upstand-db-data-resource-1"
				return dockerResponse(http.StatusOK, `{}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	if err := engine.resourceVolumeOperation(
		context.Background(),
		[]byte(`{"operation":"remove","resource_id":"resource-1","volume_id":"upstand-db-data-resource-1"}`),
	); err != nil {
		t.Fatalf("expected managed local volume removal to succeed: %v", err)
	}
	if removedVolumeID != "upstand-db-data-resource-1" {
		t.Fatalf("expected inspected volume to be removed, got %q", removedVolumeID)
	}

	if err := engine.resourceVolumeOperation(
		context.Background(),
		[]byte(`{"operation":"remove","resource_id":"resource-2","volume_id":"upstand-db-data-resource-1"}`),
	); err == nil {
		t.Fatal("expected volume name ownership mismatch to be rejected")
	}
}

func TestResourceVolumeOperationEnsuresNamedComposeVolume(t *testing.T) {
	created := false
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/volumes/upstand-resource-resource-1-volume-data":
				return dockerResponse(http.StatusNotFound, `{}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/volumes/create":
				var payload struct {
					Name   string            `json:"Name"`
					Driver string            `json:"Driver"`
					Labels map[string]string `json:"Labels"`
				}
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					return nil, err
				}
				if payload.Name != "upstand-resource-resource-1-volume-data" || payload.Driver != "local" || payload.Labels["com.upstand.managed"] != "true" || payload.Labels["com.upstand.purpose"] != "resource-isolation" || payload.Labels["com.upstand.resource-id"] != "resource-1" || payload.Labels["com.docker.compose.project"] != "resource-1" {
					return dockerResponse(http.StatusBadRequest, `{}`), nil
				}
				created = true
				return dockerResponse(http.StatusCreated, `{}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	if err := engine.resourceVolumeOperation(
		context.Background(),
		[]byte(`{"operation":"ensure","resource_id":"resource-1","volume_key":"data","project_name":"resource-1","compose_type":"compose"}`),
	); err != nil {
		t.Fatalf("expected named managed volume creation to succeed: %v", err)
	}
	if !created {
		t.Fatal("expected named resource volume to be created")
	}
}

func TestResourceTeardownRemovesOnlyOwnedComposeContainers(t *testing.T) {
	removedContainerID := ""
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/containers/json":
				return dockerResponse(http.StatusOK, `[{"Id":"container-1"}]`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/containers/container-1/json":
				return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`), nil
			case request.Method == http.MethodDelete && request.URL.Path == "/containers/container-1":
				removedContainerID = "container-1"
				return dockerResponse(http.StatusOK, `{}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/networks":
				return dockerResponse(http.StatusOK, `[]`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	if err := engine.resourceTeardownOperation(
		context.Background(),
		[]byte(`{"operation":"remove","resource_id":"resource-1","project_name":"resource-1","compose_type":"compose"}`),
	); err != nil {
		t.Fatalf("expected owned Compose teardown to succeed: %v", err)
	}
	if removedContainerID != "container-1" {
		t.Fatalf("expected owned container to be removed, got %q", removedContainerID)
	}

	engine = &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/containers/json":
				return dockerResponse(http.StatusOK, `[{"Id":"container-2"}]`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/containers/container-2/json":
				return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}
	if err := engine.resourceTeardownOperation(
		context.Background(),
		[]byte(`{"operation":"remove","resource_id":"resource-1","project_name":"resource-1","compose_type":"compose"}`),
	); err == nil {
		t.Fatal("expected a cross-resource Compose container to be rejected")
	}
}

func TestResourceTeardownRemovesOnlyOwnedStackServices(t *testing.T) {
	removedServiceID := ""
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/services":
				return dockerResponse(http.StatusOK, `[{"ID":"service-1"}]`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/services/service-1":
				return dockerResponse(http.StatusOK, `{"Spec":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`), nil
			case request.Method == http.MethodDelete && request.URL.Path == "/services/service-1":
				removedServiceID = "service-1"
				return dockerResponse(http.StatusOK, `{}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/networks":
				return dockerResponse(http.StatusOK, `[]`), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}

	if err := engine.resourceTeardownOperation(
		context.Background(),
		[]byte(`{"operation":"remove","resource_id":"resource-1","project_name":"resource-1","compose_type":"stack"}`),
	); err != nil {
		t.Fatalf("expected owned stack teardown to succeed: %v", err)
	}
	if removedServiceID != "service-1" {
		t.Fatalf("expected owned stack service to be removed, got %q", removedServiceID)
	}
}

func TestResourceServiceOperationForwardsEphemeralRegistryAuth(t *testing.T) {
	authHeader := base64.StdEncoding.EncodeToString([]byte(`{"username":"builder","password":"temporary","serveraddress":"registry.example"}`))
	seenAuthHeader := ""
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method != http.MethodPost || request.URL.Path != "/services/create" {
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
			seenAuthHeader = request.Header.Get("X-Registry-Auth")
			return dockerResponse(http.StatusOK, `{"ID":"created"}`), nil
		}),
	}}
	body := []byte(`{"operation":"upsert","resource_id":"resource-1","service_name":"resource-1","spec":{"Name":"resource-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Image":"registry.example/app:latest"}}}}`)
	if err := engine.resourceServiceOperation(context.Background(), body, authHeader); err != nil {
		t.Fatalf("expected registry-authenticated typed service creation to succeed: %v", err)
	}
	if seenAuthHeader != authHeader {
		t.Fatalf("expected registry auth header to be forwarded ephemerally")
	}
}

func TestResourcePushOperationRequiresOwnedImageAndForwardsEphemeralRegistryAuth(t *testing.T) {
	authHeader := base64.StdEncoding.EncodeToString([]byte(`{"username":"builder","password":"temporary","serveraddress":"registry.example"}`))
	seenAuthHeader := ""
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/images/registry.example/app:latest/json":
				return dockerResponse(http.StatusOK, `{"Id":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/images/registry.example/app/push" && request.URL.Query().Get("tag") == "latest":
				seenAuthHeader = request.Header.Get("X-Registry-Auth")
				return dockerResponse(http.StatusOK, `{"status":"pushed"}`+"\n"), nil
			default:
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
		}),
	}}
	body := []byte(`{"resource_id":"resource-1","image":"registry.example/app:latest"}`)
	if err := engine.resourcePushOperation(context.Background(), body, authHeader); err != nil {
		t.Fatalf("expected owned image push to succeed: %v", err)
	}
	if seenAuthHeader != authHeader {
		t.Fatalf("expected registry auth header to be forwarded ephemerally")
	}
	if err := engine.resourcePushOperation(context.Background(), []byte(`{"resource_id":"resource-2","image":"registry.example/app:latest"}`), authHeader); err == nil {
		t.Fatal("expected image ownership mismatch to reject the push")
	}
}

func TestResourceBuildOperationForwardsOnlyBoundedBuildMetadata(t *testing.T) {
	requestBody := "tar-context"
	engine := &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			if request.Method != http.MethodPost || request.URL.Path != "/build" {
				return dockerResponse(http.StatusNotFound, `{}`), nil
			}
			data, err := io.ReadAll(request.Body)
			if err != nil {
				return nil, err
			}
			if string(data) != requestBody {
				return nil, errors.New("unexpected build context")
			}
			if request.URL.Query().Get("dockerfile") != "Dockerfile" ||
				request.URL.Query().Get("t") != "upstand-app-resource-1:latest" ||
				request.URL.Query().Get("nocache") != "1" ||
				request.URL.Query().Get("target") != "production" ||
				request.URL.Query().Get("buildargs") != `{"BUILD_MODE":"production"}` ||
				request.URL.Query().Get("labels") != `{"com.upstand.resource-id":"resource-1","com.upstand.rollback.keep":"true"}` {
				return nil, errors.New("unexpected typed build metadata")
			}
			return dockerResponse(http.StatusOK, `{"stream":"built\n"}`), nil
		}),
	}}

	headers := make(http.Header)
	headers.Set("X-Upstand-Resource-ID", "resource-1")
	headers.Set("X-Upstand-Image", "upstand-app-resource-1:latest")
	headers.Set("X-Upstand-Dockerfile", "Dockerfile")
	headers.Set("X-Upstand-Docker-No-Cache", "true")
	headers.Set("X-Upstand-Build-Target", "production")
	headers.Set("X-Upstand-Build-Args", base64.RawURLEncoding.EncodeToString([]byte(`{"BUILD_MODE":"production"}`)))
	headers.Set("X-Upstand-Rollback", "true")
	input, err := validateTypedResourceBuildHeaders(headers)
	if err != nil {
		t.Fatalf("expected build headers to validate: %v", err)
	}
	response, err := engine.resourceBuildOperation(context.Background(), input, strings.NewReader(requestBody), int64(len(requestBody)))
	if err != nil {
		t.Fatalf("expected bounded build forwarding to succeed: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected build response status: %d", response.StatusCode)
	}

	headers.Set("X-Upstand-Build-Secrets", "secret")
	if _, err := validateTypedResourceBuildHeaders(headers); err == nil {
		t.Fatal("expected build secrets to be rejected by the typed route")
	}
	headers.Del("X-Upstand-Build-Secrets")
	headers.Set("X-Upstand-Build-Args", base64.RawURLEncoding.EncodeToString([]byte(`{"API_TOKEN":"secret"}`)))
	if _, err := validateTypedResourceBuildHeaders(headers); err == nil {
		t.Fatal("expected sensitive build arguments to be rejected by the typed route")
	}
}

func assertEnvValue(t *testing.T, values []any, expected string) {
	t.Helper()
	for _, value := range values {
		if value == expected {
			return
		}
	}
	t.Fatalf("expected environment value %q in %v", expected, values)
}
