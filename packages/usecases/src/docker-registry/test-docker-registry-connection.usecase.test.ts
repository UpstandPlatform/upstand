import { afterEach, describe, expect, mock, test } from "bun:test";
import { TestDockerRegistryConnectionUseCase } from "./test-docker-registry-connection.usecase";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Docker registry connection validation", () => {
  test("does not fetch loopback registry URLs", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await new TestDockerRegistryConnectionUseCase().execute({
      organizationId: "org-1",
      registryUrl: "http://127.0.0.1:2375",
      username: null,
      password: null,
    });

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
