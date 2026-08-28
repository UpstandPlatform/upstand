package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestDeploymentWorkerRawContainerMutationRequiresDaemonOwnership(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		if request.Method != http.MethodGet || request.URL.Path != "/containers/container-1/json" {
			return dockerResponse(http.StatusNotFound, `{}`)
		}
		return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`)
	})

	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/containers/container-1/start", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, engine); err != nil {
		t.Fatalf("expected an owned container mutation to be allowed: %v", err)
	}

	engine = rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, engine); err == nil {
		t.Fatal("expected a cross-resource container mutation to be rejected")
	}
}

func TestDeploymentWorkerRawServiceUpdateRequiresDaemonOwnership(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/service-1/update", strings.NewReader(`{"Labels":{"com.upstand.resource-id":"resource-1"}}`))
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	body := []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"}}`)
	owned := rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Spec":{"Name":"service-1","Labels":{"com.upstand.resource-id":"resource-1"}}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, owned); err != nil {
		t.Fatalf("expected an owned service update to be allowed: %v", err)
	}

	foreign := rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Spec":{"Name":"service-1","Labels":{"com.upstand.resource-id":"other-resource"}}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, foreign); err == nil {
		t.Fatal("expected a cross-resource service update to be rejected")
	}
}

func TestRawServiceMutationIdentity(t *testing.T) {
	for _, test := range []struct {
		name         string
		body         string
		existingName string
		wantError    bool
	}{
		{
			name:      "create requires a name",
			body:      `{"Labels":{"com.upstand.resource-id":"resource-1"}}`,
			wantError: true,
		},
		{
			name: "create accepts a bounded name",
			body: `{"Name":"resource-app","Labels":{"com.upstand.resource-id":"resource-1"}}`,
		},
		{
			name:         "update can omit the name",
			body:         `{"Labels":{"com.upstand.resource-id":"resource-1"}}`,
			existingName: "service-1",
		},
		{
			name:         "update accepts the inspected name",
			body:         `{"Name":"service-1","Labels":{"com.upstand.resource-id":"resource-1"}}`,
			existingName: "service-1",
		},
		{
			name:         "update rejects a rename",
			body:         `{"Name":"other-service","Labels":{"com.upstand.resource-id":"resource-1"}}`,
			existingName: "service-1",
			wantError:    true,
		},
		{
			name:      "rejects an invalid name",
			body:      `{"Name":"../host","Labels":{"com.upstand.resource-id":"resource-1"}}`,
			wantError: true,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validateRawServiceMutationIdentity([]byte(test.body), test.existingName)
			if test.wantError && err == nil {
				t.Fatal("expected service identity validation to fail")
			}
			if !test.wantError && err != nil {
				t.Fatalf("expected service identity validation to pass: %v", err)
			}
		})
	}
}

