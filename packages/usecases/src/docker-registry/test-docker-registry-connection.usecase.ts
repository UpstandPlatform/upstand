import { assertPublicHttpUrl } from "@upstand/platform/network/outbound";
import { z } from "zod";

export const TestDockerRegistryConnectionInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  registryUrl: z.string().optional().nullable(),
});

export type TestDockerRegistryConnectionInput = z.infer<
  typeof TestDockerRegistryConnectionInputSchema
>;

export class TestDockerRegistryConnectionUseCase {
  async execute(
    input: TestDockerRegistryConnectionInput,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const validatedUrl = await assertPublicHttpUrl(
        input.registryUrl || "https://index.docker.io/v2/",
      );
      const response = await fetch(validatedUrl, {
        headers:
          input.username && input.password
            ? {
                Authorization: `Basic ${Buffer.from(
                  `${input.username}:${input.password}`,
                ).toString("base64")}`,
              }
            : {},
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 200 || response.status === 401) {
        return {
          success: true,
          message: `Successfully connected to Docker registry at ${validatedUrl}. Response status: ${response.status}`,
        };
      }
      throw new Error(`Registry returned status code ${response.status}`);
    } catch {
      return {
        success: false,
        message: "Failed to connect to Docker registry",
      };
    }
  }
}
