export type ProductionOriginSafetyInput = {
  nodeEnv: string;
  allowInsecureBootstrap: boolean;
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
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error(
        `${name} must use an HTTPS origin without embedded credentials in production`,
      );
    }
  }
}
