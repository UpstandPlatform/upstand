package containers

import "testing"

func TestDockerTransportAvailable(t *testing.T) {
	t.Setenv("DOCKER_CERT_PATH", "/run/secrets")
	exists := func(path string) bool {
		return path == "/var/run/docker.sock"
	}

	tests := []struct {
		name string
		host string
		want bool
	}{
		{name: "default socket", host: "", want: true},
		{name: "configured socket", host: "unix:///var/run/docker.sock", want: true},
		{name: "broker without client certificates", host: "https://docker-broker:2375", want: false},
		{name: "unknown scheme", host: "ssh://docker-broker", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := dockerTransportAvailable(test.host, exists); got != test.want {
				t.Fatalf("dockerTransportAvailable(%q) = %v, want %v", test.host, got, test.want)
			}
		})
	}
}

func TestDockerTransportAvailableRequiresCompleteHttpsIdentity(t *testing.T) {
	t.Setenv("DOCKER_CERT_PATH", "/run/secrets")
	exists := func(path string) bool {
		return path != "/run/secrets/key.pem"
	}
	if dockerTransportAvailable("https://docker-broker:2375", exists) {
		t.Fatal("HTTPS Docker transport must require CA, client certificate, and client key")
	}
}

func TestDockerTransportAvailableAcceptsCompleteHttpsIdentity(t *testing.T) {
	t.Setenv("DOCKER_CERT_PATH", "/run/secrets")
	exists := func(path string) bool {
		return path == "/run/secrets/ca.pem" ||
			path == "/run/secrets/cert.pem" ||
			path == "/run/secrets/key.pem"
	}
	if !dockerTransportAvailable("https://docker-broker:2375", exists) {
		t.Fatal("HTTPS Docker transport should be enabled when all client identity files exist")
	}
}
