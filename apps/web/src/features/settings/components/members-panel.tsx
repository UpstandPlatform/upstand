import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type Capability,
  capabilitiesForRole,
  MEMBER_SCOPE_ACTIONS,
} from "@upstand/domain";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Checkbox } from "@upstand/ui/components/checkbox";
import { Field, FieldError, FieldLabel } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";
import { useMembersSettings } from "../hooks/use-members-settings";

function capabilityLabel(capability: Capability): string {
  const [resource, action] = capability.split(":");
  const resourceLabel = resource.replaceAll("_", " ");
  return `${action[0]?.toUpperCase() ?? action}${action.slice(1)} ${resourceLabel}`;
}

const MEMBER_CAPABILITIES: Array<[Capability, string]> =
  MEMBER_SCOPE_ACTIONS.map((capability) => [
    capability,
    capabilityLabel(capability),
  ]);

const DEFAULT_MEMBER_CAPABILITIES: Capability[] = [
  ...capabilitiesForRole("member"),
];

export function MembersPanel() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const customRolesQuery = useQuery({
    ...trpc.customRole.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });

  const createCustomRole = useMutation({
    ...trpc.customRole.create.mutationOptions(),
  });

  const removeCustomRole = useMutation({
    ...trpc.customRole.remove.mutationOptions(),
    onSuccess: () => {
      void customRolesQuery.refetch();
      toast.success("Custom role deleted");
    },
    onError: (error) => toast.error(error.message),
  });

  const {
    members,
    notificationChannels,
    invites,
    inviteMember,
    isInviting,
    createMember,
    isCreating,
    updateMember,
    removeMember,
    cancelInvitation,
  } = useMembersSettings(organizationId);

  const [mode, setMode] = useState<"invite" | "create">("invite");
  const [roleToDelete, setRoleToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        role: "member" | "admin";
        permissions: Capability[];
        customRoleId?: string | null;
      }
    >
  >({});

  const emailChannels = notificationChannels.filter(
    (channel) => channel.provider === "email" || channel.provider === "resend",
  );

  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "member" as string,
      customRoleName: "",
      emailChannelId: "",
      permissions: DEFAULT_MEMBER_CAPABILITIES,
    },
    onSubmit: async ({ value }) => {
      let customRoleId: string | undefined;

      if (value.role === "create-custom") {
        if (!value.customRoleName?.trim()) {
          toast.error("Please enter a name for the custom role");
          return;
        }
        try {
          const newRole = await createCustomRole.mutateAsync({
            organizationId,
            name: value.customRoleName.trim(),
            description: "Created during member invitation",
            permissions: value.permissions,
          });
          customRoleId = newRole.id;
        } catch (error: unknown) {
          toast.error(
            `Failed to create custom role: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }
      } else if (value.role.startsWith("custom:")) {
        customRoleId = value.role.slice("custom:".length);
      }

      const isCustom =
        value.role === "create-custom" || value.role.startsWith("custom:");
      const apiRole = (isCustom ? "member" : value.role) as "member" | "admin";

      if (mode === "create") {
        createMember({
          organizationId,
          email: value.email.trim(),
          name: value.name.trim(),
          password: value.password,
          role: apiRole,
          permissions: value.permissions,
          customRoleId,
        });
      } else {
        inviteMember({
          organizationId,
          email: value.email.trim(),
          role: apiRole,
          permissions: value.permissions,
          emailChannelId: value.emailChannelId,
          customRoleId,
        });
      }
    },
    validators: {
      onSubmit: ({ value }) => {
        if (!value.email.includes("@")) {
          return "Invalid email address";
        }
        if (value.role === "create-custom" && !value.customRoleName?.trim()) {
          return "Custom role name is required";
        }
        if (mode === "create") {
          if (!value.name) return "Full name is required";
          if (!value.password || value.password.length < 8) {
            return "Initial password must be at least 8 characters";
          }
        } else {
          if (!value.emailChannelId) return "Email provider is required";
        }
        return undefined;
      },
    },
  });

  const handleRoleChange = (roleVal: string) => {
    form.setFieldValue("role", roleVal);
    if (roleVal === "create-custom") {
      form.setFieldValue("permissions", DEFAULT_MEMBER_CAPABILITIES);
      form.setFieldValue("customRoleName", "");
    } else if (!roleVal.startsWith("custom:")) {
      form.setFieldValue(
        "permissions",
        roleVal === "admin"
          ? MEMBER_CAPABILITIES.map(([key]) => key)
          : DEFAULT_MEMBER_CAPABILITIES,
      );
    } else {
      const customId = roleVal.slice("custom:".length);
      const selectedRole = customRolesQuery.data?.find(
        (r) => r.id === customId,
      );
      if (selectedRole) {
        form.setFieldValue("permissions", selectedRole.permissions);
      }
    }
  };

  if (organizationState.status !== "ready") {
    return (
      <p className="text-muted-foreground text-sm">
        Select a workspace to manage members.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Add workspace member</CardTitle>
          <CardDescription>
            Grant precise capabilities, create credentials immediately, or send
            an invitation through a configured Email/Resend channel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 pb-4">
            <Button
              type="button"
              size="sm"
              variant={mode === "invite" ? "default" : "outline"}
              onClick={() => {
                setMode("invite");
                form.reset();
              }}
            >
              Invitation
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "create" ? "default" : "outline"}
              onClick={() => {
                setMode("create");
                form.reset();
              }}
            >
              Create credentials
            </Button>
          </div>

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            {mode === "create" && (
              <form.Field
                name="name"
                validators={{
                  onChange: z.string().min(1, "Full name is required"),
                }}
              >
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>Full name</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Alex Johnson"
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            )}

            <form.Field
              name="email"
              validators={{
                onChange: z.string().email("Invalid email address"),
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Email address</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="colleague@company.com"
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>

            {mode === "create" && (
              <form.Field
                name="password"
                validators={{
                  onChange: z
                    .string()
                    .min(8, "Initial password must be at least 8 characters"),
                }}
              >
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      Initial password
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="password"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="At least 8 characters"
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            )}

            <form.Field name="role">
              {(field) => {
                const roleItems = [
                  { value: "member", label: "Member" },
                  { value: "admin", label: "Admin" },
                  ...(customRolesQuery.data ?? []).map((role) => ({
                    value: `custom:${role.id}`,
                    label: `${role.name} (Custom)`,
                  })),
                  {
                    value: "create-custom",
                    label: "Create custom role...",
                  },
                ];
                const selectedRoleLabel =
                  roleItems.find((item) => item.value === field.state.value)
                    ?.label ?? "Select a role";
                return (
                  <Field>
                    <FieldLabel>Role</FieldLabel>
                    <Select
                      items={roleItems}
                      value={field.state.value}
                      onValueChange={(val) => handleRoleChange(val ?? "")}
                    >
                      <SelectTrigger>
                        <SelectValue>{selectedRoleLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        {(customRolesQuery.data ?? []).map((role) => (
                          <SelectItem key={role.id} value={`custom:${role.id}`}>
                            <div className="flex w-full items-center justify-between gap-4">
                              <span>{role.name}</span>
                              <button
                                type="button"
                                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setRoleToDelete({
                                    id: role.id,
                                    name: role.name,
                                  });
                                }}
                              >
                                <HugeiconsIcon
                                  icon={Delete02Icon}
                                  className="size-3.5"
                                />
                              </button>
                            </div>
                          </SelectItem>
                        ))}
                        <SelectItem value="create-custom">
                          Create custom role...
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                );
              }}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.role}>
              {(role) =>
                role === "create-custom" ? (
                  <form.Field name="customRoleName">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>
                          Custom Role Name
                        </FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder="e.g. Developer, Support, Auditor"
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                ) : null
              }
            </form.Subscribe>

            {mode === "invite" && (
              <form.Field
                name="emailChannelId"
                validators={{
                  onChange: z
                    .string()
                    .min(1, "Please select an Email or Resend channel"),
                }}
              >
                {(field) => (
                  <Field>
                    <FieldLabel>Email provider</FieldLabel>
                    <Select
                      items={emailChannels.map((channel) => ({
                        value: channel.id,
                        label: `${channel.name} (${
                          channel.provider === "resend"
                            ? "Resend"
                            : "SMTP Email"
                        })`,
                      }))}
                      value={field.state.value}
                      onValueChange={(val) => field.handleChange(val ?? "")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Email or Resend" />
                      </SelectTrigger>
                      <SelectContent>
                        {emailChannels.map((channel) => (
                          <SelectItem key={channel.id} value={channel.id}>
                            {channel.name} (
                            {channel.provider === "resend"
                              ? "Resend"
                              : "SMTP Email"}
                            )
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            )}

            <form.Subscribe selector={(state) => state.values.role}>
              {(role) => {
                const isPermissionsEditable = role === "create-custom";
                return (
                  <form.Field name="permissions">
                    {(field) => (
                      <Field>
                        <FieldLabel>Capabilities</FieldLabel>
                        <div className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2">
                          {MEMBER_CAPABILITIES.map(([key, label]) => (
                            <Label
                              className="flex items-center gap-2 text-xs"
                              key={key}
                            >
                              <Checkbox
                                disabled={!isPermissionsEditable}
                                checked={field.state.value.includes(key)}
                                onCheckedChange={(checked) => {
                                  const next = checked
                                    ? [...field.state.value, key]
                                    : field.state.value.filter(
                                        (item) => item !== key,
                                      );
                                  field.handleChange(next);
                                }}
                              />
                              {label}
                            </Label>
                          ))}
                        </div>
                      </Field>
                    )}
                  </form.Field>
                );
              }}
            </form.Subscribe>

            <form.Subscribe
              selector={(state) => ({
                canSubmit: state.canSubmit,
              })}
            >
              {({ canSubmit }) => (
                <Button
                  type="submit"
                  disabled={!canSubmit || isCreating || isInviting}
                >
                  {(isCreating || isInviting) && (
                    <Spinner data-icon="inline-start" />
                  )}
                  {mode === "invite" ? "Send invitation" : "Create member"}
                </Button>
              )}
            </form.Subscribe>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Members and permissions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {members.map((member) => {
            const draft = drafts[member.id] ?? {
              role: member.role === "admin" ? "admin" : "member",
              permissions: member.permissions ?? DEFAULT_MEMBER_CAPABILITIES,
              customRoleId: member.role.startsWith("custom:")
                ? member.role.slice("custom:".length)
                : null,
            };
            return (
              <div
                className="flex flex-col gap-3 border-b pb-4 last:border-0 last:pb-0"
                key={member.id}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="grid text-sm">
                    <span className="font-medium">
                      {member.user.name || member.user.email}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {member.user.email}
                    </span>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {member.role}
                  </Badge>
                </div>
                {member.role !== "owner" && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Select
                        items={[
                          { value: "member", label: "Member" },
                          { value: "admin", label: "Admin" },
                          ...(customRolesQuery.data ?? []).map((role) => ({
                            value: `custom:${role.id}`,
                            label: role.name,
                          })),
                        ]}
                        value={
                          draft.customRoleId
                            ? `custom:${draft.customRoleId}`
                            : draft.role
                        }
                        onValueChange={(value) => {
                          if (!value) return;
                          setDrafts((current) => ({
                            ...current,
                            [member.id]: {
                              ...draft,
                              role: value === "admin" ? "admin" : "member",
                              customRoleId: value.startsWith("custom:")
                                ? value.slice("custom:".length)
                                : null,
                              permissions: value.startsWith("custom:")
                                ? (customRolesQuery.data?.find(
                                    (role) =>
                                      role.id === value.slice("custom:".length),
                                  )?.permissions ?? draft.permissions)
                                : draft.permissions,
                            },
                          }));
                        }}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue>
                            {draft.customRoleId
                              ? (customRolesQuery.data?.find(
                                  (r) => r.id === draft.customRoleId,
                                )?.name ?? draft.role)
                              : draft.role === "admin"
                                ? "Admin"
                                : "Member"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          {(customRolesQuery.data ?? []).map((role) => (
                            <SelectItem
                              key={role.id}
                              value={`custom:${role.id}`}
                            >
                              {role.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        onClick={() =>
                          updateMember({
                            organizationId,
                            memberId: member.id,
                            role: draft.role,
                            permissions: draft.permissions,
                            customRoleId: draft.customRoleId,
                          })
                        }
                      >
                        Save capabilities
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          removeMember({ organizationId, memberId: member.id })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {MEMBER_CAPABILITIES.map(([key, label]) => (
                        <Label
                          className="flex items-center gap-2 text-xs"
                          key={key}
                        >
                          <Checkbox
                            checked={draft.permissions.includes(key)}
                            onCheckedChange={(checked) =>
                              setDrafts((current) => ({
                                ...current,
                                [member.id]: {
                                  ...draft,
                                  permissions: checked
                                    ? [...draft.permissions, key]
                                    : draft.permissions.filter(
                                        (item) => item !== key,
                                      ),
                                },
                              }))
                            }
                          />
                          {label}
                        </Label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {!!invites?.length && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pending invitations</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {invites.map((invitation) => (
              <div
                className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
                key={invitation.id}
              >
                <div className="grid text-sm">
                  <span>{invitation.email}</span>
                  <span className="text-muted-foreground text-xs">
                    Role: {invitation.role}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    cancelInvitation({ invitationId: invitation.id })
                  }
                >
                  Cancel
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <ConfirmActionDialog
        open={Boolean(roleToDelete)}
        onOpenChange={(open) => !open && setRoleToDelete(null)}
        title="Delete Custom Role?"
        description={`Are you sure you want to delete the custom role "${roleToDelete?.name}"? Active members with this role will be degraded to the Member role.`}
        actionLabel="Delete Role"
        pending={removeCustomRole.isPending}
        onConfirm={() => {
          if (roleToDelete) {
            removeCustomRole.mutate(
              {
                organizationId,
                id: roleToDelete.id,
              },
              {
                onSuccess: () => setRoleToDelete(null),
              },
            );
          }
        }}
      />
    </div>
  );
}