func TestRawServiceSecurityRejectsIsolationEscapes(t *testing.T) {
	for _, test := range []struct {
		name         string
		field        string
		value        any
		taskTemplate bool
	}{
		{name: "custom runtime", field: "Runtime", value: "gvisor", taskTemplate: true},
		{name: "host config", field: "HostConfig", value: map[string]any{"NetworkMode": "host"}, taskTemplate: true},
		{name: "privileged mode", field: "Privileged", value: true},
		{name: "host network namespace", field: "NetworkMode", value: "host"},
		{name: "shared pid namespace", field: "PidMode", value: "host"},
		{name: "shared ipc namespace", field: "IpcMode", value: "host"},
		{name: "shared uts namespace", field: "UTSMode", value: "host"},
		{name: "custom user namespace", field: "UsernsMode", value: "host"},
		{name: "custom cgroup namespace", field: "CgroupnsMode", value: "host"},
		{name: "custom isolation", field: "Isolation", value: "hyperv"},
		{name: "added capabilities", field: "CapAdd", value: []any{"SYS_ADMIN"}},
		{name: "devices", field: "Devices", value: []any{map[string]any{"PathOnHost": "/dev/null"}}},
		{name: "device requests", field: "DeviceRequests", value: []any{map[string]any{"Capabilities": []any{"gpu"}}}},
		{name: "security options", field: "SecurityOpt", value: []any{"seccomp=unconfined"}},
		{name: "sysctls", field: "Sysctls", value: map[string]any{"kernel.shm_rmid_forced": "1"}},
		{name: "cgroup parent", field: "CgroupParent", value: "host.slice"},
		{name: "storage options", field: "StorageOpt", value: map[string]any{"size": "1G"}},
		{name: "block IO options", field: "BlkioConfig", value: map[string]any{"Weight": 1}},
		{name: "shared volumes", field: "VolumesFrom", value: []any{"other-service"}},
		{name: "host aliases", field: "Hosts", value: []any{"host.docker.internal:host-gateway"}},
		{name: "unbounded ulimits", field: "Ulimits", value: []any{map[string]any{"Name": "nofile", "Hard": 1 << 30}}},
		{name: "host OOM priority", field: "OomScoreAdj", value: 1000},
		{name: "oversized shared memory", field: "ShmSize", value: 1 << 40},
		{name: "privilege specification", field: "Privileges", value: map[string]any{"CredentialSpec": map[string]any{"Config": "host"}}},
		{name: "credential specification", field: "CredentialSpec", value: map[string]any{"Config": "host"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			taskPayload := map[string]any{}
			if test.taskTemplate {
				taskPayload[test.field] = test.value
			} else {
				taskPayload["ContainerSpec"] = map[string]any{test.field: test.value}
			}
			payload := map[string]any{
				"TaskTemplate": taskPayload,
			}
			if err := validateRawServiceSecurity(payload); err == nil {
				t.Fatalf("expected raw service field %q to be rejected", test.field)
			}
		})
	}

	if err := validateRawServiceSecurity(map[string]any{
		"TaskTemplate": map[string]any{
			"ContainerSpec": map[string]any{
				"Image":    "example/app:latest",
				"ReadOnly": true,
				"Init":     true,
			},
		},
	}); err != nil {
		t.Fatalf("expected ordinary service security fields to remain allowed: %v", err)
	}
	if err := validateRawServiceSecurity(map[string]any{
		"TaskTemplate": map[string]any{
			"LogDriver":               map[string]any{},
			"NetworkAttachmentConfig": map[string]any{},
			"Resources": map[string]any{
				"Reservations": map[string]any{"GenericResources": []any{}},
			},
			"ContainerSpec": map[string]any{
				"OomScoreAdj": 0,
				"ShmSize":     0,
			},
		},
	}); err != nil {
		t.Fatalf("expected zero-valued or empty optional fields to remain allowed: %v", err)
	}

	for _, test := range []struct {
		name     string
		endpoint map[string]any
	}{
		{
			name: "host publish mode",
			endpoint: map[string]any{
				"Ports": []any{map[string]any{"Protocol": "tcp", "TargetPort": 8080, "PublishedPort": 8080, "PublishMode": "host"}},
			},
		},
		{
			name: "invalid port range",
			endpoint: map[string]any{
				"Ports": []any{map[string]any{"Protocol": "tcp", "TargetPort": 70000, "PublishedPort": 8080}},
			},
		},
		{
			name:     "unknown endpoint field",
			endpoint: map[string]any{"HostIP": "0.0.0.0"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := validateRawServiceSecurity(map[string]any{"EndpointSpec": test.endpoint}); err == nil {
				t.Fatalf("expected endpoint policy to reject %s", test.name)
			}
		})
	}
	if err := validateRawServiceSecurity(map[string]any{
		"EndpointSpec": map[string]any{
			"Mode":  "vip",
			"Ports": []any{map[string]any{"Name": "http", "Protocol": "tcp", "TargetPort": 8080, "PublishedPort": 8080, "PublishMode": "ingress"}},
		},
	}); err != nil {
		t.Fatalf("expected a bounded ingress endpoint to remain allowed: %v", err)
	}

	for _, test := range []struct {
		name    string
		payload map[string]any
	}{
		{
			name: "host logging driver",
			payload: map[string]any{
				"TaskTemplate": map[string]any{
					"LogDriver": map[string]any{"Name": "syslog", "Options": map[string]any{"syslog-address": "tcp://10.0.0.1:514"}},
				},
			},
		},
		{
			name: "additional network attachment config",
			payload: map[string]any{
				"TaskTemplate": map[string]any{
					"NetworkAttachmentConfig": map[string]any{"Target": "foreign-network"},
				},
			},
		},
		{
			name: "generic device reservation",
			payload: map[string]any{
				"TaskTemplate": map[string]any{
					"Resources": map[string]any{
						"Reservations": map[string]any{
							"GenericResources": []any{map[string]any{"DiscreteResourceSpec": map[string]any{"Kind": "gpu", "Value": 1}}},
						},
					},
				},
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := validateRawServiceSecurity(test.payload); err == nil {
				t.Fatalf("expected raw service policy to reject %s", test.name)
			}
		})
	}
}

func TestRawServiceMutationAppliesSecurityPolicyBeforeDockerInspection(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/create", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	engine := rawScopeTestEngine(func(*http.Request) *http.Response {
		t.Fatal("unsafe service payload must be rejected before Docker inspection")
		return nil
	})
	body := []byte(`{"Name":"service-1","TaskTemplate":{"Runtime":"gvisor"}}`)
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, engine); err == nil {
		t.Fatal("expected the raw service security policy to reject a custom runtime")
	}
}

func TestDeploymentWorkerRawServiceShapeRejectsUnknownFieldsBeforeInspection(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/create", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	engine := rawScopeTestEngine(func(*http.Request) *http.Response {
		t.Fatal("an unreviewed service field must be rejected before Docker inspection")
		return nil
	})

	for _, body := range []string{
		`{"Name":"service-1","FutureField":true}`,
		`{"Name":"service-1","TaskTemplate":{"FutureField":true}}`,
		`{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"FutureField":true}}}`,
		`{"Name":"service-1","TaskTemplate":{"Networks":[{"Target":"network-1","DriverOpts":{"encrypted":"false"}}]}}`,
	} {
		t.Run(body, func(t *testing.T) {
			if err := authorizeDeploymentWorkerRawServiceResources(
				context.Background(),
				[]byte(body),
				"",
				"resource-1",
				engine,
			); err == nil {
				t.Fatalf("expected unreviewed raw service shape to be rejected: %s", body)
			}
		})
	}
}

func TestDeploymentWorkerRawServiceShapeAllowsBoundedComposeServiceSpec(t *testing.T) {
	body := []byte(`{
  "Name":"service-1",
  "Labels":{"com.upstand.resource-id":"resource-1"},
  "TaskTemplate":{
    "ContainerSpec":{
      "Image":"example/app:latest",
      "Env":["PORT=8080"],
      "Mounts":[],
      "ReadOnly":true
    },
    "Resources":{"Limits":{"NanoCPUs":100000000,"MemoryBytes":268435456}},
    "RestartPolicy":{"Condition":"on-failure"},
    "Placement":{"Constraints":[]},
    "Networks":[{"Target":"network-1","Aliases":["app"]}],
    "ForceUpdate":1
  },
  "Mode":{"Replicated":{"Replicas":1}},
  "UpdateConfig":{"Parallelism":1,"Order":"stop-first"},
  "RollbackConfig":{"Parallelism":1,"Order":"stop-first"},
  "EndpointSpec":{"Mode":"vip","Ports":[{"Protocol":"tcp","TargetPort":8080,"PublishedPort":8080,"PublishMode":"ingress"}]}
}`)
	if err := validateDeploymentWorkerRawServiceShape(body); err != nil {
		t.Fatalf("expected the reviewed Compose/Swarm service shape to remain allowed: %v", err)
	}
}

