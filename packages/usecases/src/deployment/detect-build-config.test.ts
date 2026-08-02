import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectApplicationBuildConfig } from "./detect-build-config";

describe("detectApplicationBuildConfig", () => {
  test("detects dockerfile configuration when Dockerfile is present", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "Dockerfile"), "FROM alpine\n");
      const config = detectApplicationBuildConfig(tmpDir);
      expect(config.type).toBe("dockerfile");
      expect(config.autoDetect).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("detects railpack configuration when package.json is present", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
      const config = detectApplicationBuildConfig(tmpDir);
      expect(config.type).toBe("railpack");
      expect(config.autoDetect).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("detects railpack configuration when go.mod is present", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "go.mod"), "module test");
      const config = detectApplicationBuildConfig(tmpDir);
      expect(config.type).toBe("railpack");
      expect(config.autoDetect).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("detects static site configuration when index.html is present alone", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "index.html"), "<h1>Hello</h1>");
      const config = detectApplicationBuildConfig(tmpDir);
      expect(config.type).toBe("static");
      expect(config.autoDetect).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("prioritizes Dockerfile over railpack markers if both exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "Dockerfile"), "FROM alpine\n");
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
      const config = detectApplicationBuildConfig(tmpDir);
      expect(config.type).toBe("dockerfile");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
