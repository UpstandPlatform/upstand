import { describe, expect, test } from "bun:test";
import {
  recordAuthenticationAttempt,
  recordServerRequest,
  recordWebhookRequest,
  renderServerMetrics,
} from "./server-metrics";

describe("server metrics", () => {
  test("renders low-cardinality request and process metrics", () => {
    recordServerRequest("get", 200, 12);
    recordServerRequest("POST", 500, 25);
    recordServerRequest(
      "PATCH",
      204,
      75,
      "/api/deploy/resource-secret-id/deployment-id",
    );
    recordAuthenticationAttempt(true);
    recordAuthenticationAttempt(false);

    const metrics = renderServerMetrics();
    expect(metrics).toContain(
      'upstand_server_requests_total{method="GET",status="200"}',
    );
    expect(metrics).toContain(
      'upstand_server_requests_total{method="POST",status="500"}',
    );
    expect(metrics).toContain("upstand_server_request_duration_seconds_total");
    expect(metrics).toContain(
      'upstand_server_route_requests_total{route_group="deployments",method="PATCH",status="204"} 1',
    );
    expect(metrics).toContain(
      'upstand_server_route_request_duration_seconds_bucket{route_group="deployments",le="0.1"} 1',
    );
    expect(metrics).toContain(
      'upstand_server_route_request_duration_seconds_count{route_group="deployments"} 1',
    );
    expect(metrics).toContain("upstand_server_process_resident_memory_bytes");
    expect(metrics).toContain(
      'upstand_server_authentication_attempts_total{outcome="authenticated"}',
    );
    expect(metrics).toContain(
      'upstand_server_authentication_attempts_total{outcome="rejected"}',
    );
    expect(metrics).toContain(
      'upstand_ai_budget_reservations_total{outcome="admitted"}',
    );
    expect(metrics).toContain("upstand_ai_budget_reserved_tokens_total");
    expect(metrics).not.toContain("organizationId");
    expect(metrics).not.toContain("resource-secret-id");
    expect(metrics).not.toContain("deployment-id");
  });

  test("normalizes custom methods, malformed status, and latency without unbounded labels", () => {
    recordServerRequest(
      "CUSTOM-ATTACKER-METHOD",
      Number.NaN,
      Number.NaN,
      "/api",
    );

    const metrics = renderServerMetrics();

    expect(metrics).toContain(
      'upstand_server_requests_total{method="OTHER",status="500"}',
    );
    expect(metrics).toContain(
      'upstand_server_route_requests_total{route_group="api",method="OTHER",status="500"}',
    );
    expect(metrics).not.toContain("CUSTOM-ATTACKER-METHOD");
    expect(metrics).not.toContain("NaN");
  });

  test("renders bounded PostgreSQL pool gauges when supplied", () => {
    const metrics = renderServerMetrics(Date.now(), {
      total: 20,
      idle: 3,
      waiting: 2,
    });

    expect(metrics).toContain("upstand_server_database_pool_total 20");
    expect(metrics).toContain("upstand_server_database_pool_idle 3");
    expect(metrics).toContain("upstand_server_database_pool_waiting 2");
    expect(metrics).not.toContain("organizationId");
  });

  test("renders low-cardinality webhook RED metrics without request identifiers", () => {
    recordWebhookRequest("github", 401, 25);
    recordWebhookRequest("deployment", 202, 75);

    const metrics = renderServerMetrics();

    expect(metrics).toContain(
      'upstand_server_webhook_requests_total{provider="github",status="401"} 1',
    );
    expect(metrics).toContain(
      'upstand_server_webhook_requests_total{provider="deployment",status="202"} 1',
    );
    expect(metrics).toContain(
      "upstand_server_webhook_request_duration_seconds_total",
    );
    expect(metrics).not.toContain("providerId");
    expect(metrics).not.toContain("resourceId");
    expect(metrics).not.toContain("deliveryId");
  });

  test("normalizes malformed webhook metric inputs to bounded values", () => {
    recordWebhookRequest("github", Number.NaN, Number.NaN);

    const metrics = renderServerMetrics();

    expect(metrics).toContain(
      'upstand_server_webhook_requests_total{provider="github",status="500"}',
    );
    expect(metrics).not.toContain("NaN");
  });

  test("rejects invalid PostgreSQL pool values", () => {
    expect(() =>
      renderServerMetrics(Date.now(), {
        total: Number.NaN,
        idle: 0,
        waiting: 0,
      }),
    ).toThrow("Database pool metrics must be finite and non-negative");
  });
});
