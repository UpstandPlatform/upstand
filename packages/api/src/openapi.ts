import {
  generateOpenApiDocument,
  type OpenAPIObject,
  type OpenApiRouter,
} from "trpc-to-openapi";
import { z } from "zod";
import type { Context } from "./context";
import { t } from "./index";
import { appRouter } from "./routers/index";

type ProcedureLike = {
  _def: {
    type: "query" | "mutation" | "subscription";
    inputs: MergableZodObject[];
    output?: z.ZodTypeAny;
  };
};

type MergableZodObject = z.ZodTypeAny & {
  merge(input: z.ZodTypeAny): z.ZodTypeAny;
};

interface CallerRecord {
  [key: string]: CallerNode;
}

type CallerNode = ((input?: unknown) => unknown) | CallerRecord;

type OpenApiResolverInput = {
  ctx: Context;
  input: unknown;
};

const emptyInput = z.object({}) as MergableZodObject;
const fallbackOutput = z.unknown();

function getInputParser(procedure: ProcedureLike) {
  if (procedure._def.inputs.length === 0) return emptyInput;

  return procedure._def.inputs.reduce<z.ZodTypeAny>(
    (merged, input) => (merged as MergableZodObject).merge(input),
    emptyInput,
  );
}

function createOpenApiRouter() {
  const procedures = Object.entries(
    appRouter._def.procedures as unknown as Record<string, ProcedureLike>,
  );
  const openApiProcedures = Object.fromEntries(
    procedures
      .filter(([, procedure]) => procedure._def.type !== "subscription")
      .map(([procedurePath, procedure]) => {
        const definition = procedure as ProcedureLike;
        const method = definition._def.type === "query" ? "GET" : "POST";
        const hasInput = definition._def.inputs.length > 0;
        const input = getInputParser(definition);
        const output = definition._def.output ?? fallbackOutput;
        const path = `/${procedurePath.replaceAll(".", "/")}` as `/${string}`;

        const openApiProcedure = t.procedure
          .input(input)
          .output(output)
          .meta({
            openapi: {
              method,
              path,
              operationId: procedurePath.replaceAll(".", "-"),
              summary: procedurePath,
              description: `REST representation of the ${procedurePath} tRPC procedure.`,
              protect: procedurePath !== "healthCheck",
              tags: [procedurePath.split(".")[0] ?? "api"],
            },
          });

        const resolver = async ({
          ctx,
          input: parsedInput,
        }: OpenApiResolverInput) => {
          const caller = appRouter.createCaller(ctx);
          let target: CallerNode = caller as unknown as CallerNode;
          for (const segment of procedurePath.split(".")) {
            if (typeof target === "function") {
              throw new Error(
                `Unable to resolve ${procedurePath} in appRouter`,
              );
            }
            const next = target[segment];
            if (!next) {
              throw new Error(
                `Unable to resolve ${procedurePath} in appRouter`,
              );
            }
            target = next;
          }

          if (typeof target !== "function") {
            throw new Error(`Unable to resolve ${procedurePath} in appRouter`);
          }

          return hasInput ? target(parsedInput) : target();
        };

        return [
          procedurePath,
          definition._def.type === "query"
            ? openApiProcedure.query(resolver)
            : openApiProcedure.mutation(resolver),
        ];
      }),
  );

  type DynamicRouterDefinition = Parameters<typeof t.router>[0];
  return t.router(
    openApiProcedures as unknown as DynamicRouterDefinition,
  ) as OpenApiRouter;
}

/**
 * REST compatibility router generated from the canonical tRPC router.
 * Business logic continues to run through appRouter.createCaller, so auth,
 * authorization, rate limiting, and auditing remain centralized.
 */
export const openApiRouter = createOpenApiRouter();

export function createOpenApiDocument(baseUrl: string): OpenAPIObject {
  return generateOpenApiDocument(openApiRouter, {
    title: "Upstand API",
    description: "REST API generated from the Upstand tRPC router.",
    version: "0.1.45",
    baseUrl: baseUrl.replace(/\/$/, ""),
    securitySchemes: {
      Authorization: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "session or API token",
      },
      ApiKey: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },
  });
}
