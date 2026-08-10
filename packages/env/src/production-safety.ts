export type ProductionOriginSafetyInput = {
  nodeEnv: string;
  allowInsecureBootstrap: boolean;
  platform?: "desktop" | "self-hosted" | "cloud";
  betterAuthUrl?: string;
  corsOrigin?: string;
};

export function assertSecureProductionOrigins(
  input: ProductionOriginSafetyInput,
): void {
  if (input.nodeEnv !== "production" || input.allowInsecureBootstrap) return;

  for (const [name, value] of [
    ["BETTER_AUTH_URL", input.betterAuthUrl],
    ["CORS_ORIGIN", input.corsOrigin],
  ] as const) {
    if (!value) {
      throw new Error(`${name} is required for production authentication`);
    }
    const url = new URL(value);
    const desktopLoopback =
      input.platform === "desktop" &&
      url.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !desktopLoopback) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        `${name} must use an HTTPS origin without embedded credentials in production`,
      );
    }
  }
}
