"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@upstand/ui/components/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@upstand/ui/components/alert-dialog";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import { Skeleton } from "@upstand/ui/components/skeleton";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import {
  AlertTriangleIcon,
  Copy,
  KeyRound,
  RotateCw,
  Trash2Icon,
} from "@/components/huge-icons";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { copyText } from "@/lib/browser";
import { trpc } from "@/utils/trpc";

export default function ScimSettingsPage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const [providerId, setProviderId] = useState("identity-provider");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const providersQuery = useQuery({
    ...trpc.scim.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });

  const create = useMutation({
    ...trpc.scim.create.mutationOptions(),
    onSuccess: (result) => {
      setNewToken(result.token);
      setProviderId("");
      void providersQuery.refetch();
      toast.success("SCIM provider created; copy the token now");
    },
    onError: (error) => toast.error(error.message),
  });

  const rotate = useMutation({
    ...trpc.scim.rotate.mutationOptions(),
    onSuccess: (result) => {
      setNewToken(result.token);
      void providersQuery.refetch();
      toast.success("SCIM token rotated; the previous token is invalid");
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    ...trpc.scim.remove.mutationOptions(),
    onSuccess: () => {
      void providersQuery.refetch();
      toast.success("SCIM provider revoked");
    },
    onError: (error) => toast.error(error.message),
  });

  const copyToken = async () => {
    if (!newToken) return;
    await copyText(newToken);
    toast.success("SCIM token copied");
  };

  return (
    <DashboardPage className="flex-1">
      <DashboardPageHeader
        title="SCIM"
        icon={<KeyRound className="size-6 text-primary" />}
        description="Provision and deactivate organization members from an identity provider using SCIM 2.0."
      />
      <Card>
        <CardHeader>
          <CardTitle>Create Provider Token</CardTitle>
          <CardDescription>
            Tokens are hashed at rest and shown only once after creation or
            rotation. Use the endpoint shown below with a bearer token.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (organizationId && providerId.trim()) {
                create.mutate({
                  organizationId,
                  providerId: providerId.trim(),
                });
              }
            }}
            className="flex flex-col gap-4"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="scim-provider-id">Provider ID</FieldLabel>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="scim-provider-id"
                    name="scim-provider-id"
                    autoComplete="off"
                    value={providerId}
                    onChange={(event) => setProviderId(event.target.value)}
                    placeholder="identity-provider"
                    className="flex-1"
                  />
                  <Button
                    type="submit"
                    disabled={
                      !organizationId || !providerId.trim() || create.isPending
                    }
                  >
                    {create.isPending ? (
                      <>
                        <Spinner data-icon="inline-start" />
                        Creating…
                      </>
                    ) : (
                      "Create Token"
                    )}
                  </Button>
                </div>
              </Field>
            </FieldGroup>
          </form>

          {newToken && (
            <Alert variant="warning" role="status" aria-live="polite">
              <AlertTriangleIcon />
              <AlertTitle>Copy this token now</AlertTitle>
              <AlertDescription className="space-y-2 pt-1">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={newToken}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => void copyToken()}
                    aria-label="Copy SCIM token"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-xs">It will not be shown again.</p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      <div className="flex flex-col gap-2">
        {providersQuery.isPending
          ? Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))
          : null}
        {(providersQuery.data ?? []).map((provider) => (
          <div
            key={provider.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b p-3"
          >
            <div>
              <div className="font-medium">{provider.providerId}</div>
              <div className="font-mono text-muted-foreground text-xs">
                {provider.tokenPrefix}… · /api/scim/v2.0/{organizationId}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  rotate.mutate({ organizationId, id: provider.id })
                }
                disabled={rotate.isPending}
              >
                {rotate.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RotateCw className="mr-1 size-3" />
                )}
                Rotate Token
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setPendingRevoke(provider.id)}
              >
                <Trash2Icon data-icon="inline-start" /> Revoke Token
              </Button>
            </div>
          </div>
        ))}
        {!providersQuery.isPending && providersQuery.data?.length === 0 && (
          <PageEmpty
            icon={KeyRound}
            title="No SCIM providers configured"
            description="Generate a token above to connect an external identity provider."
          />
        )}
      </div>
      <AlertDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke SCIM Provider?</AlertDialogTitle>
            <AlertDialogDescription>
              Provisioning requests will fail immediately and cannot be
              authenticated with this token again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingRevoke) return;
                remove.mutate({ organizationId, id: pendingRevoke });
                setPendingRevoke(null);
              }}
            >
              Revoke Provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardPage>
  );
}
