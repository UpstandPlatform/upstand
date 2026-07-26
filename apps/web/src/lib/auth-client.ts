import { ssoClient } from "@better-auth/sso/client";
import {
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { getServerApiUrl } from "@/lib/server-url";
export const authClient = createAuthClient({
  // better-auth derives its route-matching base from this URL's path, so the
  // public auth path must equal the server-side mount (/api/auth everywhere)
  baseURL: getServerApiUrl("/api/auth"),
  plugins: [
    organizationClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = "/2fa-verify";
      },
    }),
    ssoClient(),
  ],
});
