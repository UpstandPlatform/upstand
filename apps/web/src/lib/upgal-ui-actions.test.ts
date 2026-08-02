import { afterEach, describe, expect, test } from "bun:test";
import { consumeUpGalAction } from "./upgal-ui-actions";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("UpGal UI action replay guard", () => {
  test("bounds consumed action memory for long-lived tabs", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        sessionStorage: {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
        },
      },
    });

    for (let index = 0; index < 2048; index += 1) {
      expect(consumeUpGalAction(`bounded-action-${index}`)).toBe(true);
    }
    expect(consumeUpGalAction("bounded-action-0")).toBe(false);
    expect(consumeUpGalAction("bounded-action-2048")).toBe(true);
    expect(consumeUpGalAction("bounded-action-0")).toBe(true);
  });
});
