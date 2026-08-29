import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import {
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { getServerApiUrl } from "@/lib/server-url";

const authClientBaseOptions = {
  // better-auth derives its route-matching base from this URL's path, so the
  // public auth path must equal the server-side mount (/api/auth everywhere)
  baseURL: getServerApiUrl("/api/auth"),
};

// Keep the full client for application routes that need the typed two-factor
// endpoints. Better Auth UI's generic hooks intentionally accept a base client;
// using this parallel client prevents plugin-specific session fields from
// becoming an unsafe structural cast at the UI boundary.
export const authUiClient = createAuthClient({
  ...authClientBaseOptions,
  plugins: [organizationClient(), passkeyClient(), ssoClient()],
});

export const authClient = createAuthClient({
  ...authClientBaseOptions,
  plugins: [
    organizationClient(),
    passkeyClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = "/2fa-verify";
      },
    }),
    ssoClient(),
  ],
});
