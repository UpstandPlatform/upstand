"use client";

import { FingerPrintIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@upstand/ui/components/button";
import { Spinner } from "@upstand/ui/components/spinner";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SYSTEM_CONFIG_QUERY_KEY } from "@/hooks/use-system-config";
import { authClient } from "@/lib/auth-client";
import { getUserFacingError } from "@/lib/error-message";
import { bootstrapInitialOrganization } from "@/lib/organization-bootstrap";
import { isPasskeySupported } from "@/lib/passkey";

export function PasskeySignInButton({
  successPath = "/dashboard",
}: {
  successPath?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { refetch: refetchSession } = authClient.useSession();
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(isPasskeySupported());
  }, []);

  const handleSignIn = async () => {
    if (!isPasskeySupported()) {
      toast.error("Passkeys are not supported by this browser.");
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result.error || !result.data) {
        toast.error(
          getUserFacingError(
            result.error?.message || result.error?.statusText,
            "Unable to sign in with passkey",
          ),
        );
        return;
      }

      await refetchSession();
      await queryClient.invalidateQueries({
        queryKey: SYSTEM_CONFIG_QUERY_KEY,
      });
      await bootstrapInitialOrganization();
      router.push(successPath as Route);
      toast.success("Sign in successful");
    } catch (error) {
      toast.error(getUserFacingError(error, "Unable to sign in with passkey"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      onClick={handleSignIn}
      disabled={!supported || loading}
      className="w-full gap-3 border-border bg-muted/40 font-semibold text-foreground hover:bg-accent hover:text-accent-foreground"
      title={
        supported
          ? "Sign in with a passkey"
          : "Passkeys are unavailable in this browser"
      }
    >
      {loading ? (
        <Spinner />
      ) : (
        <HugeiconsIcon icon={FingerPrintIcon} aria-hidden="true" />
      )}
      {loading ? "Waiting for passkey…" : "Continue with passkey"}
    </Button>
  );
}
