import { describe, expect, test } from "bun:test";
import {
  guideUpstandSchema,
  normalizeUpGalUiSteps,
  upGalUiStepSchema,
} from "./ui-tools";

describe("UpGal UI action schemas", () => {
  test("accepts a generic multi-step walkthrough", () => {
    const plan = guideUpstandSchema.parse({
      steps: [
        {
          type: "navigate",
          path: "/projects",
          description: "Open the Projects page.",
        },
        {
          type: "spotlight",
          target: "create-project",
          description: "Select New Project.",
        },
        {
          type: "focus",
          target: "project-name",
          description: "Enter the project name.",
        },
      ],
    });

    expect(plan.steps).toHaveLength(3);
  });

  test("rejects external navigation and arbitrary selectors", () => {
    expect(() =>
      upGalUiStepSchema.parse({
        type: "navigate",
        path: "https://example.com",
        description: "Leave Upstand.",
      }),
    ).toThrow();
    expect(() =>
      upGalUiStepSchema.parse({
        type: "spotlight",
        target: "button[data-secret]",
        description: "Inspect a control.",
      }),
    ).toThrow();
  });

  test("bounds a plan and requires descriptions", () => {
    expect(() => guideUpstandSchema.parse({ steps: [] })).toThrow();
    expect(() =>
      guideUpstandSchema.parse({
        steps: Array.from({ length: 9 }, (_, index) => ({
          type: "spotlight",
          target: `target-${index}`,
          description: "Target",
        })),
      }),
    ).toThrow();
  });

  test("adds one route transition before an off-page dialog walkthrough", () => {
    const plan = guideUpstandSchema.parse({
      steps: [
        {
          type: "open_dialog",
          target: "create-ssh-key",
          description: "Open the SSH key creation dialog.",
        },
        {
          type: "focus",
          target: "ssh-key-public-key",
          description: "Focus on the public key field.",
        },
      ],
    });

    const normalized = normalizeUpGalUiSteps(plan.steps, {
      path: "/projects",
    });

    expect(normalized).toEqual([
      {
        type: "navigate",
        path: "/ssh-keys",
        description: "Open Add SSH Key button on /ssh-keys before continuing.",
      },
      ...plan.steps,
    ]);
  });

  test("resolves legacy SSH field references from the global catalog", () => {
    const normalized = normalizeUpGalUiSteps(
      [
        {
          type: "focus",
          target: "public-key-input",
          description: "Focus on the public key field.",
        },
      ],
      { path: "/projects" },
    );

    expect(normalized[0]).toEqual({
      type: "navigate",
      path: "/ssh-keys",
      description: "Open SSH public key field on /ssh-keys before continuing.",
    });
  });

  test("does not navigate for a sidebar target that is available everywhere", () => {
    const normalized = normalizeUpGalUiSteps(
      [
        {
          type: "spotlight",
          target: "navigation-ssh-keys",
          description: "Point to SSH Keys in the sidebar.",
        },
      ],
      { path: "/projects" },
    );

    expect(normalized).toHaveLength(1);
  });
});
