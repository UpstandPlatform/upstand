import type { CaddyService } from "./caddy.service";

export class ReloadWebServerUseCase {
  constructor(private readonly caddyService: CaddyService) {}

  async execute(
    action: "reload" | "restart",
  ): Promise<{ success: boolean; error?: string }> {
    if (action === "restart") {
      return this.caddyService.restartCaddy();
    }
    return this.caddyService.reloadCaddy();
  }
}
