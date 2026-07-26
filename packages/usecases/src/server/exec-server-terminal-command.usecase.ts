import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import type { DockerExecPort } from "../ports/docker";
import { resolveDockerInspectionTarget } from "./docker-inspection-target.helper";

export const ExecServerTerminalCommandInputSchema = z.object({
  organizationId: z.string().min(1),
  serverId: z.string().min(1).optional(),
  command: z.string().min(1),
});

export class ExecServerTerminalCommandUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly docker: DockerExecPort,
  ) {}

  async execute(input: z.infer<typeof ExecServerTerminalCommandInputSchema>) {
    const target = await resolveDockerInspectionTarget(this.uow, input, {
      localName: "Local Server",
    });
    return this.docker.execServerTerminalCommand(target, input.command);
  }
}
