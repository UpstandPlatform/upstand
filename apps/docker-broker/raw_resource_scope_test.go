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
		return dockerResponse(http.StatusOK, `{"Spec":{"Labels":{"com.upstand.resource-id":"resource-1"}}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, owned); err != nil {
		t.Fatalf("expected an owned service update to be allowed: %v", err)
	}

	foreign := rawScopeTestEngine(func(request *http.Request) *http.Response {
		return dockerResponse(http.StatusOK, `{"Spec":{"Labels":{"com.upstand.resource-id":"other-resource"}}}`)
	})
	if err := authorizeDeploymentWorkerRawResourceScope(context.Background(), "deployment-worker", request, body, foreign); err == nil {
		t.Fatal("expected a cross-resource service update to be rejected")
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
			body: `{"TaskTemplate":{"Networks":[{"Target":"network-1"}]}}`,
			want: true,
		},
		{
			name: "encrypted shared network",
			body: `{"TaskTemplate":{"Networks":[{"Target":"network-2"}]}}`,
			want: true,
		},
		{
			name: "foreign network",
			body: `{"TaskTemplate":{"Networks":[{"Target":"network-3"}]}}`,
		},
		{
			name: "missing target",
			body: `{"TaskTemplate":{"Networks":[{}]}}`,
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
			return dockerResponse(http.StatusOK, `{"Spec":{"Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"Networks":[{"Target":"owned-network"}]}}}`)
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
			body: `{"TaskTemplate":{"ContainerSpec":{"Secrets":[{"SecretID":"secret-1","SecretName":"upstand-resource-resource-1-secret-app"}],"Configs":[{"ConfigID":"config-1","ConfigName":"upstand-resource-resource-1-config-app"}]}}}`,
			want: true,
		},
		{
			name: "foreign secret",
			body: `{"TaskTemplate":{"ContainerSpec":{"Secrets":[{"SecretID":"secret-2"}]}}}`,
		},
		{
			name: "missing identity",
			body: `{"TaskTemplate":{"ContainerSpec":{"Configs":[{"File":{"Name":"app.conf"}}]}}}`,
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
			return dockerResponse(http.StatusOK, `{"Spec":{"Labels":{"com.upstand.resource-id":"resource-1"},"TaskTemplate":{"ContainerSpec":{"Secrets":[{"SecretID":"secret-1"}]}}}}`)
		case "/secrets/secret-1":
			return dockerResponse(http.StatusOK, `{"ID":"secret-1","Spec":{"Name":"upstand-resource-resource-1-secret-app"}}`)
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
			body := []byte(`{"TaskTemplate":{"ContainerSpec":{"Mounts":[{"Type":"volume","Source":"` + test.volumeName + `","Target":"/data"}]}}}`)
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
