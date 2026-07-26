import { useForm } from "@tanstack/react-form";
import { Button } from "@upstand/ui/components/button";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { AuthFormField } from "./auth/auth-form-field";

export default function SignInForm({
  onSwitchToSignUp,
}: {
  onSwitchToSignUp?: () => void;
}) {
  const router = useRouter();

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
            // Imperatively select the active organization before navigating so
            // the dashboard layout sees it immediately without a reload.
            try {
              const { data: orgs } = await authClient.organization.list();
              if (orgs && orgs.length > 0) {
                const personal = orgs.find(
                  (o) =>
                    (o.metadata as { isPersonal?: boolean } | null)
                      ?.isPersonal || o.name.toLowerCase() === "personal",
                );
                const target = personal || orgs[0];
                await authClient.organization.setActive({
                  organizationId: target.id,
                });
              }
            } catch {
              // Non-fatal: dashboard layout will handle org selection as fallback
            }
            router.push("/dashboard");
            toast.success("Sign in successful");
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
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
