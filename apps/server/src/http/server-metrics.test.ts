import { describe, expect, test } from "bun:test";
import {
  recordAuthenticationAttempt,
  recordServerRequest,
  renderServerMetrics,
} from "./server-metrics";

describe("server metrics", () => {
  test("renders low-cardinality request and process metrics", () => {
    recordServerRequest("get", 200, 12);
    recordServerRequest("POST", 500, 25);
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
    expect(metrics).toContain("upstand_server_process_resident_memory_bytes");
    expect(metrics).toContain(
      'upstand_server_authentication_attempts_total{outcome="authenticated"}',
    );
    expect(metrics).toContain(
      'upstand_server_authentication_attempts_total{outcome="rejected"}',
    );
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
