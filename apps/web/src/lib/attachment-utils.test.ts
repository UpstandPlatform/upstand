// @ts-nocheck
import { describe, expect, it } from "bun:test";
import {
  inferMediaType,
  matchesAcceptPattern,
  UPGAL_ACCEPT_PATTERNS,
} from "./attachment-utils";

describe("attachment-utils", () => {
  describe("inferMediaType", () => {
    it("preserves non-empty reported type", () => {
      expect(inferMediaType("doc.txt", "text/plain")).toBe("text/plain");
      expect(inferMediaType("image.png", "image/png")).toBe("image/png");
    });

    it("infers MIME type from file extension when reported type is empty", () => {
      expect(inferMediaType("notes.md", "")).toBe("text/markdown");
      expect(inferMediaType("config.json", "")).toBe("application/json");
      expect(inferMediaType("app.log", "")).toBe("text/plain");
      expect(inferMediaType("script.yaml", "")).toBe("text/yaml");
    });

    it("returns default octet-stream for unknown extensions", () => {
      expect(inferMediaType("binary.xyz", "")).toBe("application/octet-stream");
    });
  });

  describe("matchesAcceptPattern", () => {
    it("accepts any file when pattern is empty or undefined", () => {
      expect(matchesAcceptPattern({ name: "notes.md", type: "" })).toBe(true);
      expect(matchesAcceptPattern({ name: "notes.md", type: "" }, "")).toBe(
        true,
      );
    });

    it("matches file extensions", () => {
      expect(matchesAcceptPattern({ name: "README.md", type: "" }, ".md")).toBe(
        true,
      );
      expect(
        matchesAcceptPattern({ name: "notes.txt", type: "" }, ".md,.txt"),
      ).toBe(true);
      expect(
        matchesAcceptPattern({ name: "image.png", type: "image/png" }, ".md"),
      ).toBe(false);
    });

    it("matches MIME types and wildcard MIME types", () => {
      expect(
        matchesAcceptPattern(
          { name: "notes.md", type: "text/markdown" },
          "text/markdown",
        ),
      ).toBe(true);
      expect(
        matchesAcceptPattern({ name: "notes.md", type: "" }, "text/*"),
      ).toBe(true);
      expect(
        matchesAcceptPattern(
          { name: "data.json", type: "application/json" },
          "application/json",
        ),
      ).toBe(true);
    });

    it("matches files using UPGAL_ACCEPT_PATTERNS", () => {
      expect(
        matchesAcceptPattern(
          { name: "notes.md", type: "" },
          UPGAL_ACCEPT_PATTERNS,
        ),
      ).toBe(true);
      expect(
        matchesAcceptPattern(
          { name: "server.log", type: "" },
          UPGAL_ACCEPT_PATTERNS,
        ),
      ).toBe(true);
      expect(
        matchesAcceptPattern(
          { name: "config.yaml", type: "" },
          UPGAL_ACCEPT_PATTERNS,
        ),
      ).toBe(true);
      expect(
        matchesAcceptPattern(
          { name: "data.json", type: "" },
          UPGAL_ACCEPT_PATTERNS,
        ),
      ).toBe(true);
    });
  });
});
