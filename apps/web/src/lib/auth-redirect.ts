import {
  cliAuthorizationPath,
  cliUserCodeFromSearchParams,
} from "./cli-authorization";

export const DEFAULT_AUTH_REDIRECT = "/dashboard";

/**
 * Keep post-authentication navigation on this dashboard origin.
 *
 * Auth callback URLs are user-controlled at the browser boundary. Relative
 * paths are useful for returning to a protected page, but protocol-relative,
 * absolute, and backslash-based URLs must never become redirect targets.
 */
export function getSafeAuthRedirect(
  value: string | null | undefined,
  fallback = DEFAULT_AUTH_REDIRECT,
): string {
  const candidate = value?.trim();
  if (!candidate) return fallback;

  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  if (candidate.includes("\\")) return fallback;
  if (
    [...candidate].some(
      (character) =>
        character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f,
    )
  ) {
    return fallback;
  }

  try {
    const url = new URL(candidate, "https://upstand.invalid");
    if (url.origin !== "https://upstand.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function getLoginSuccessPath(
  searchParams: Pick<URLSearchParams, "get">,
): string {
  const cliUserCode = cliUserCodeFromSearchParams(searchParams);
  if (cliUserCode) return cliAuthorizationPath(cliUserCode);
  return getSafeAuthRedirect(searchParams.get("return_to"));
}

export function getTwoFactorRedirectPath(
  searchParams: Pick<URLSearchParams, "get">,
): string {
  return `/2fa-verify?return_to=${encodeURIComponent(
    getLoginSuccessPath(searchParams),
  )}`;
}