func TestDeploymentWorkerRawServiceShapeRejectsUnknownNestedFields(t *testing.T) {
	tests := []string{
		`{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"Mounts":[{"Type":"volume","Source":"upstand-resource-resource-1-volume-data","Target":"/data","FutureMountControl":true}]}}}`,
		`{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"Mounts":[{"Type":"volume","Source":"upstand-resource-resource-1-volume-data","Target":"/data","VolumeOptions":{"FutureVolumeControl":true}}]}}}`,
		`{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"Secrets":[{"SecretID":"secret-1","File":{"Name":"app.secret","FutureFileControl":true}}]}}}`,
		`{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"Configs":[{"ConfigID":"config-1","FutureConfigControl":true}]}}}`,
		`{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"Healthcheck":{"Test":["CMD","true"],"FutureHealthControl":true}}}}`,
		`{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"DNSConfig":{"Nameservers":["1.1.1.1"],"FutureDnsControl":true}}}}`,
		`{"Name":"service-1","TaskTemplate":{"Placement":{"Preferences":[{"Spread":{"SpreadDescriptor":"node.labels.zone","FutureSpreadControl":true}}]}}}`,
		`{"Name":"service-1","TaskTemplate":{"Placement":{"Platforms":[{"Architecture":"amd64","OS":"linux","FuturePlatformControl":true}]}}}`,
		`{"Name":"service-1","Mode":{"ReplicatedJob":{"MaxConcurrent":1,"FutureJobControl":true}}}`,
	}
	for _, body := range tests {
		t.Run(body, func(t *testing.T) {
			if err := validateDeploymentWorkerRawServiceShape([]byte(body)); err == nil {
				t.Fatalf("expected unknown nested service field to be rejected: %s", body)
			}
		})
	}
}

func TestDeploymentWorkerRawServiceShapeAllowsReviewedNestedFields(t *testing.T) {
	body := []byte(`{
  "Name":"service-1",
  "TaskTemplate":{
    "ContainerSpec":{
      "Image":"example/app:latest",
      "Mounts":[{"Type":"volume","Source":"upstand-resource-resource-1-volume-data","Target":"/data","ReadOnly":true,"VolumeOptions":{"NoCopy":true}}],
      "Secrets":[{"SecretID":"secret-1","File":{"Name":"app.secret","UID":"1000","GID":"1000","Mode":292}}],
      "Configs":[{"ConfigID":"config-1","File":{"Name":"app.conf"}}],
      "Healthcheck":{"Test":["CMD-SHELL","true"],"Interval":1000000000,"Timeout":1000000000,"Retries":3,"StartPeriod":1000000000,"StartInterval":1000000000},
      "DNSConfig":{"Nameservers":["1.1.1.1"],"Search":["example.internal"],"Options":["ndots:1"]}
    },
    "Placement":{"Preferences":[{"Spread":{"SpreadDescriptor":"node.labels.zone"}}],"Platforms":[{"Architecture":"amd64","OS":"linux"}]}
  },
  "Mode":{"ReplicatedJob":{"MaxConcurrent":1,"TotalCompletions":1,"ReplicasMaxPerNode":1}}
}`)
	if err := validateDeploymentWorkerRawServiceShape(body); err != nil {
		t.Fatalf("expected reviewed nested service fields to remain valid: %v", err)
	}
}

