import { useForm } from "@tanstack/react-form";
import { Button } from "@upstand/ui/components/button";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { AuthFormField } from "./auth/auth-form-field";

export default function SignUpForm({
  onSwitchToSignIn,
}: {
  onSwitchToSignIn?: () => void;
}) {
  const router = useRouter();

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
      name: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signUp.email(
        {
          email: value.email,
          password: value.password,
          name: value.name,
        },
        {
          onSuccess: () => {
            router.push("/dashboard");
            toast.success("Sign up successful");
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(2, "Name must be at least 2 characters"),
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
          <form.Field name="name">
            {(field) => (
              <AuthFormField
                field={field}
                label="Name"
                autoComplete="name"
                placeholder="Your name"
              />
            )}
          </form.Field>
        </div>

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
                autoComplete="new-password"
                placeholder="At least 8 characters"
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
              {isSubmitting ? "Creating account…" : "Create account"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      {onSwitchToSignIn ? (
        <div className="mt-4 text-center">
          <Button
            variant="link"
            onClick={onSwitchToSignIn}
            className="text-muted-foreground hover:text-primary"
          >
            Already have an account? Sign In
          </Button>
        </div>
      ) : null}
    </div>
  );
}
