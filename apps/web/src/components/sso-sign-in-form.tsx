"use client";

import { Button } from "@upstand/ui/components/button";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

export function SsoSignInForm({ disabled = false }: { disabled?: boolean }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);

  const signIn = async () => {
    setPending(true);
    try {
      await authClient.signIn.sso({
        email: email.trim() || undefined,
        callbackURL: `${window.location.origin}/dashboard`,
        errorCallbackURL: `${window.location.origin}/login?error=sso`,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to start SSO sign-in",
      );
      setPending(false);
    }
  };

  return (
    <div className="space-y-3 border-t pt-5">
      <div className="text-center text-muted-foreground text-xs">
        or continue with organization SSO
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sso-email">Work email</Label>
        <Input
          id="sso-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={disabled || pending}
          onKeyDown={(event) => {
            if (event.key === "Enter") void signIn();
          }}
        />
      </div>
      <Button
        variant="outline"
        className="w-full"
        onClick={signIn}
        disabled={disabled || pending || !email.trim()}
      >
        {pending ? "Redirecting to SSO…" : "Sign in with SSO"}
      </Button>
    </div>
  );
}