func TestDeploymentWorkerRawServiceMutationRequiresAuthorizedEncryptedNetworks(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	t.Setenv("UPSTAND_DOCKER_NETWORK", "shared-net")

	ownedNetwork := `{"Id":"network-1","Name":"upstand-resource-resource-1-app","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`
	sharedNetwork := `{"Id":"network-2","Name":"shared-net","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""}}`
	foreignNetwork := `{"Id":"network-3","Name":"upstand-resource-other-resource","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"other-resource"}}`
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/networks/network-1":
			return dockerResponse(http.StatusOK, ownedNetwork)
		case "/networks/network-2":
			return dockerResponse(http.StatusOK, sharedNetwork)
		case "/networks/network-3":
			return dockerResponse(http.StatusOK, foreignNetwork)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})

	for _, test := range []struct {
		name string
		body string
		want bool
	}{
		{
			name: "owned network",
			body: `{"Name":"service-1","TaskTemplate":{"Networks":[{"Target":"network-1"}]}}`,
			want: true,
		},
		{
			name: "encrypted shared network",
			body: `{"Name":"service-1","TaskTemplate":{"Networks":[{"Target":"network-2"}]}}`,
			want: true,
		},
		{
			name: "foreign network",
			body: `{"Name":"service-1","TaskTemplate":{"Networks":[{"Target":"network-3"}]}}`,
		},
		{
			name: "missing target",
			body: `{"Name":"service-1","TaskTemplate":{"Networks":[{}]}}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/create", strings.NewReader(test.body))
			request.Header.Set("X-Upstand-Resource-ID", "resource-1")
			err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, []byte(test.body), engine)
			if test.want && err != nil {
				t.Fatalf("expected authorized network attachment to pass: %v", err)
			}
			if !test.want && err == nil {
				t.Fatal("expected unauthorized or malformed network attachment to fail")
			}
		})
	}
}

func TestDeploymentWorkerRawServiceUpdateRevalidatesExistingAndRequestedNetworks(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	body := []byte(`{"TaskTemplate":{"Networks":[{"Target":"foreign-network"}]}}`)
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/service-1/update", strings.NewReader(string(body)))
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/services/service-1":
			return dockerResponse(http.StatusOK, `{"Spec":{"Name":"service-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"Networks":[{"Target":"owned-network"}]}}}`)
		case "/networks/owned-network":
			return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"upstand-resource-resource-1","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`)
		case "/networks/foreign-network":
			return dockerResponse(http.StatusOK, `{"Id":"network-2","Name":"upstand-resource-other-resource","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"other-resource"}}`)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, engine); err == nil {
		t.Fatal("expected a service update that adds a foreign network to be rejected")
	}
}

func TestDeploymentWorkerRawServiceMutationRequiresOwnedSecretsAndConfigs(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	ownedSecret := `{"ID":"secret-1","Spec":{"Name":"upstand-resource-resource-1-secret-app","Labels":{"com.upstand.resource-id":"resource-1"}}}`
	ownedConfig := `{"ID":"config-1","Spec":{"Name":"upstand-resource-resource-1-config-app","Labels":{"com.upstand.resource-id":"resource-1"}}}`
	foreignSecret := `{"ID":"secret-2","Spec":{"Name":"upstand-resource-resource-2-secret-app","Labels":{"com.upstand.resource-id":"resource-2"}}}`
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/secrets/secret-1":
			return dockerResponse(http.StatusOK, ownedSecret)
		case "/configs/config-1":
			return dockerResponse(http.StatusOK, ownedConfig)
		case "/secrets/secret-2":
			return dockerResponse(http.StatusOK, foreignSecret)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})

	for _, test := range []struct {
		name string
		body string
		want bool
	}{
		{
			name: "owned secret and config",
			body: `{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"Secrets":[{"SecretID":"secret-1","SecretName":"upstand-resource-resource-1-secret-app"}],"Configs":[{"ConfigID":"config-1","ConfigName":"upstand-resource-resource-1-config-app"}]}}}`,
			want: true,
		},
		{
			name: "foreign secret",
			body: `{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"Secrets":[{"SecretID":"secret-2"}]}}}`,
		},
		{
			name: "missing identity",
			body: `{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"Configs":[{"File":{"Name":"app.conf"}}]}}}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/create", strings.NewReader(test.body))
			request.Header.Set("X-Upstand-Resource-ID", "resource-1")
			err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, []byte(test.body), engine)
			if test.want && err != nil {
				t.Fatalf("expected owned file-backed resource references to pass: %v", err)
			}
			if !test.want && err == nil {
				t.Fatal("expected foreign or malformed file-backed resource references to fail")
			}
		})
	}
}

func TestDeploymentWorkerRawServiceUpdateRevalidatesExistingSecretsAndConfigs(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	body := []byte(`{"TaskTemplate":{"ContainerSpec":{"Configs":[{"ConfigID":"config-foreign"}]}}}`)
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/service-1/update", strings.NewReader(string(body)))
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/services/service-1":
			return dockerResponse(http.StatusOK, `{"Spec":{"Name":"service-1","Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Secrets":[{"SecretID":"secret-1"}]}}}}`)
		case "/secrets/secret-1":
			return dockerResponse(http.StatusOK, `{"ID":"secret-1","Spec":{"Name":"upstand-resource-resource-1-secret-app","Labels":{"com.upstand.resource-id":"resource-1"}}}`)
		case "/configs/config-foreign":
			return dockerResponse(http.StatusOK, `{"ID":"config-foreign","Spec":{"Name":"upstand-resource-resource-2-config-app","Labels":{"com.upstand.resource-id":"resource-2"}}}`)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, engine); err == nil {
		t.Fatal("expected an update adding a foreign config to be rejected")
	}
}

func TestDeploymentWorkerRawServiceRejectsUnlabelledDeterministicFileReference(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	body := []byte(`{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"Secrets":[{"SecretID":"secret-1"}]}}}`)
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/create", strings.NewReader(string(body)))
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		if request.URL.Path == "/secrets/secret-1" {
			return dockerResponse(http.StatusOK, `{"ID":"secret-1","Spec":{"Name":"upstand-resource-resource-1-secret-app","Labels":{}}}`)
		}
		return dockerResponse(http.StatusNotFound, `{}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, engine); err == nil {
		t.Fatal("expected an unlabelled deterministic secret name to be rejected")
	}
}

func TestDeploymentWorkerRawExecRequiresOwningContainer(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/exec/exec-1/start", strings.NewReader(`{"Detach":false}`))
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	owned := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/exec/exec-1/json":
			return dockerResponse(http.StatusOK, `{"ContainerID":"container-1"}`)
		case "/containers/container-1/json":
			return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, owned); err != nil {
		t.Fatalf("expected an exec attached to an owned container to be allowed: %v", err)
	}

	foreign := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/exec/exec-1/json":
			return dockerResponse(http.StatusOK, `{"ContainerID":"container-1"}`)
		case "/containers/container-1/json":
			return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, foreign); err == nil {
		t.Fatal("expected an exec attached to a foreign container to be rejected")
	}
}

func TestDeploymentWorkerRawContainerReadsRequireDaemonOwnership(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/containers/container-1/logs", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	foreign := rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, foreign); err == nil {
		t.Fatal("expected a cross-resource container read to be rejected")
	}
}

