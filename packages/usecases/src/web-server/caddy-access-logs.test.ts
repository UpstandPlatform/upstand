import { describe, expect, test } from "bun:test";
import {
  AccessLogQuerySchema,
  aggregateAccessLogStats,
  parseAccessLogEntries,
  queryAccessLogDashboard,
  queryAccessLogEntries,
} from "./caddy-access-logs";

const logs = [
  JSON.stringify({
    ts: 1_700_000_000,
    request: {
      method: "GET",
      host: "app.example.com",
      uri: "/",
      client_ip: "203.0.113.10",
      proto: "HTTP/2.0",
    },
    status: 200,
    duration: 0.015,
    size: 1200,
  }),
  JSON.stringify({
    ts: 1_700_000_120,
    request: {
      method: "POST",
      host: "app.example.com",
      uri: "/login?email=private@example.com",
      client_ip: "203.0.113.11",
      proto: "HTTP/2.0",
    },
    status: 500,
    duration: 0.2,
    size: 64,
  }),
].join("\n");

describe("Caddy access log parsing", () => {
  test("rejects reversed and unbounded request windows", () => {
    const query = {
      page: 1,
      pageSize: 25,
      sortBy: "timestamp" as const,
      sortDirection: "desc" as const,
      statusGroup: "all" as const,
    };

    expect(
      AccessLogQuerySchema.safeParse({
        ...query,
        from: new Date("2023-01-01T00:00:00Z"),
        to: new Date("2023-02-02T00:00:00Z"),
      }).success,
    ).toBe(false);
    expect(
      AccessLogQuerySchema.safeParse({
        ...query,
        from: new Date("2023-02-02T00:00:00Z"),
        to: new Date("2023-01-01T00:00:00Z"),
      }).success,
    ).toBe(false);
  });

  test("bounds direct hourly aggregation callers to the supported range", () => {
    expect(() =>
      aggregateAccessLogStats(
        "",
        new Date("2023-01-01T00:00:00Z"),
        new Date("2023-02-02T00:00:00Z"),
      ),
    ).toThrow("Choose a date range of 31 days or less.");
  });

  test("normalizes Caddy JSON entries", () => {
    const entries = parseAccessLogEntries(logs);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      method: "GET",
      status: 200,
      durationMs: 15,
      remoteIp: "203.0.113.10",
    });
  });

  test("filters, sorts, and paginates status groups", () => {
    const result = queryAccessLogEntries(logs, {
      from: new Date("2023-11-14T00:00:00Z"),
      to: new Date("2023-11-15T00:00:00Z"),
      page: 1,
      pageSize: 10,
      sortBy: "status",
      sortDirection: "desc",
      statusGroup: "5xx",
    });
    expect(result.total).toBe(1);
    expect(result.entries[0]?.status).toBe(500);
  });

  test("fills hourly chart gaps", () => {
    const stats = aggregateAccessLogStats(
      logs,
      new Date("2023-11-14T22:00:00Z"),
      new Date("2023-11-15T00:00:00Z"),
    );
    expect(stats).toHaveLength(3);
    expect(stats.reduce((sum, point) => sum + point.count, 0)).toBe(2);
  });

  test("builds the request page and hourly chart from one selected range", () => {
    const result = queryAccessLogDashboard(logs, {
      from: new Date("2023-11-14T22:00:00Z"),
      to: new Date("2023-11-15T00:00:00Z"),
      page: 1,
      pageSize: 10,
      sortBy: "timestamp",
      sortDirection: "desc",
      statusGroup: "2xx",
    });

    expect(result.total).toBe(1);
    expect(result.entries[0]?.status).toBe(200);
    expect(result.stats).toHaveLength(3);
    expect(result.stats.reduce((sum, point) => sum + point.count, 0)).toBe(2);
    expect(result.summary).toEqual({
      requestCount: 2,
      averageDurationMs: 107.5,
      totalBytes: 1264,
      errorRequestCount: 1,
      topRoutes: [
        {
          host: "app.example.com",
          path: "/",
          requestCount: 1,
          averageDurationMs: 15,
          totalBytes: 1200,
        },
        {
          host: "app.example.com",
          path: "/login",
          requestCount: 1,
          averageDurationMs: 200,
          totalBytes: 64,
        },
      ],
    });
  });

  test("resolves Caddy status 0 handled request to 200", () => {
    const sample = JSON.stringify({
      level: "info",
      ts: 1784762630.950613,
      logger: "http.log.access.log0",
      msg: "handled request",
      request: {
        remote_ip: "188.212.135.241",
        remote_port: "56061",
        client_ip: "188.212.135.241",
        proto: "HTTP/1.1",
        method: "GET",
        host: "codex-gh-app-07230009.65.109.183.214.nip.io",
        uri: "/",
      },
      duration: 10.124758993,
      size: 0,
      status: 0,
    });

    const entries = parseAccessLogEntries(sample);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      host: "codex-gh-app-07230009.65.109.183.214.nip.io",
      method: "GET",
      status: 200,
      remoteIp: "188.212.135.241",
      durationMs: 10124.76,
    });
  });
});
