import { afterEach, describe, expect, test } from "bun:test";
import {
  persistActiveOrganizationId,
  readPersistedActiveOrganizationId,
  selectInitialOrganization,
} from "./organization-bootstrap";

const organizations = [
  { id: "personal", name: "Personal", metadata: { isPersonal: true } },
  { id: "team", name: "Team" },
] as const;

describe("organization bootstrap", () => {
  test("restores a valid persisted organization before the personal default", () => {
    expect(selectInitialOrganization(organizations, "team")?.id).toBe("team");
    expect(selectInitialOrganization(organizations, "missing")?.id).toBe(
      "personal",
    );
  });

  test("falls back to the first organization when no personal workspace exists", () => {
    expect(selectInitialOrganization([{ id: "team", name: "Team" }])?.id).toBe(
      "team",
    );
  });

  test("persists organization preferences per user when storage is available", () => {
    const originalWindow = globalThis.window;
    const values = new Map<string, string>();
    globalThis.window = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    } as unknown as Window & typeof globalThis;

    persistActiveOrganizationId("user-1", "team");
    expect(readPersistedActiveOrganizationId("user-1")).toBe("team");
    expect(readPersistedActiveOrganizationId("user-2")).toBeNull();

    globalThis.window = originalWindow;
  });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});
