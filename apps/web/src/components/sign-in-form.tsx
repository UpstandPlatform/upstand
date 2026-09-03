import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@upstand/ui/components/button";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import z from "zod";
import { SYSTEM_CONFIG_QUERY_KEY } from "@/hooks/use-system-config";
import { authClient } from "@/lib/auth-client";
import { getSafeAuthRedirect } from "@/lib/auth-redirect";
import { getUserFacingError } from "@/lib/error-message";
import { bootstrapInitialOrganization } from "@/lib/organization-bootstrap";
import { AuthFormField } from "./auth/auth-form-field";

export default function SignInForm({
  onSwitchToSignUp,
  successPath = "/dashboard",
}: {
  onSwitchToSignUp?: () => void;
  successPath?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { refetch: refetchSession } = authClient.useSession();

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(
        {
          email: value.email,
          password: value.password,
        },
        {
          onSuccess: async () => {
            // The sign-in endpoint sets the cookie but Better Auth's shared
            // session atom is not guaranteed to be populated before the
            // dashboard mounts. Refresh it before navigation so the protected
            // layout cannot mistake a valid new session for an anonymous one.
            // A stale anonymous request can finish just after sign-in and
            // overwrite the shared atom. Retry briefly until the new cookie is
            // visible to the API instead of navigating with a null snapshot.
            await refetchSession();

            // Setup status includes the signed-in instance-owner surface. The
            // anonymous login page may have populated this query already, so
            // invalidate it before mounting the dashboard.
            await queryClient.invalidateQueries({
              queryKey: SYSTEM_CONFIG_QUERY_KEY,
            });

            // Imperatively select the active organization before navigating so
            // the dashboard layout sees it immediately without a reload.
            await bootstrapInitialOrganization();
            router.replace(getSafeAuthRedirect(successPath) as Route);
            toast.success("Sign in successful");
          },
          onError: (error) => {
            toast.error(
              getUserFacingError(
                error.error.message || error.error.statusText,
                "Unable to sign in",
              ),
            );
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  });

  return (
    <div className="w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-5"
      >
        <div>
          <form.Field name="email">
            {(field) => (
              <AuthFormField
                field={field}
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
              />
            )}
          </form.Field>
        </div>

        <div>
          <form.Field name="password">
            {(field) => (
              <AuthFormField
                field={field}
                label="Password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
              />
            )}
          </form.Field>
        </div>

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button
              type="submit"
              className="w-full"
              disabled={!canSubmit || isSubmitting}
            >
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      {onSwitchToSignUp ? (
        <div className="mt-4 text-center">
          <Button
            variant="link"
            onClick={onSwitchToSignUp}
            className="text-muted-foreground hover:text-primary"
          >
            Need an account? Sign Up
          </Button>
        </div>
      ) : null}
    </div>
  );
}
