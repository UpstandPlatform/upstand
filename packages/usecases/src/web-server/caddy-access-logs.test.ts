import { describe, expect, test } from "bun:test";
import {
  aggregateAccessLogStats,
  parseAccessLogEntries,
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
      uri: "/login",
      client_ip: "203.0.113.11",
      proto: "HTTP/2.0",
    },
    status: 500,
    duration: 0.2,
    size: 64,
  }),
].join("\n");

describe("Caddy access log parsing", () => {
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