func TestDeploymentWorkerRawContainerListingRequiresExactResourceFilter(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	for _, test := range []struct {
		name    string
		filters string
		valid   bool
	}{
		{name: "exact label", filters: `{"label":["com.docker.compose.project=app","com.upstand.resource-id=resource-1"]}`, valid: true},
		{name: "missing label", filters: `{"label":["com.docker.compose.project=app"]}`},
		{name: "foreign label", filters: `{"label":["com.upstand.resource-id=other-resource"]}`},
		{name: "malformed filters", filters: `{"label":[}`},
		{name: "wrong label shape", filters: `{"label":"com.upstand.resource-id=resource-1"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/containers/json?filters="+url.QueryEscape(test.filters), nil)
			request.Header.Set("X-Upstand-Resource-ID", "resource-1")
			err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, rawScopeTestEngine(func(*http.Request) *http.Response {
				t.Fatal("container list policy must fail before contacting Docker")
				return nil
			}))
			if test.valid && err != nil {
				t.Fatalf("expected an exact resource filter to be allowed: %v", err)
			}
			if !test.valid && err == nil {
				t.Fatal("expected an incomplete or foreign resource filter to be rejected")
			}
		})
	}
}

func TestDeploymentWorkerRawGlobalInventoryIsDenied(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	for _, path := range []string{"/info", "/images/json", "/nodes", "/system/df", "/volumes"} {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "http://broker/v1.43"+path, nil)
			request.Header.Set("X-Upstand-Resource-ID", "resource-1")
			err := authorizeDeploymentWorkerRawResourceScope(
				context.Background(),
				"deployment-worker",
				request,
				nil,
				rawScopeTestEngine(func(*http.Request) *http.Response {
					t.Fatal("global inventory policy must fail before contacting Docker")
					return nil
				}),
			)
			if err == nil {
				t.Fatal("expected global deployment-worker inventory to be rejected")
			}
		})
	}
}

func TestDeploymentWorkerRawContainerCreateRequiresManagedNetworks(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	ownedNetwork := `{"Id":"network-1","Name":"upstand-resource-resource-1","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`
	foreignNetwork := `{"Id":"network-2","Name":"upstand-resource-resource-2","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-2"}}`
	bodyFor := func(network string) []byte {
		return []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"},"NetworkingConfig":{"EndpointsConfig":{"` + network + `":{}}}}`)
	}
	for _, test := range []struct {
		name       string
		body       []byte
		network    string
		inspection string
		wantError  bool
	}{
		{name: "owned encrypted network", body: bodyFor("upstand-resource-resource-1"), network: "upstand-resource-resource-1", inspection: ownedNetwork},
		{name: "foreign network", body: bodyFor("upstand-resource-resource-2"), network: "upstand-resource-resource-2", inspection: foreignNetwork, wantError: true},
		{name: "implicit default bridge", body: []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"}}`), wantError: true},
		{name: "explicit networkless mode", body: []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"},"HostConfig":{"NetworkMode":"none"}}`)},
		{name: "explicit network-disabled mode", body: []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"},"NetworkDisabled":true}`)},
		{name: "network-disabled with endpoints", body: []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"},"NetworkDisabled":true,"NetworkingConfig":{"EndpointsConfig":{"upstand-resource-resource-1":{}}}}`), network: "upstand-resource-resource-1", inspection: ownedNetwork, wantError: true},
		{name: "none mode with endpoints", body: []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"},"HostConfig":{"NetworkMode":"none"},"NetworkingConfig":{"EndpointsConfig":{"upstand-resource-resource-1":{}}}}`), network: "upstand-resource-resource-1", inspection: ownedNetwork, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/containers/create", strings.NewReader(string(test.body)))
			request.Header.Set("X-Upstand-Resource-ID", "resource-1")
			engine := rawScopeTestEngine(func(r *http.Request) *http.Response {
				if test.network != "" && r.URL.Path == "/networks/"+test.network {
					return dockerResponse(http.StatusOK, test.inspection)
				}
				return dockerResponse(http.StatusNotFound, `{}`)
			})
			err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, test.body, engine)
			if test.wantError && err == nil {
				t.Fatal("expected unsafe or foreign container network to be rejected")
			}
			if !test.wantError && err != nil {
				t.Fatalf("expected container network policy to pass: %v", err)
			}
		})
	}
}

func TestDeploymentWorkerRawContainerCreateRequiresLiveOwnedVolumes(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	ownedNetwork := `{"Id":"network-1","Name":"upstand-resource-resource-1","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`
	ownedVolume := `{"Name":"upstand-resource-resource-1-volume-data","Driver":"local","Options":{},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`
	legacyVolume := `{"Name":"upstand-db-data-resource-1","Driver":"local","Options":{}}`
	bodyFor := func(volume string) []byte {
		return []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"},"HostConfig":{"Mounts":[{"Type":"volume","Source":"` + volume + `","Target":"/data"}]},"NetworkingConfig":{"EndpointsConfig":{"upstand-resource-resource-1":{}}}}`)
	}
	for _, test := range []struct {
		name       string
		body       []byte
		volume     string
		inspection string
		wantError  bool
	}{
		{name: "owned managed volume", body: bodyFor("upstand-resource-resource-1-volume-data"), volume: "upstand-resource-resource-1-volume-data", inspection: ownedVolume},
		{name: "legacy database volume", body: bodyFor("upstand-db-data-resource-1"), volume: "upstand-db-data-resource-1", inspection: legacyVolume},
		{name: "foreign label", body: bodyFor("upstand-resource-resource-1-volume-data"), volume: "upstand-resource-resource-1-volume-data", inspection: `{"Name":"upstand-resource-resource-1-volume-data","Driver":"local","Options":{},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"other-resource"}}`, wantError: true},
		{name: "host-backed options", body: bodyFor("upstand-resource-resource-1-volume-data"), volume: "upstand-resource-resource-1-volume-data", inspection: `{"Name":"upstand-resource-resource-1-volume-data","Driver":"local","Options":{"device":"/var/lib"},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/containers/create", strings.NewReader(string(test.body)))
			request.Header.Set("X-Upstand-Resource-ID", "resource-1")
			engine := rawScopeTestEngine(func(r *http.Request) *http.Response {
				switch r.URL.Path {
				case "/volumes/" + test.volume:
					return dockerResponse(http.StatusOK, test.inspection)
				case "/networks/upstand-resource-resource-1":
					return dockerResponse(http.StatusOK, ownedNetwork)
				default:
					return dockerResponse(http.StatusNotFound, `{}`)
				}
			})
			err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, test.body, engine)
			if test.wantError && err == nil {
				t.Fatal("expected unsafe or foreign container volume to be rejected")
			}
			if !test.wantError && err != nil {
				t.Fatalf("expected an authorized container volume to pass: %v", err)
			}
		})
	}
}

func TestDeploymentWorkerRawContainerCreateRejectsCrossContainerVolumeInheritance(t *testing.T) {
	for _, field := range []string{"VolumesFrom", "ContainerIDFile"} {
		t.Run(field, func(t *testing.T) {
			t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
			body := []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"},"HostConfig":{"` + field + `:["other-resource"]},"NetworkingConfig":{"EndpointsConfig":{"upstand-resource-resource-1":{}}}}`)
			if field == "ContainerIDFile" {
				body = []byte(`{"Labels":{"com.upstand.resource-id":"resource-1"},"HostConfig":{"ContainerIDFile":"/tmp/container-id"},"NetworkingConfig":{"EndpointsConfig":{"upstand-resource-resource-1":{}}}}`)
			}
			request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/containers/create", strings.NewReader(string(body)))
			request.Header.Set("X-Upstand-Resource-ID", "resource-1")
			err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, rawScopeTestEngine(func(*http.Request) *http.Response {
				t.Fatal("cross-container or host file controls must fail before Docker inspection")
				return nil
			}))
			if err == nil {
				t.Fatal("expected unsafe container control to be rejected")
			}
		})
	}
}

func TestDeploymentWorkerRawContainerCreateRejectsUnreviewedDockerFields(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	for _, test := range []struct {
		name string
		body string
	}{
		{
			name: "unknown top-level field",
			body: `{"Labels":{"com.upstand.resource-id":"resource-1"},"NetworkingConfig":{"EndpointsConfig":{}},"FutureDaemonCapability":true}`,
		},
		{
			name: "unknown host config field",
			body: `{"Labels":{"com.upstand.resource-id":"resource-1"},"NetworkingConfig":{"EndpointsConfig":{}},"HostConfig":{"FutureDaemonCapability":true}}`,
		},
		{
			name: "unknown network endpoint field",
			body: `{"Labels":{"com.upstand.resource-id":"resource-1"},"NetworkingConfig":{"EndpointsConfig":{"upstand-resource-resource-1":{"FutureNetworkCapability":true}}}}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/containers/create", strings.NewReader(test.body))
			request.Header.Set("X-Upstand-Resource-ID", "resource-1")
			err := authorizeDeploymentWorkerRawResourceScope(
				context.Background(),
				"deployment-worker",
				request,
				[]byte(test.body),
				rawScopeTestEngine(func(*http.Request) *http.Response {
					t.Fatal("container shape policy must fail before contacting Docker")
					return nil
				}),
			)
			if err == nil {
				t.Fatal("expected an unreviewed Docker container field to be rejected")
			}
		})
	}
}

func TestDeploymentWorkerRawContainerCreateAllowsReviewedComposeShape(t *testing.T) {
	body := []byte(`{
  "Image":"example/app:latest",
  "Labels":{"com.upstand.resource-id":"resource-1"},
  "Env":["PORT=8080"],
  "WorkingDir":"/app",
  "HostConfig":{
    "NetworkMode":"default",
    "RestartPolicy":{"Name":"on-failure","MaximumRetryCount":3},
    "LogConfig":{"Type":"json-file","Config":{}},
    "ReadonlyRootfs":true,
    "SecurityOpt":["no-new-privileges:true"]
  },
  "NetworkingConfig":{
    "EndpointsConfig":{
      "upstand-resource-resource-1":{
        "Aliases":["app"],
        "NetworkID":"network-1"
      }
    }
  }
}`)
	if err := validateDeploymentWorkerRawContainerShape(body); err != nil {
		t.Fatalf("expected the reviewed Compose container shape to remain allowed: %v", err)
	}
}

func TestDeploymentWorkerRawContainerCreateRejectsExternalLogDrivers(t *testing.T) {
	for _, logType := range []string{"syslog", "fluentd", "gelf", "journald", "splunk"} {
		t.Run(logType, func(t *testing.T) {
			body := []byte(`{"Image":"example/app:latest","HostConfig":{"LogConfig":{"Type":"` + logType + `","Config":{}}}}`)
			if err := validateDeploymentWorkerRawContainerShape(body); err == nil {
				t.Fatalf("expected external Docker log driver %q to be rejected", logType)
			}
		})
	}
}

func TestDeploymentWorkerRawContainerCreateRejectsMalformedLogDriverTypes(t *testing.T) {
	for _, logType := range []string{`true`, `[]`, `null`} {
		t.Run(logType, func(t *testing.T) {
			body := []byte(`{"Image":"example/app:latest","HostConfig":{"LogConfig":{"Type":` + logType + `}}}`)
			if err := validateDeploymentWorkerRawContainerShape(body); err == nil {
				t.Fatalf("expected malformed Docker log driver type %s to be rejected", logType)
			}
		})
	}
}

func TestDeploymentWorkerRawContainerCreateAllowsBoundedBuiltinLogConfig(t *testing.T) {
	for _, logType := range []string{"json-file", "local"} {
		t.Run(logType, func(t *testing.T) {
			body := []byte(`{"Image":"example/app:latest","HostConfig":{"LogConfig":{"Type":"` + logType + `","Config":{"max-size":"10m","max-file":"3","compress":"true"}}}}`)
			if err := validateDeploymentWorkerRawContainerShape(body); err != nil {
				t.Fatalf("expected bounded built-in Docker log driver %q to be allowed: %v", logType, err)
			}
		})
	}
}

func TestDeploymentWorkerRawContainerCreateRejectsUnreviewedLogConfigOptions(t *testing.T) {
	for _, config := range []string{
		`{"plugin-endpoint":"http://collector"}`,
		`{"max-size":true}`,
		`{"max-size":"line\nbreak"}`,
	} {
		t.Run(config, func(t *testing.T) {
			body := []byte(`{"Image":"example/app:latest","HostConfig":{"LogConfig":{"Type":"json-file","Config":` + config + `}}}`)
			if err := validateDeploymentWorkerRawContainerShape(body); err == nil {
				t.Fatalf("expected unsafe Docker log configuration to be rejected: %s", config)
			}
		})
	}
}

func TestDeploymentWorkerRawServiceListingRequiresExactResourceFilter(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	for _, test := range []struct {
		name    string
		filters string
		valid   bool
	}{
		{name: "exact label", filters: `{"label":["com.docker.stack.namespace=app","com.upstand.resource-id=resource-1"]}`, valid: true},
		{name: "missing label", filters: `{"label":["com.docker.stack.namespace=app"]}`},
		{name: "foreign label", filters: `{"label":["com.upstand.resource-id=other-resource"]}`},
		{name: "malformed filters", filters: `{"label":[}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/services?filters="+url.QueryEscape(test.filters), nil)
			request.Header.Set("X-Upstand-Resource-ID", "resource-1")
			err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, rawScopeTestEngine(func(*http.Request) *http.Response {
				t.Fatal("service list policy must fail before contacting Docker")
				return nil
			}))
			if test.valid && err != nil {
				t.Fatalf("expected an exact resource filter to be allowed: %v", err)
			}
			if !test.valid && err == nil {
				t.Fatal("expected an incomplete or foreign resource filter to be rejected")
			}
		})
	}
}

