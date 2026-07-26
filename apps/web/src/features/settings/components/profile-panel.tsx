import { useForm } from "@tanstack/react-form";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@upstand/ui/components/avatar";
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
import { useEffect } from "react";
import z from "zod";
import { EditableEntityIcon } from "@/components/editable-entity-icon";
import { authClient } from "@/lib/auth-client";
import { useProfileSettings } from "../hooks/use-profile-settings";

export function ProfilePanel() {
  const { data: session } = authClient.useSession();

  const profileForm = useForm({
    defaultValues: {
      name: "",
    },
    onSubmit: async ({ value }) => {
      if (value.name.trim()) {
        updateUser({ name: value.name.trim() });
      }
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(1, "Display name is required"),
      }),
    },
  });

  const passwordForm = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      changePassword({
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
        revokeOtherSessions: true,
      });
    },
    validators: {
      onSubmit: z
        .object({
          currentPassword: z.string().min(1, "Current password is required"),
          newPassword: z
            .string()
            .min(8, "New password must be at least 8 characters"),
          confirmPassword: z
            .string()
            .min(8, "Please confirm your new password"),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: "New passwords do not match",
          path: ["confirmPassword"],
        }),
    },
  });

  const { updateUser, isUpdatingProfile, changePassword, isChangingPassword } =
    useProfileSettings(() => {
      passwordForm.reset();
    });

  // Keep form in sync when session load finishes
  const userName = session?.user?.name;
  useEffect(() => {
    if (userName) {
      profileForm.setFieldValue("name", userName);
    }
  }, [userName, profileForm]);

  if (!session) {
    return (
      <p className="text-muted-foreground text-sm">Please sign in first.</p>
    );
  }

  const initials = session.user.name?.slice(0, 2).toUpperCase() || "US";

  return (
    <div className="flex flex-col gap-4">
      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Account Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              profileForm.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex items-center gap-3">
              <EditableEntityIcon
                icon={session.user.image}
                defaultIcon={
                  <Avatar className="size-full">
                    <AvatarImage src={session.user.image || undefined} />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                }
                entityName={session.user.name || "User"}
                entityType="profile"
                sizeClassName="size-12 rounded-full"
                onSaveIcon={async (newIcon) => {
                  await updateUser({
                    image: newIcon ?? "",
                  });
                }}
              />
              <div className="grid text-sm">
                <span className="font-medium">{session.user.name}</span>
                <span className="text-muted-foreground text-xs">
                  {session.user.email}
                </span>
              </div>
            </div>

            <profileForm.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Display Name</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Your name"
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </profileForm.Field>

            <div className="flex justify-end">
              <profileForm.Subscribe
                selector={(state) => ({
                  canSubmit: state.canSubmit,
                })}
              >
                {({ canSubmit }) => (
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!canSubmit || isUpdatingProfile}
                  >
                    {isUpdatingProfile && <Spinner data-icon="inline-start" />}
                    Save Changes
                  </Button>
                )}
              </profileForm.Subscribe>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Change Password</CardTitle>
          <CardDescription>
            Only applicable if you signed up with email & password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              passwordForm.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            <passwordForm.Field name="currentPassword">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Current Password</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="••••••••"
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </passwordForm.Field>

            <passwordForm.Field name="newPassword">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>New Password</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Min. 8 characters"
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </passwordForm.Field>

            <passwordForm.Field name="confirmPassword">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Confirm Password</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Repeat new password"
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </passwordForm.Field>

            <div className="flex justify-end">
              <passwordForm.Subscribe
                selector={(state) => ({
                  canSubmit: state.canSubmit,
                })}
              >
                {({ canSubmit }) => (
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!canSubmit || isChangingPassword}
                  >
                    {isChangingPassword && <Spinner data-icon="inline-start" />}
                    Update Password
                  </Button>
                )}
              </passwordForm.Subscribe>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
