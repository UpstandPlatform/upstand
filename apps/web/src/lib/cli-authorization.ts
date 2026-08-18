export const CLI_DEVICE_CLIENT_ID = "upstand-cli" as const;

export function cliAuthorizationPath(userCode: string): string {
  return `/login?cli=${CLI_DEVICE_CLIENT_ID}&user_code=${encodeURIComponent(userCode)}`;
}

export function cliUserCodeFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
): string | null {
  if (searchParams.get("cli") !== CLI_DEVICE_CLIENT_ID) return null;
  const userCode = searchParams.get("user_code")?.trim();
  return userCode || null;
}
