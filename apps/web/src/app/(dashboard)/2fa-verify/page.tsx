"use client";

import { Shield01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Field, FieldLabel } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import { Separator } from "@upstand/ui/components/separator";
import { Spinner } from "@upstand/ui/components/spinner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageBackdrop } from "@/components/marketing/page-backdrop";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export default function TwoFactorVerifyPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);

  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (session === null) {
      router.replace("/login");
      return;
    }

    if (session && session.user.twoFactorEnabled !== true) {
      router.replace("/dashboard");
    }
  }, [router, session]);

  const handleVerify = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setVerifying(true);
    try {
      const { error } = recoveryMode
        ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
        : await authClient.twoFactor.verifyTotp({ code: code.trim() });

      if (error) {
        toast.error(error.message || "Invalid two-factor code");
      } else {
        // Invalidate the 2FA verification query so the layout doesn't redirect back
        await queryClient.invalidateQueries({
          queryKey: trpc.auth.isSession2faVerified.queryKey(),
        });
        toast.success("Authentication successful!");
        router.push("/dashboard");
      }
    } catch {
      toast.error("Failed to verify code. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      router.push("/login");
    } catch {
      toast.error("Failed to sign out");
    }
  };

  if (
    session === undefined ||
    session === null ||
    session.user.twoFactorEnabled !== true
  ) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4">
      <PageBackdrop />

      <Card className="relative w-full max-w-sm rounded-3xl border-border/70 bg-card/70 shadow-2xl shadow-primary/5 backdrop-blur-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon
              icon={Shield01Icon}
              className="size-6 text-primary"
            />
          </div>
          <CardTitle className="text-xl">Two-factor verification</CardTitle>
          <CardDescription>
            {recoveryMode
              ? "Enter one of your unused recovery codes to continue."
              : "Enter the 6-digit code from your authenticator app to continue."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleVerify} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="mfa-code">
                {recoveryMode ? "Recovery code" : "Verification Code"}
              </FieldLabel>
              <Input
                id="mfa-code"
                type="text"
                inputMode={recoveryMode ? "text" : "numeric"}
                pattern={recoveryMode ? undefined : "[0-9]*"}
                maxLength={recoveryMode ? 64 : 6}
                value={code}
                onChange={(e) =>
                  setCode(
                    recoveryMode
                      ? e.target.value.trim()
                      : e.target.value.replace(/\D/g, ""),
                  )
                }
                placeholder={recoveryMode ? "recovery-code" : "000000"}
                autoComplete="one-time-code"
                className="text-center font-mono text-2xl tracking-[0.5em] placeholder:font-normal placeholder:tracking-normal"
                required
                autoFocus
              />
            </Field>

            <Button
              type="submit"
              size="lg"
              disabled={verifying || (recoveryMode ? !code : code.length !== 6)}
              className="w-full"
            >
              {verifying && <Spinner data-icon="inline-start" />}
              {recoveryMode ? "Use recovery code" : "Verify code"}
            </Button>
          </form>

          <Separator className="my-4" />

          <button
            type="button"
            className="w-full text-center text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => {
              setRecoveryMode((value) => !value);
              setCode("");
            }}
          >
            {recoveryMode
              ? "Use authenticator code instead"
              : "Use a recovery code instead"}
          </button>

          <div className="mt-4 flex items-center justify-between text-muted-foreground text-xs">
            <button
              type="button"
              onClick={handleSignOut}
              className="transition-colors hover:text-destructive"
            >
              Sign out
            </button>
            <span>Protected by Upstand MFA</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
