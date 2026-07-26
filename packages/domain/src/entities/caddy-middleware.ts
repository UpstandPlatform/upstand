import { z } from "zod";

const CADDY_MIDDLEWARE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const CaddyMiddlewareSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(CADDY_MIDDLEWARE_NAME, "Middleware name is invalid"),
  body: z
    .string()
    .trim()
    .min(1, "Middleware configuration is required")
    .max(50_000),
});

export const CaddyMiddlewareListSchema = z
  .array(CaddyMiddlewareSchema)
  .max(100)
  .superRefine((middlewares, ctx) => {
    const names = new Set<string>();
    for (const [index, middleware] of middlewares.entries()) {
      if (names.has(middleware.name)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "name"],
          message: "Middleware names must be unique",
        });
      }
      names.add(middleware.name);
    }
  });

export type CaddyMiddleware = z.infer<typeof CaddyMiddlewareSchema>;

export function parseCaddyMiddlewares(
  value?: string | null,
): CaddyMiddleware[] {
  if (!value) return [];
  try {
    const parsed = CaddyMiddlewareListSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function serializeCaddyMiddlewares(value: CaddyMiddleware[]): string {
  return JSON.stringify(CaddyMiddlewareListSchema.parse(value));
}
