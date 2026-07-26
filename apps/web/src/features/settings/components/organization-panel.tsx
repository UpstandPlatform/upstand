import { useForm } from "@tanstack/react-form";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Field, FieldError, FieldLabel } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import { Spinner } from "@upstand/ui/components/spinner";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import z from "zod";
import { authClient } from "@/lib/auth-client";

export function OrganizationPanel() {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const [updating, setUpdating] = useState(false);

  const form = useForm({
    defaultValues: {
      name: "",
    },
    onSubmit: async ({ value }) => {
      if (!activeOrg) return;
      setUpdating(true);
      try {
        await authClient.organization.update({
          organizationId: activeOrg.id,
          data: { name: value.name.trim() },
        });
        toast.success("Organization updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update");
      } finally {
        setUpdating(false);
      }
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(1, "Workspace name is required"),
      }),
    },
  });

  const orgName = activeOrg?.name;
  useEffect(() => {
    if (orgName) {
      form.setFieldValue("name", orgName);
    }
  }, [orgName, form]);

  if (!activeOrg) {
    return (
      <p className="text-muted-foreground text-sm">
        Select an organization first.
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Workspace Settings</CardTitle>
        <CardDescription>
          Slug: <code className="font-mono text-xs">/{activeOrg.slug}</code>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <form.Field name="name">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Organization Name</FieldLabel>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="e.g. Acme Inc."
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <div className="flex justify-end">
            <form.Subscribe
              selector={(state) => ({
                canSubmit: state.canSubmit,
              })}
            >
              {({ canSubmit }) => (
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canSubmit || updating}
                >
                  {updating && <Spinner data-icon="inline-start" />}
                  Save Changes
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
