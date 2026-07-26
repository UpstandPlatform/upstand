import { describe, expect, test } from "bun:test";
import {
  containerBelongsToResource,
  matchesContainerIdentifier,
} from "./container-ownership";

const application = {
  id: "res-uuid-1",
  type: "application" as const,
  composeType: null,
  appName: "Checkout API",
  name: "Checkout API",
};

describe("resource terminal container ownership", () => {
  // ------------------------------------------------------------------
  // Label-based authorization (canonical path)
  // ------------------------------------------------------------------
  test("authorizes via upstand.resource.id label (exact match only)", () => {
    // exact match → authorized
    expect(
      containerBelongsToResource(
        { id: "abcdef123456", labels: ["upstand.resource.id=res-uuid-1"] },
        application,
      ),
    ).toBe(true);

    // different resource id → denied even if service label matches
    expect(
      containerBelongsToResource(
        {
          id: "abcdef123456",
          labels: [
            "upstand.resource.id=res-uuid-OTHER",
            "com.docker.swarm.service.name=checkout-api",
          ],
        },
        application,
      ),
    ).toBe(false);
  });

  test("requires the requested container to carry the resource service label", () => {
    expect(
      containerBelongsToResource(
        {
          id: "abcdef123456",
          labels: ["com.docker.swarm.service.name=checkout-api"],
        },
        application,
      ),
    ).toBe(true);
    expect(
      containerBelongsToResource(
        {
          id: "abcdef123456",
          labels: ["com.docker.swarm.service.name=other-service"],
        },
        application,
      ),
    ).toBe(false);
  });

  test("accepts Swarm task replica name pattern <service>.<slot>", () => {
    expect(
      containerBelongsToResource(
        {
          id: "abcdef123456",
          labels: ["com.docker.swarm.service.name=checkout-api.1"],
        },
        application,
      ),
    ).toBe(true);
  });

  test("uses the correct namespace label for Compose and Swarm stacks", () => {
    expect(
      containerBelongsToResource(
        {
          id: "compose-123",
          labels: ["com.docker.compose.project=checkout-api"],
        },
        { ...application, type: "compose", composeType: "compose" },
      ),
    ).toBe(true);
    expect(
      containerBelongsToResource(
        {
          id: "stack-123",
          labels: ["com.docker.stack.namespace=checkout-api"],
        },
        { ...application, type: "compose", composeType: "stack" },
      ),
    ).toBe(true);
  });

  // ------------------------------------------------------------------
  // Security boundary: substring matching MUST be rejected
  // ------------------------------------------------------------------
  test("rejects a container whose service name only contains the resource name as a substring", () => {
    // "api" is a substring of "checkout-api" — must be denied
    const shortResource = { ...application, appName: "api", name: "api" };
    expect(
      containerBelongsToResource(
        {
          id: "abcdef123456",
          labels: ["com.docker.swarm.service.name=checkout-api"],
        },
        shortResource,
      ),
    ).toBe(false);
  });

  test("rejects a compose service whose name only contains the resource name as substring", () => {
    const shortResource = { ...application, appName: "app", name: "app" };
    expect(
      containerBelongsToResource(
        {
          id: "abcdef123456",
          labels: ["com.docker.compose.service=my-evil-app"],
        },
        shortResource,
      ),
    ).toBe(false);
  });

  test("rejects containers whose name only partially matches resource name", () => {
    expect(
      containerBelongsToResource(
        {
          id: "abcdef123456",
          name: "my-evil-checkout-api",
        },
        application,
      ),
    ).toBe(false);
  });

  test("accepts container name with Docker replica suffix (_1 or -1)", () => {
    expect(
      containerBelongsToResource(
        { id: "abc123", name: "checkout-api_1" },
        application,
      ),
    ).toBe(true);

    expect(
      containerBelongsToResource(
        { id: "abc123", name: "checkout-api-1" },
        application,
      ),
    ).toBe(true);
  });

  // ------------------------------------------------------------------
  // Container ID validation
  // ------------------------------------------------------------------
  test("rejects containers with invalid ID format", () => {
    expect(
      containerBelongsToResource(
        {
          id: "INVALID ID WITH SPACES",
          labels: ["com.docker.swarm.service.name=checkout-api"],
        },
        application,
      ),
    ).toBe(false);
  });

  test("supports Docker's abbreviated ids without accepting an unrelated id", () => {
    expect(matchesContainerIdentifier("abcdef", "abcdef123456")).toBe(true);
    expect(matchesContainerIdentifier("abcdef123456", "abcdef")).toBe(true);
    expect(matchesContainerIdentifier("fedcba", "abcdef123456")).toBe(false);
  });
});
