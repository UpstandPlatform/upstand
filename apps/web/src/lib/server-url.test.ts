import { afterEach, describe, expect, test } from "bun:test";
import {
  getDocsUrl,
  getServerApiUrl,
  getServerUrl,
  getServerUrlFromHeaders,
} from "./server-url";

const originalWindow = globalThis.window;

function setBrowserLocation(
  url: string,
  runtime?: { apiOrigin: string; docsOrigin?: string },
): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: new URL(url),
      upstandDesktop: runtime ? { runtime } : undefined,
    },
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

  test("uses the active desktop profile API origin for auth and API calls", () => {
    setBrowserLocation("https://upstand.dev/", {
      apiOrigin: "https://self-hosted.example.com",
    });

    expect(getServerApiUrl("/api/auth/get-session")).toBe(
      "https://self-hosted.example.com/api/auth/get-session",
    );
  });

  test("uses the active desktop profile documentation origin", () => {
    setBrowserLocation("http://127.0.0.1:3001/", {
      apiOrigin: "http://127.0.0.1:3000",
      docsOrigin: "https://docs.upstand.dev",
    });

    expect(getDocsUrl()).toBe("https://docs.upstand.dev/docs/");
  });

  test("keeps direct IP access on HTTP and maps the dashboard port to the API", () => {
    const headers = new Headers({ host: "85.155.230.19:3001" });

    expect(getServerUrlFromHeaders(headers, "https://upstand.dev")).toBe(
      "http://85.155.230.19:3000",
    );
  });

  test("resolves direct IP browser access to the local API port", () => {
    setBrowserLocation("http://85.155.230.19:3001/login?return_to=%2Fprojects");

    expect(getServerUrl("https://api.upstand.dev")).toBe(
      "http://85.155.230.19:3000",
    );
    expect(getServerApiUrl("/api/setup/status")).toBe(
      "http://85.155.230.19:3000/api/setup/status",
    );
  });

  test("resolves direct IP documentation to the local docs port", () => {
    setBrowserLocation("http://85.155.230.19:3001/");

    expect(getDocsUrl()).toBe("http://85.155.230.19:4000/docs/");
  });
});
