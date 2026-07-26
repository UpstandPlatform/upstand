"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@upstand/ui/components/button";
import { Card, CardContent } from "@upstand/ui/components/card";
import { Spinner } from "@upstand/ui/components/spinner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageBackdrop } from "@/components/marketing/page-backdrop";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { SsoSignInForm } from "@/components/sso-sign-in-form";
import { authClient } from "@/lib/auth-client";
import { getServerApiUrl } from "@/lib/server-url";

const GoogleIcon = () => (
  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [needsOwnerSetup, setNeedsOwnerSetup] = useState<boolean | null>(null);
  const [setupError, setSetupError] = useState(false);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [isCloud, setIsCloud] = useState<boolean>(false);
  const [sessionTimedOut, setSessionTimedOut] = useState(false);
  const {
    data: session,
    isPending: sessionPending,
    error: sessionError,
    refetch,
  } = authClient.useSession();

  useEffect(() => {
    if (!sessionPending) {
      setSessionTimedOut(false);
      return;
    }
    const timeout = setTimeout(() => setSessionTimedOut(true), 8_000);
    return () => clearTimeout(timeout);
  }, [sessionPending]);

  useEffect(() => {
    let active = true;
    void setupAttempt;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    fetch(getServerApiUrl("/api/setup/status"), {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to check instance setup");
        return (await response.json()) as {
          needsOwnerSetup: boolean;
          isCloud?: boolean;
        };
      })
      .then((status) => {
        if (!active) return;
        setNeedsOwnerSetup(status.needsOwnerSetup);
        if (typeof status.isCloud === "boolean") {
          setIsCloud(status.isCloud);
        }
      })
      .catch(() => {
        if (active) {
          setSetupError(true);
          toast.error("Unable to check instance setup. Try again.");
        }
      });
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [setupAttempt]);

  const retrySetup = () => {
    setSetupError(false);
    setNeedsOwnerSetup(null);
    setSetupAttempt((attempt) => attempt + 1);
  };

  const retrySession = () => {
    setSessionTimedOut(false);
    void refetch();
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}/dashboard`,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to sign in with Google",
      );
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await authClient.signOut();
      toast.success("Signed out successfully");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sign out");
    } finally {
      setLoading(false);
    }
  };

  const isSignUp = needsOwnerSetup || (isCloud && authMode === "signup");

  return (
    <div className="relative flex min-h-[calc(100svh-64px)] flex-col items-center justify-center overflow-hidden bg-background px-4">
      <PageBackdrop />

      <Card className="relative w-full max-w-md rounded-3xl border-border/70 bg-card/70 p-7 shadow-2xl shadow-primary/5 backdrop-blur-md sm:p-8">
        <CardContent className="space-y-8 p-0">
          {sessionError || sessionTimedOut ? (
            <div className="space-y-5 py-8 text-center">
              <div className="space-y-2">
                <h1 className="font-bold text-xl">Unable to reach Upstand</h1>
                <p className="text-muted-foreground text-sm">
                  We couldn’t check your session. Check the server connection
                  and try again.
                </p>
              </div>
              <Button className="w-full" onClick={retrySession}>
                Try again
              </Button>
              <Button variant="outline" className="w-full" onClick={retrySetup}>
                Check instance setup
              </Button>
            </div>
          ) : sessionPending ? (
            <div className="flex flex-col items-center justify-center space-y-4 py-12">
              <Spinner />
              <p className="text-muted-foreground text-sm">
                Checking authentication state…
              </p>
            </div>
          ) : session ? (
            <div className="space-y-6">
              <div className="space-y-2 text-center">
                {/* Fixed: added bg-clip-text */}
                <h1 className="bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text font-extrabold text-3xl text-transparent tracking-tight">
                  Already signed in
                </h1>
                <p className="text-muted-foreground text-sm">
                  You are currently logged in as{" "}
                  <span className="font-semibold text-foreground">
                    {session.user.name || session.user.email}
                  </span>
                </p>
              </div>

              <div className="space-y-3 pt-2">
                {/* render prop replaces manually-styled <Link> */}
                <Button
                  size="lg"
                  className="w-full font-semibold"
                  nativeButton={false}
                  render={<Link href="/dashboard" />}
                >
                  Go to Dashboard
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    className="ml-2 size-4"
                  />
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={handleSignOut}
                  disabled={loading}
                  className="w-full font-semibold hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
                >
                  {loading ? <Spinner className="mr-2" /> : "Sign Out"}
                </Button>
              </div>
            </div>
          ) : setupError ? (
            <div className="space-y-5 py-8 text-center">
              <div className="space-y-2">
                <h1 className="font-bold text-xl">Setup status unavailable</h1>
                <p className="text-muted-foreground text-sm">
                  The sign-in service is reachable, but instance setup could not
                  be checked.
                </p>
              </div>
              <Button className="w-full" onClick={retrySetup}>
                Try again
              </Button>
            </div>
          ) : needsOwnerSetup === null ? (
            <div className="flex flex-col items-center justify-center space-y-4 py-12">
              <Spinner />
              <p className="text-muted-foreground text-sm">
                Checking instance setup…
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2 text-center">
                {/* Fixed: added bg-clip-text */}
                <h1 className="bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text font-extrabold text-3xl text-transparent tracking-tight">
                  {needsOwnerSetup
                    ? "Set up Upstand"
                    : isSignUp
                      ? "Create an account"
                      : "Welcome back"}
                </h1>
                <p className="text-muted-foreground text-sm">
                  {needsOwnerSetup
                    ? "Create the owner account for this self-hosted instance"
                    : isSignUp
                      ? "Sign up to start building with Upstand"
                      : "Sign in to manage your workspace"}
                </p>
              </div>

              <div className="space-y-5">
                {isSignUp ? (
                  <SignUpForm
                    onSwitchToSignIn={
                      isCloud && !needsOwnerSetup
                        ? () => setAuthMode("signin")
                        : undefined
                    }
                  />
                ) : (
                  <SignInForm
                    onSwitchToSignUp={
                      isCloud ? () => setAuthMode("signup") : undefined
                    }
                  />
                )}

                <Button
                  variant="outline"
                  size="lg"
                  onClick={handleGoogleSignIn}
                  disabled={loading || needsOwnerSetup}
                  className="w-full gap-3 border-border bg-muted/40 font-semibold text-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {loading ? (
                    <Spinner />
                  ) : (
                    <>
                      <GoogleIcon /> Continue with Google
                    </>
                  )}
                </Button>
                {!isSignUp && <SsoSignInForm />}
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-2 text-muted-foreground text-xs">
            <span />
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              className="gap-1 text-xs hover:text-primary"
              render={<Link href="/" />}
            >
              Back to home
              <HugeiconsIcon icon={ArrowRight01Icon} className="size-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
