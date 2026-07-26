import { assertSafeSshTarget } from "@upstand/platform/network/outbound";
import { scanHostKey } from "@upstand/platform/ssh/host-key";
import { isSafeSshHost } from "@upstand/platform/ssh/validate";
import { z } from "zod";

export const ScanServerHostKeyInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  ipAddress: z
    .string()
    .trim()
    .min(1, "IP address is required")
    .refine(isSafeSshHost, "Host contains unsupported characters"),
  port: z.number().int().min(1).max(65_535).default(22),
});

export type ScanServerHostKeyInput = z.infer<
  typeof ScanServerHostKeyInputSchema
>;

export class ScanServerHostKeyUseCase {
  async execute(
    input: ScanServerHostKeyInput,
  ): Promise<{ fingerprint: string; algorithm: string }> {
    try {
      const target = await assertSafeSshTarget(input.ipAddress);
      const { fingerprint, algorithm } = await scanHostKey(target, input.port);
      return { fingerprint, algorithm };
    } catch {
      throw new Error("Failed to scan SSH host key");
    }
  }
}
