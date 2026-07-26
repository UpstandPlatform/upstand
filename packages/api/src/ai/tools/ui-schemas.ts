import { z } from "zod";

export const uiTargetIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,119}$/);

export const internalPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^\/[a-zA-Z0-9_./-]*(?:\?[a-zA-Z0-9_./=&%-]*)?$/);

const descriptionSchema = z.string().trim().min(1).max(400);

export const upGalUiStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("navigate"),
    path: internalPathSchema,
    description: descriptionSchema,
  }),
  z.object({
    type: z.literal("spotlight"),
    target: uiTargetIdSchema,
    description: descriptionSchema,
  }),
  z.object({
    type: z.literal("focus"),
    target: uiTargetIdSchema,
    description: descriptionSchema,
  }),
  z.object({
    type: z.literal("open_dialog"),
    target: uiTargetIdSchema,
    description: descriptionSchema,
  }),
]);

export const guideUpstandSchema = z.object({
  steps: z.array(upGalUiStepSchema).min(1).max(8),
});

export const upGalUiActionPlanSchema = z.object({
  kind: z.literal("ui_action_plan"),
  steps: z.array(upGalUiStepSchema).min(1).max(8),
});

export type UpGalUiStep = z.infer<typeof upGalUiStepSchema>;
export type UpGalUIActionPlan = z.infer<typeof upGalUiActionPlanSchema>;