func TestDeploymentWorkerRawTaskListingRequiresOwnedService(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/tasks?filters="+url.QueryEscape(`{"service":["service-1"]}`), nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	owned := rawScopeTestEngine(func(request *http.Request) *http.Response {
		if request.URL.Path == "/services/service-1" {
			return dockerResponse(http.StatusOK, `{"Spec":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`)
		}
		return dockerResponse(http.StatusNotFound, `{}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, owned); err != nil {
		t.Fatalf("expected task listing for an owned service to be allowed: %v", err)
	}

	foreign := rawScopeTestEngine(func(request *http.Request) *http.Response {
		if request.URL.Path == "/services/service-1" {
			return dockerResponse(http.StatusOK, `{"Spec":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`)
		}
		return dockerResponse(http.StatusNotFound, `{}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, foreign); err == nil {
		t.Fatal("expected task listing for a foreign service to be rejected")
	}

	withoutFilter := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/tasks", nil)
	withoutFilter.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", withoutFilter, nil, owned); err == nil {
		t.Fatal("expected an unscoped task listing to be rejected")
	}
}

func TestDeploymentWorkerRawServiceInspectionRequiresOwnership(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/services/service-1", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	foreign := rawScopeTestEngine(func(*http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Spec":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, foreign); err == nil {
		t.Fatal("expected a foreign service inspection to be rejected")
	}
}

