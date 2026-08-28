import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getRailpackArtifact,
  getRailpackTarget,
  verifyRailpackArchive,
  verifyRailpackBinary,
} from "./railpack-release";

describe("Railpack release integrity", () => {
  test("maps only supported runtime architectures", () => {
    expect(getRailpackTarget("x64")).toBe("x86_64-unknown-linux-musl");
    expect(getRailpackTarget("arm64")).toBe("arm64-unknown-linux-musl");
    expect(() => getRailpackTarget("ia32")).toThrow("does not support");
  });

  test("requires a checked-in integrity record for the selected release", () => {
    const artifact = getRailpackArtifact("0.15.4", "x86_64-unknown-linux-musl");
    expect(artifact.archiveSha256).toBe(
      "459d86f5a9d8698bee8c7be4f224a305f51158fe5f44eb528255dfd568e4eaf1",
    );
    expect(() =>
      getRailpackArtifact("0.15.5", "x86_64-unknown-linux-musl"),
    ).toThrow("no checked-in integrity record");
  });

  test("covers every version offered by the resource build selector", () => {
    for (const version of [
      "0.15.4",
      "0.16.0",
      "0.17.0",
      "0.18.0",
      "0.19.0",
      "0.20.0",
      "0.21.0",
      "0.22.0",
      "0.23.0",
    ]) {
      for (const target of [
        "arm64-unknown-linux-musl",
        "x86_64-unknown-linux-musl",
      ]) {
        const artifact = getRailpackArtifact(version, target);
        expect(artifact.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(artifact.binarySha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  test("rejects a modified archive and cached executable", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "upstand-railpack-integrity-"),
    );
    const archivePath = path.join(directory, "railpack.tar.gz");
    const binaryPath = path.join(directory, "railpack");
    fs.writeFileSync(archivePath, "untrusted archive");
    fs.writeFileSync(binaryPath, "untrusted binary");
    try {
      expect(() => verifyRailpackArchive(archivePath, "0".repeat(64))).toThrow(
        "archive integrity check failed",
      );
      expect(() => verifyRailpackBinary(binaryPath, "0".repeat(64))).toThrow(
        "cached binary integrity check failed",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
