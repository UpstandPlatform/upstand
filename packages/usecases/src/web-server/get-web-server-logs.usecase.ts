import type { CaddyService } from "./caddy.service";

export class GetWebServerLogsUseCase {
  constructor(private readonly caddyService: CaddyService) {}

  async execute(tail?: number): Promise<string> {
    return this.caddyService.getLogs(tail);
  }
}