func TestDeploymentWorkerRawNetworkInspectionRequiresManagedOwnership(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/networks/network-1", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	owned := rawScopeTestEngine(func(*http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"upstand-resource-resource-1","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, owned); err != nil {
		t.Fatalf("expected an owned managed network inspection to be allowed: %v", err)
	}

	foreign := rawScopeTestEngine(func(*http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"upstand-resource-other-resource","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"other-resource"}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, foreign); err == nil {
		t.Fatal("expected a foreign managed network inspection to be rejected")
	}
}

func TestDeploymentWorkerRawVolumeInspectionRequiresManagedOwnership(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/volumes/upstand-resource-resource-1-volume-data", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	owned := rawScopeTestEngine(func(*http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Name":"upstand-resource-resource-1-volume-data","Driver":"local","Options":{},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, owned); err != nil {
		t.Fatalf("expected an owned managed volume inspection to be allowed: %v", err)
	}

	foreign := rawScopeTestEngine(func(*http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Name":"upstand-resource-resource-1-volume-data","Driver":"local","Options":{},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"other-resource"}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, foreign); err == nil {
		t.Fatal("expected a volume with a foreign ownership label to be rejected")
	}
}

func TestDeploymentWorkerRawDatabaseVolumeInspectionUsesExactResourceName(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/volumes/upstand-db-data-resource-1", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	engine := rawScopeTestEngine(func(*http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Name":"upstand-db-data-resource-1","Driver":"local","Options":{}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, engine); err != nil {
		t.Fatalf("expected the exact resource database volume to remain available: %v", err)
	}

	foreignName := httptest.NewRequest(http.MethodGet, "http://broker/v1.43/volumes/upstand-db-data-resource-2", nil)
	foreignName.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", foreignName, nil, engine); err == nil {
		t.Fatal("expected a database volume named for another resource to be rejected")
	}
}

