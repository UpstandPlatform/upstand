import { z } from "zod";

export const webSearchSchema = z.object({
  query: z.string().trim().min(2).max(240),
  limit: z.number().int().min(1).max(10).default(5),
});

export const webSearchOutputSchema = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      description: z.string(),
      age: z.string().optional(),
    }),
  ),
  searchedAt: z.string(),
});
