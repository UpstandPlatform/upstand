import { describe, expect, test } from "bun:test";
import { monitoringAlertSchema } from "./monitoring";

const validAlert = {
  json: {
    serverId: "server-1",
    serverType: "Upstand",
    type: "CPU",
    value: 91.5,
    threshold: 90,
    message: "CPU threshold exceeded",
    timestamp: "2026-08-01T12:00:00.000Z",
    nonce: "nonce-1",
    signature: "a".repeat(64),
  },
};

describe("monitoring alert payload validation", () => {
  test("accepts a signed threshold alert payload", () => {
    expect(monitoringAlertSchema.safeParse(validAlert).success).toBe(true);
  });

  test("rejects malformed or unbounded alert values", () => {
    expect(
      monitoringAlertSchema.safeParse({
        ...validAlert,
        json: { ...validAlert.json, value: Number.POSITIVE_INFINITY },
      }).success,
    ).toBe(false);
    expect(
      monitoringAlertSchema.safeParse({
        ...validAlert,
        json: { ...validAlert.json, signature: "not-a-signature" },
      }).success,
    ).toBe(false);
    expect(
      monitoringAlertSchema.safeParse({
        ...validAlert,
        json: { ...validAlert.json, message: "x".repeat(1_025) },
      }).success,
    ).toBe(false);
  });
});