func TestDeploymentWorkerRawServiceMountsRequireLiveOwnedVolumes(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/services/create", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")

	for _, test := range []struct {
		name       string
		volumeName string
		inspection string
		wantError  bool
	}{
		{
			name:       "managed resource volume",
			volumeName: "upstand-resource-resource-1-volume-data",
			inspection: `{"Name":"upstand-resource-resource-1-volume-data","Driver":"local","Options":{},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`,
		},
		{
			name:       "host-backed options",
			volumeName: "upstand-resource-resource-1-volume-data",
			inspection: `{"Name":"upstand-resource-resource-1-volume-data","Driver":"local","Options":{"device":"/var/lib"},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`,
			wantError:  true,
		},
		{
			name:       "foreign ownership",
			volumeName: "upstand-resource-resource-1-volume-data",
			inspection: `{"Name":"upstand-resource-resource-1-volume-data","Driver":"local","Options":{},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-2"}}`,
			wantError:  true,
		},
		{
			name:       "legacy database volume",
			volumeName: "upstand-db-data-resource-1",
			inspection: `{"Name":"upstand-db-data-resource-1","Driver":"local","Options":{}}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := []byte(`{"Name":"service-1","TaskTemplate":{"ContainerSpec":{"Mounts":[{"Type":"volume","Source":"` + test.volumeName + `","Target":"/data"}]}}}`)
			engine := rawScopeTestEngine(func(r *http.Request) *http.Response {
				if r.URL.Path != "/volumes/"+test.volumeName {
					t.Fatalf("unexpected Docker inspection path: %s", r.URL.Path)
				}
				return dockerResponse(http.StatusOK, test.inspection)
			})
			err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, engine)
			if test.wantError && err == nil {
				t.Fatal("expected an unsafe or foreign service volume to be rejected")
			}
			if !test.wantError && err != nil {
				t.Fatalf("expected an authorized service volume to pass: %v", err)
			}
		})
	}
}

func TestTypedResourceServiceMountsRequireLiveOwnedVolumes(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	body := []byte(`{"TaskTemplate":{"ContainerSpec":{"Mounts":[{"Type":"volume","Source":"upstand-resource-resource-1-volume-data","Target":"/data"}]}}}`)
	owned := rawScopeTestEngine(func(r *http.Request) *http.Response {
		if r.URL.Path != "/volumes/upstand-resource-resource-1-volume-data" {
			t.Fatalf("unexpected Docker inspection path: %s", r.URL.Path)
		}
		return dockerResponse(http.StatusOK, `{"Name":"upstand-resource-resource-1-volume-data","Driver":"local","Options":{},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`)
	})
	if err := authorizeTypedServiceFileBackedResources(context.Background(), body, "resource-1", owned); err != nil {
		t.Fatalf("expected the typed service volume to pass live ownership verification: %v", err)
	}

	foreign := rawScopeTestEngine(func(*http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Name":"upstand-resource-resource-1-volume-data","Driver":"local","Options":{},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-2"}}`)
	})
	if err := authorizeTypedServiceFileBackedResources(context.Background(), body, "resource-1", foreign); err == nil {
		t.Fatal("expected the typed service volume with foreign ownership to be rejected")
	}
}

func TestDeploymentWorkerRawNetworkAttachmentRequiresOwnedNetworkAndContainer(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	body := []byte(`{"Container":"container-1"}`)
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/networks/network-1":
			return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"upstand-resource-resource-1-app","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"resource-1"}}`)
		case "/containers/container-1/json":
			return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/networks/network-1/connect", strings.NewReader(string(body)))
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, engine); err != nil {
		t.Fatalf("expected an owned network attachment to be allowed: %v", err)
	}

	foreignNetwork := rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"upstand-resource-other-resource-app","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""},"Labels":{"com.upstand.managed":"true","com.upstand.purpose":"resource-isolation","com.upstand.resource-id":"other-resource"}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, foreignNetwork); err == nil {
		t.Fatal("expected a cross-resource network attachment to be rejected")
	}
}

func TestDeploymentWorkerRawSharedNetworkStillRequiresEncryptedNetworkAndOwnedContainer(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	t.Setenv("UPSTAND_DOCKER_NETWORK", "shared-net")
	body := []byte(`{"Container":"container-1"}`)
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		switch request.URL.Path {
		case "/networks/shared-net":
			return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"shared-net","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{"encrypted":""}}`)
		case "/containers/container-1/json":
			return dockerResponse(http.StatusOK, `{"Config":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`)
		default:
			return dockerResponse(http.StatusNotFound, `{}`)
		}
	})
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/networks/shared-net/connect", strings.NewReader(string(body)))
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, engine); err != nil {
		t.Fatalf("expected the encrypted shared network to remain available: %v", err)
	}

	unencrypted := rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Id":"network-1","Name":"shared-net","Driver":"overlay","Scope":"swarm","Attachable":true,"Options":{}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, unencrypted); err == nil {
		t.Fatal("expected an unencrypted shared network to be rejected")
	}
}

func TestDeploymentWorkerRawNetworkAttachmentRequiresBoundedJSONIdentity(t *testing.T) {
	t.Setenv("UPSTAND_DOCKER_BROKER_TLS_REQUIRED", "true")
	request := httptest.NewRequest(http.MethodPost, "http://broker/v1.43/networks/network-1/connect", nil)
	request.Header.Set("X-Upstand-Resource-ID", "resource-1")
	engine := rawScopeTestEngine(func(request *http.Request) *http.Response {
		t.Fatal("invalid network attachment must fail before contacting Docker")
		return nil
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, nil, engine); err == nil {
		t.Fatal("expected a missing network attachment body to be rejected")
	}
}

func rawScopeTestEngine(handler func(*http.Request) *http.Response) *dockerEngineClient {
	return &dockerEngineClient{httpClient: &http.Client{
		Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			return handler(request), nil
		}),
	}}
}
