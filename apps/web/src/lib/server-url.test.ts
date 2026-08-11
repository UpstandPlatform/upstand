import { afterEach, describe, expect, test } from "bun:test";
import { getDocsUrl, getServerApiUrl, getServerUrl } from "./server-url";

const originalWindow = globalThis.window;

function setBrowserLocation(url: string): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: new URL(url) },
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("runtime URL resolution", () => {
  test("routes the cloud dashboard to its API and docs subdomains", () => {
    setBrowserLocation("https://upstand.dev/");

    expect(getServerUrl()).toBe("https://api.upstand.dev");
    expect(getServerApiUrl("/api/setup/status")).toBe(
      "https://api.upstand.dev/api/setup/status",
    );
    expect(getDocsUrl()).toBe("https://docs.upstand.dev/docs/");
  });

  test("routes prefixed self-hosted dashboards to sibling services", () => {
    setBrowserLocation("https://dashboard.example.com/");

    expect(getServerUrl()).toBe("https://api.example.com");
    expect(getDocsUrl("/getting-started")).toBe(
      "https://docs.example.com/docs/getting-started",
    );
  });

  test("keeps desktop loopback services on their local ports", () => {
    setBrowserLocation("http://127.0.0.1:3001/");

    expect(getServerUrl()).toBe("http://127.0.0.1:3000");
    expect(getDocsUrl()).toBe("http://127.0.0.1:4000/docs/");
  });
});
