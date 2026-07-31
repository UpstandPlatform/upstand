import { describe, expect, test } from "bun:test";
import { parseApacheConfig } from "./import/apache-importer";
import { parseCaddyfile } from "./import/caddy-importer";
import { parseNginxConfig } from "./import/nginx-importer";
import { parseTraefikConfig } from "./import/traefik-importer";
import { classifyProxyCommand } from "./proxy-detector";

describe("Proxy Engine Importers", () => {
  test("classifies proxy command correctly", () => {
    expect(classifyProxyCommand("/usr/bin/caddy run")).toBe("caddy");
    expect(classifyProxyCommand("traefik --providers.docker")).toBe("traefik");
    expect(classifyProxyCommand("nginx -g daemon off;")).toBe("nginx");
    expect(classifyProxyCommand("apache2 -DFOREGROUND")).toBe("apache");
    expect(classifyProxyCommand("openresty -g daemon off;")).toBe("openresty");
  });

  test("parses Caddyfile reverse proxy blocks", () => {
    const caddyfile = `
example.com {
  reverse_proxy localhost:8080
}

api.example.com {
  reverse_proxy 127.0.0.1:3000
}
    `;

    const { sites, warnings } = parseCaddyfile(caddyfile);
    expect(sites).toHaveLength(2);
    expect(sites[0]?.serverNames).toEqual(["example.com"]);
    expect(sites[0]?.target.kind).toBe("proxy");
    if (sites[0]?.target.kind === "proxy") {
      expect(sites[0].target.url).toBe("http://localhost:8080");
    }
    expect(sites[1]?.serverNames).toEqual(["api.example.com"]);
    expect(warnings).toHaveLength(0);
  });

  test("parses Nginx server blocks", () => {
    const nginxConf = `
server {
  listen 80;
  server_name myapp.internal www.myapp.internal;
  location / {
    proxy_pass http://127.0.0.1:4000;
  }
}
    `;

    const { sites, warnings } = parseNginxConfig(nginxConf);
    expect(sites).toHaveLength(1);
    expect(sites[0]?.serverNames).toEqual([
      "myapp.internal",
      "www.myapp.internal",
    ]);
    expect(sites[0]?.ssl).toBe(false);
    expect(sites[0]?.target.kind).toBe("proxy");
    if (sites[0]?.target.kind === "proxy") {
      expect(sites[0].target.url).toBe("http://127.0.0.1:4000");
    }
    expect(warnings).toHaveLength(0);
  });

  test("parses Traefik Host() rules", () => {
    const traefikYaml = `
http:
  routers:
    my-router:
      rule: "Host(\`app.domain.org\`)"
      service: "my-service"
  services:
    my-service:
      loadBalancer:
        servers:
          - url: "http://10.0.0.5:8000"
    `;

    const { sites, warnings } = parseTraefikConfig(traefikYaml);
    expect(sites).toHaveLength(1);
    expect(sites[0]?.serverNames).toEqual(["app.domain.org"]);
    if (sites[0]?.target.kind === "proxy") {
      expect(sites[0].target.url).toBe("http://10.0.0.5:8000");
    }
    expect(warnings).toHaveLength(0);
  });

  test("parses Apache VirtualHost blocks", () => {
    const apacheConf = `
<VirtualHost *:80>
  ServerName service.local
  ServerAlias www.service.local
  ProxyPass / http://127.0.0.1:5000/
</VirtualHost>
    `;

    const { sites, warnings } = parseApacheConfig(apacheConf);
    expect(sites).toHaveLength(1);
    expect(sites[0]?.serverNames).toEqual([
      "service.local",
      "www.service.local",
    ]);
    if (sites[0]?.target.kind === "proxy") {
      expect(sites[0].target.url).toBe("http://127.0.0.1:5000/");
    }
    expect(warnings).toHaveLength(0);
  });
});
