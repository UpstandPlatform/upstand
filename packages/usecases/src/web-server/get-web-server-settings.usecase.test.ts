import { describe, expect, test } from "bun:test";
import { buildControlPlaneRoutes } from "./get-web-server-settings.usecase";

describe("buildControlPlaneRoutes", () => {
  test("uses one site block when dashboard and API share a host", () => {
    const caddyfile = buildControlPlaneRoutes(
      {
        dashboardHost: "203.0.113.10",
        apiHost: "203.0.113.10",
        docsHost: "docs.example.com",
      },
      {
        web: "upstand_web:3001",
        server: "upstand_server:3000",
        fumadocs: "upstand_fumadocs:4000",
      },
    );

    expect(caddyfile.match(/203\.0\.113\.10 \{/g)).toHaveLength(1);
    expect(caddyfile).toContain("handle /api/*");
    expect(caddyfile).toContain("reverse_proxy upstand_server:3000");
    expect(caddyfile).toContain("reverse_proxy upstand_web:3001");
    expect(caddyfile).toContain("docs.example.com {");
  });

  test("does not emit duplicate blocks when docs shares a control-plane host", () => {
    const caddyfile = buildControlPlaneRoutes({
      dashboardHost: "example.com",
      apiHost: "api.example.com",
      docsHost: "example.com",
    });

    expect(caddyfile.match(/^example\.com \{$/gm)).toHaveLength(1);
    expect(caddyfile).toContain("api.example.com {");
  });
});
