import { describe, expect, test } from "bun:test";
import yaml from "yaml";
import {
  getNativeTemplate,
  listNativeTemplates,
  NATIVE_TEMPLATE_COUNT,
} from "./native-catalog";

describe("native template catalog", () => {
  test("ships the complete imported catalog in the application", () => {
    expect(NATIVE_TEMPLATE_COUNT).toBeGreaterThan(300);
    expect(
      listNativeTemplates("ackee").map((template) => template.id),
    ).toContain("ackee");
    expect(
      listNativeTemplates("adminer").map((template) => template.id),
    ).toContain("adminer");
    expect(
      listNativeTemplates("alist").map((template) => template.id),
    ).toContain("alist");
    expect(
      listNativeTemplates("authorizer").map((template) => template.id),
    ).toContain("authorizer");
    expect(
      listNativeTemplates("zipline").map((template) => template.id),
    ).toContain("zipline");
  });

  test("renders a native blueprint as valid Compose with isolated relative mounts", () => {
    const template = getNativeTemplate("zipline");
    const document = yaml.parse(template.composeFile) as Record<
      string,
      unknown
    >;
    expect(document.services).toBeTruthy();
    expect(template.source).toBe("builtin");
    expect(template.composeFile).not.toContain("../files");
  });

  test("exposes repository logo and GitHub metadata for catalog cards", () => {
    const template = getNativeTemplate("ackee");
    expect(template.logoUrl).toBe(
      "https://raw.githubusercontent.com/Dokploy/templates/canary/blueprints/ackee/logo.png",
    );
    expect(template.links.github).toContain("github.com");
  });
});
