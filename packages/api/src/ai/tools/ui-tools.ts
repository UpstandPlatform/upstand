import type { z } from "zod";
import type { UpGalPageContext } from "../upgal-page-context";
import {
  resolveUpGalTargetId,
  UPGAL_UI_TARGET_ALIASES,
  UPGAL_UI_TARGETS,
  type UpGalUiTargetDefinition,
} from "../upgal-ui-targets";
import {
  type UpGalExecutableTool,
  type UpGalToolFactoryContext,
  upGalReadTool,
} from "./factory";
import type { UpGalUIActionPlan, UpGalUiStep } from "./ui-schemas";
import { guideUpstandSchema, upGalUiActionPlanSchema } from "./ui-schemas";

export type { UpGalUIActionPlan, UpGalUiStep } from "./ui-schemas";
export {
  guideUpstandSchema,
  upGalUiActionPlanSchema,
  upGalUiStepSchema,
} from "./ui-schemas";
export type UpGalUiTools = {
  guide_upstand: UpGalExecutableTool<
    z.infer<typeof guideUpstandSchema>,
    UpGalUIActionPlan
  >;
};

function normalizedPath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function targetCatalog(page?: UpGalPageContext) {
  const targets = new Map<
    string,
    Pick<UpGalUiTargetDefinition, "label" | "kind"> & { path?: string }
  >(UPGAL_UI_TARGETS.map((target) => [target.id, target]));
  for (const target of page?.uiTargets ?? []) {
    const registered = targets.get(target.id);
    targets.set(target.id, {
      ...registered,
      ...target,
      ...(target.path || registered?.path
        ? { path: target.path ?? registered?.path }
        : {}),
    });
  }
  for (const [alias, canonicalId] of Object.entries(UPGAL_UI_TARGET_ALIASES)) {
    const target = targets.get(resolveUpGalTargetId(canonicalId));
    if (target) targets.set(alias, target);
  }
  return targets;
}

export function normalizeUpGalUiSteps(
  steps: readonly UpGalUiStep[],
  page?: UpGalPageContext,
): UpGalUiStep[] {
  const targets = targetCatalog(page);
  let currentPath = normalizedPath(page?.path ?? "/");
  const normalized: UpGalUiStep[] = [];

  for (const step of steps) {
    if (step.type === "navigate") {
      normalized.push(step);
      currentPath = normalizedPath(step.path);
      continue;
    }

    const target = targets.get(step.target);
    const targetPath = target?.path;
    const requiresNavigation =
      target?.kind !== "navigation" &&
      targetPath &&
      normalizedPath(targetPath) !== currentPath;

    if (requiresNavigation) {
      const previous = normalized.at(-1);
      const alreadyNavigates =
        previous?.type === "navigate" &&
        normalizedPath(previous.path) === normalizedPath(targetPath);
      if (!alreadyNavigates && normalized.length < 8) {
        normalized.push({
          type: "navigate",
          path: targetPath,
          description: `Open ${target.label} on ${targetPath} before continuing.`,
        });
      }
      currentPath = normalizedPath(targetPath);
    }

    normalized.push(step);
  }

  return normalized;
}

export function createUpGalUiTools(
  context: UpGalToolFactoryContext,
): UpGalUiTools {
  return {
    guide_upstand: upGalReadTool(
      "Return one bounded, ordered UI walkthrough. Use the route-aware target catalog from the page context. Insert one navigate step before a dialog or field target that belongs to another page. Use spotlight for a visible target, focus for an input, and open_dialog only for a registered safe target. Never include submit or destructive clicks.",
      guideUpstandSchema,
      upGalUiActionPlanSchema,
      async (input) => ({
        kind: "ui_action_plan" as const,
        steps: normalizeUpGalUiSteps(input.steps, context.page),
      }),
    ),
  };
}
