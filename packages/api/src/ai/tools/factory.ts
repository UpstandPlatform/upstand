import type { ServiceScope, TokenLike } from "@circulo-ai/di";
import { toJsonValue } from "@upstand/domain";
import type { FlexibleSchema, Tool, ToolExecutionOptions } from "ai";
import { z } from "zod";
import type { UpGalPageContext } from "../upgal-page-context";

export type UpGalToolContext = { organizationId: string };
export type UpGalToolFactoryContext = {
  organizationId: string;
  scope: ServiceScope;
  page?: UpGalPageContext;
};

export const upGalToolContextSchema = z.object({
  organizationId: z.string().min(1),
});

export type UpGalExecutableTool<Input, Output> = Tool<
  Input,
  Output,
  UpGalToolContext
> & {
  execute: (
    input: Input,
    options: ToolExecutionOptions<UpGalToolContext>,
  ) => Promise<Output>;
};

export function resolveUpGalTool<T>(
  context: UpGalToolFactoryContext,
  token: TokenLike<T>,
): T {
  return context.scope.resolve(token);
}

export function upGalReadTool<TInput, TOutput>(
  description: string,
  inputSchema: FlexibleSchema<TInput>,
  outputSchema: FlexibleSchema<TOutput>,
  execute: (input: TInput) => Promise<TOutput>,
): UpGalExecutableTool<TInput, TOutput> {
  return {
    type: "function",
    description,
    inputSchema,
    outputSchema,
    contextSchema: upGalToolContextSchema,
    execute: async (
      input: TInput,
      _options: ToolExecutionOptions<UpGalToolContext>,
    ) => toJsonValue(await execute(input)) as TOutput,
  };
}

export function readTool<TInput, TOutput>(
  description: string,
  inputSchema: FlexibleSchema<TInput>,
  execute: (input: TInput) => Promise<TOutput>,
  outputSchema: FlexibleSchema<TOutput>,
): UpGalExecutableTool<TInput, TOutput> {
  return upGalReadTool(description, inputSchema, outputSchema, execute);
}

export function upGalMutationTool<TInput, TOutput>(
  description: string,
  inputSchema: FlexibleSchema<TInput>,
  outputSchema: FlexibleSchema<TOutput>,
  execute: (input: TInput) => Promise<TOutput>,
): UpGalExecutableTool<TInput, TOutput> {
  return upGalReadTool(description, inputSchema, outputSchema, execute);
}

export function mutationTool<TInput, TOutput>(
  description: string,
  inputSchema: FlexibleSchema<TInput>,
  execute: (input: TInput) => Promise<TOutput>,
  outputSchema: FlexibleSchema<TOutput>,
): UpGalExecutableTool<TInput, TOutput> {
  return upGalMutationTool(description, inputSchema, outputSchema, execute);
}
