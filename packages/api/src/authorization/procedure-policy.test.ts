import { describe, expect, test } from "bun:test";
import { appRouter } from "../routers/index";
import {
  API_KEY_ROUTE_CAPABILITIES,
  authorizationCoverageGaps,
  PUBLIC_PROCEDURES,
  SESSION_ONLY_PROCEDURES,
  staleAuthorizationDeclarations,
  staleSessionOnlyDeclarations,
} from "./procedure-policy";

describe("procedure authorization coverage", () => {
  const procedurePaths = Object.keys(appRouter._def.procedures).sort();

  test("declares every procedure as API-key capable or session-only", () => {
    expect(authorizationCoverageGaps(procedurePaths)).toEqual([]);
  });

  test("does not retain policy entries for removed procedures", () => {
    expect(staleAuthorizationDeclarations(procedurePaths)).toEqual([]);
    expect(staleSessionOnlyDeclarations(procedurePaths)).toEqual([]);
  });

  test("keeps API-key capabilities valid and session-only declarations unique", () => {
    const sessionOnly = new Set<string>(SESSION_ONLY_PROCEDURES);
    const publicProcedures = new Set<string>(PUBLIC_PROCEDURES);
    expect(
      Object.keys(API_KEY_ROUTE_CAPABILITIES).some((path) =>
        sessionOnly.has(path),
      ),
    ).toBe(false);
    expect(PUBLIC_PROCEDURES.some((path) => sessionOnly.has(path))).toBe(false);
    expect(
      PUBLIC_PROCEDURES.some((path) =>
        Object.hasOwn(API_KEY_ROUTE_CAPABILITIES, path),
      ),
    ).toBe(false);
    expect(publicProcedures.size).toBe(PUBLIC_PROCEDURES.length);
  });
});
