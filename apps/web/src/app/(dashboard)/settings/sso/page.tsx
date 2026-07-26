"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import { Skeleton } from "@upstand/ui/components/skeleton";
import { Spinner } from "@upstand/ui/components/spinner";
import { Switch } from "@upstand/ui/components/switch";
import { Textarea } from "@upstand/ui/components/textarea";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import {
  Edit2,
  KeyRound,
  PlusIcon,
  ShieldCheck,
  Trash2Icon,
} from "@/components/huge-icons";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { getServerApiUrl } from "@/lib/server-url";
import { trpc } from "@/utils/trpc";

type ProviderProtocol = "oidc" | "saml";

type Provider = {
  providerId: string;
  issuer: string;
  domain: string;
  domainVerified?: boolean;
  domainVerificationToken?: string;
  redirectURI?: string;

  /**
   * Have your custom providers-list endpoint return one of these.
   * Existing records without this property default to OIDC.
   */
  protocol?: ProviderProtocol;
  type?: ProviderProtocol;

  /**
   * Return only non-sensitive configuration fields.
   * Never return clientSecret or private key material.
   */
  oidcConfig?: {
    clientId?: string;
    discoveryEndpoint?: string;
  };

  samlConfig?: {
    entryPoint?: string;
  };
};

type ProviderAction = {
  type: "challenge" | "verify";
  providerId: string;
} | null;

type ProviderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  provider: Provider | null;
  onSaved: () => Promise<void> | void;
};

async function ssoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(getServerApiUrl(`/api/auth${path}`), {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  const data = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.message || data.error || "SSO request failed");
  }

  return data;
}

function getProviderProtocol(provider: Provider | null): ProviderProtocol {
  if (!provider) return "oidc";

  if (provider.protocol === "saml" || provider.type === "saml") {
    return "saml";
  }

  if (provider.samlConfig) {
    return "saml";
  }

  return "oidc";
}

function ProviderDialog({
  open,
  onOpenChange,
  organizationId,
  provider,
  onSaved,
}: ProviderDialogProps) {
  const isEditing = provider !== null;

  const [protocol, setProtocol] = useState<ProviderProtocol>("oidc");
  const [providerId, setProviderId] = useState("");
  const [issuer, setIssuer] = useState("");
  const [domain, setDomain] = useState("");

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [discoveryEndpoint, setDiscoveryEndpoint] = useState("");

  const [entryPoint, setEntryPoint] = useState("");
  const [certificate, setCertificate] = useState("");

  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setProtocol("oidc");
    setProviderId("");
    setIssuer("");
    setDomain("");
    setClientId("");
    setClientSecret("");
    setDiscoveryEndpoint("");
    setEntryPoint("");
    setCertificate("");
  }, []);

  useEffect(() => {
    if (!open) return;

    const providerProtocol = getProviderProtocol(provider);

    setProtocol(providerProtocol);
    setProviderId(provider?.providerId ?? "");
    setIssuer(provider?.issuer ?? "");
    setDomain(provider?.domain ?? "");

    setClientId(provider?.oidcConfig?.clientId ?? "");
    setDiscoveryEndpoint(provider?.oidcConfig?.discoveryEndpoint ?? "");
    setEntryPoint(provider?.samlConfig?.entryPoint ?? "");

    // Sensitive credentials are intentionally never prefilled.
    setClientSecret("");
    setCertificate("");
  }, [open, provider]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && saving) return;

    if (!nextOpen) {
      resetForm();
    }

    onOpenChange(nextOpen);
  };

  const normalizedProviderId = providerId.trim();
  const normalizedIssuer = issuer.trim();
  const normalizedDomain = domain.trim().toLowerCase();
  const normalizedClientId = clientId.trim();
  const normalizedDiscoveryEndpoint = discoveryEndpoint.trim();
  const normalizedEntryPoint = entryPoint.trim();
  const normalizedCertificate = certificate.trim();

  const hasCommonFields =
    normalizedProviderId.length > 0 &&
    normalizedIssuer.length > 0 &&
    normalizedDomain.length > 0;

  const hasCreateCredentials =
    protocol === "saml"
      ? normalizedEntryPoint.length > 0 && normalizedCertificate.length > 0
      : normalizedClientId.length > 0 && clientSecret.length > 0;

  const canSubmit =
    hasCommonFields &&
    Boolean(organizationId) &&
    (isEditing || hasCreateCredentials);

  const saveProvider = async () => {
    if (!canSubmit || saving) return;

    setSaving(true);

    try {
      if (isEditing && provider) {
        const oidcConfig = {
          ...(normalizedClientId ? { clientId: normalizedClientId } : {}),
          ...(clientSecret ? { clientSecret } : {}),
          ...(normalizedDiscoveryEndpoint
            ? {
                discoveryEndpoint: normalizedDiscoveryEndpoint,
              }
            : {}),
        };

        const samlConfig = {
          ...(normalizedEntryPoint ? { entryPoint: normalizedEntryPoint } : {}),
          ...(normalizedCertificate ? { cert: normalizedCertificate } : {}),
        };

        await ssoRequest<Provider>("/sso/update-provider", {
          method: "PATCH",
          body: JSON.stringify({
            providerId: provider.providerId,
            issuer: normalizedIssuer,
            domain: normalizedDomain,
            organizationId,
            protocol,
            ...(protocol === "saml"
              ? {
                  samlConfig,
                }
              : {
                  oidcConfig,
                }),
          }),
        });

        toast.success("SSO provider updated");
      } else {
        const body =
          protocol === "saml"
            ? {
                providerId: normalizedProviderId,
                issuer: normalizedIssuer,
                domain: normalizedDomain,
                organizationId,
                samlConfig: {
                  entryPoint: normalizedEntryPoint,
                  cert: normalizedCertificate,
                  callbackUrl: getServerApiUrl(
                    `/api/auth/sso/saml2/sp/acs/${normalizedProviderId}`,
                  ),
                  spMetadata: {
                    entityID: getServerApiUrl(
                      `/api/auth/sso/saml2/sp/metadata?providerId=${encodeURIComponent(
                        normalizedProviderId,
                      )}`,
                    ),
                  },
                },
              }
            : {
                providerId: normalizedProviderId,
                issuer: normalizedIssuer,
                domain: normalizedDomain,
                organizationId,
                oidcConfig: {
                  clientId: normalizedClientId,
                  clientSecret,
                  discoveryEndpoint: normalizedDiscoveryEndpoint || undefined,
                  pkce: true,
                  scopes: ["openid", "email", "profile"],
                },
              };

        const result = await ssoRequest<
          Provider & {
            domainVerificationToken?: string;
          }
        >("/sso/register", {
          method: "POST",
          body: JSON.stringify(body),
        });

        toast.success("SSO provider registered");

        if (result.domainVerificationToken) {
          toast.info(
            `Add TXT _upstand-sso.${normalizedDomain} = ${result.domainVerificationToken}`,
          );
        }
      }

      await onSaved();
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isEditing
            ? "Unable to update SSO provider"
            : "Unable to register SSO provider",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-bold text-xl">
            {isEditing ? "Edit SSO Provider" : "Register SSO Provider"}
          </DialogTitle>

          <DialogDescription className="text-muted-foreground text-sm">
            {isEditing
              ? "Update the provider configuration. Leave secret or certificate fields blank to retain their currently stored values."
              : "Configure an organization-scoped OIDC or SAML identity provider and generate its DNS verification challenge."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void saveProvider();
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="saml-mode">Use SAML instead of OIDC</Label>

              <p className="text-muted-foreground text-xs">
                {isEditing
                  ? "The provider protocol cannot be changed after registration."
                  : "Enable this when your identity provider requires SAML service-provider metadata."}
              </p>
            </div>

            <Switch
              id="saml-mode"
              checked={protocol === "saml"}
              disabled={isEditing || saving}
              onCheckedChange={(checked) =>
                setProtocol(checked ? "saml" : "oidc")
              }
            />
          </div>

          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="provider-id">Provider ID</FieldLabel>

              <Input
                id="provider-id"
                value={providerId}
                disabled={isEditing || saving}
                onChange={(event) => setProviderId(event.target.value)}
                placeholder="company-oidc"
                autoComplete="off"
                autoFocus={!isEditing}
                required
              />

              {isEditing ? (
                <p className="text-muted-foreground text-xs">
                  Provider IDs cannot be renamed.
                </p>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="sso-domain">Email Domain</FieldLabel>

              <Input
                id="sso-domain"
                value={domain}
                disabled={saving}
                onChange={(event) => setDomain(event.target.value)}
                placeholder="example.com"
                autoComplete="off"
                required
              />
            </Field>

            <Field className="md:col-span-2">
              <FieldLabel htmlFor="issuer">Issuer</FieldLabel>

              <Input
                id="issuer"
                value={issuer}
                disabled={saving}
                onChange={(event) => setIssuer(event.target.value)}
                placeholder="https://idp.example.com"
                autoComplete="off"
                required
              />
            </Field>

            {protocol === "saml" ? (
              <>
                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="entry-point">
                    SAML Entry Point
                    {isEditing ? (
                      <span className="ml-1 font-normal text-muted-foreground">
                        (optional)
                      </span>
                    ) : null}
                  </FieldLabel>

                  <Input
                    id="entry-point"
                    value={entryPoint}
                    disabled={saving}
                    onChange={(event) => setEntryPoint(event.target.value)}
                    placeholder="https://idp.example.com/sso"
                    required={!isEditing}
                  />
                </Field>

                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="certificate">
                    IdP Certificate
                    {isEditing ? (
                      <span className="ml-1 font-normal text-muted-foreground">
                        (leave blank to retain)
                      </span>
                    ) : null}
                  </FieldLabel>

                  <Textarea
                    id="certificate"
                    value={certificate}
                    disabled={saving}
                    onChange={(event) => setCertificate(event.target.value)}
                    placeholder="-----BEGIN CERTIFICATE-----"
                    spellCheck={false}
                    rows={8}
                    required={!isEditing}
                    className="font-mono text-xs"
                  />
                </Field>
              </>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="client-id">
                    Client ID
                    {isEditing ? (
                      <span className="ml-1 font-normal text-muted-foreground">
                        (optional)
                      </span>
                    ) : null}
                  </FieldLabel>

                  <Input
                    id="client-id"
                    value={clientId}
                    disabled={saving}
                    onChange={(event) => setClientId(event.target.value)}
                    autoComplete="off"
                    required={!isEditing}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="client-secret">
                    Client Secret
                    {isEditing ? (
                      <span className="ml-1 font-normal text-muted-foreground">
                        (leave blank to retain)
                      </span>
                    ) : null}
                  </FieldLabel>

                  <Input
                    id="client-secret"
                    type="password"
                    value={clientSecret}
                    disabled={saving}
                    onChange={(event) => setClientSecret(event.target.value)}
                    autoComplete="new-password"
                    required={!isEditing}
                  />
                </Field>

                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="discovery">
                    Discovery Endpoint
                    <span className="ml-1 font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </FieldLabel>

                  <Input
                    id="discovery"
                    value={discoveryEndpoint}
                    disabled={saving}
                    onChange={(event) =>
                      setDiscoveryEndpoint(event.target.value)
                    }
                    placeholder="https://idp.example.com/.well-known/openid-configuration"
                    autoComplete="off"
                  />
                </Field>
              </>
            )}
          </FieldGroup>

          {isEditing ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-muted-foreground text-xs">
              Sensitive credentials are not returned to the browser. Blank
              credential fields must be treated by the update endpoint as “keep
              the stored value.”
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>

            <Button
              type="submit"
              disabled={!canSubmit || saving}
              className="gap-2"
            >
              {saving ? <Spinner data-icon="inline-start" /> : null}

              {saving
                ? isEditing
                  ? "Saving…"
                  : "Registering…"
                : isEditing
                  ? "Save Changes"
                  : "Register & Generate DNS Challenge"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SsoSettingsPage() {
  const organizationState = useRequiredActiveOrganization();

  const organizationId = organizationState.organizationId as string;

  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);

  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(
    null,
  );

  const [verificationTokens, setVerificationTokens] = useState<
    Record<string, string>
  >({});

  const [providerAction, setProviderAction] = useState<ProviderAction>(null);

  const [pendingRemove, setPendingRemove] = useState<Provider | null>(null);
  const [removing, setRemoving] = useState(false);

  const settings = useQuery({
    ...trpc.sso.getSettings.queryOptions({
      organizationId,
    }),
    enabled: organizationState.status === "ready",
  });

  const updateSettings = useMutation({
    ...trpc.sso.updateSettings.mutationOptions(),
    onSuccess: () => {
      void settings.refetch();
      toast.success("SSO enforcement updated");
    },
    onError: (error) => toast.error(error.message),
  });

  const refreshProviders = useCallback(async () => {
    if (!organizationId) return;

    setProvidersLoading(true);
    setProvidersError(null);

    try {
      const result = await ssoRequest<{
        providers?: Provider[];
      }>(`/sso/providers?organizationId=${encodeURIComponent(organizationId)}`);

      setProviders(result.providers ?? []);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load SSO providers";

      setProvidersError(message);
      toast.error(message);
    } finally {
      setProvidersLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    setProviders([]);
    setVerificationTokens({});

    if (organizationState.status === "ready") {
      void refreshProviders();
    }
  }, [organizationState.status, refreshProviders]);

  const openCreateDialog = () => {
    setSelectedProvider(null);
    setProviderDialogOpen(true);
  };

  const openEditDialog = (provider: Provider) => {
    setSelectedProvider(provider);
    setProviderDialogOpen(true);
  };

  const handleProviderDialogChange = (open: boolean) => {
    setProviderDialogOpen(open);

    if (!open) {
      setSelectedProvider(null);
    }
  };

  const requestVerification = async (provider: Provider) => {
    setProviderAction({
      type: "challenge",
      providerId: provider.providerId,
    });

    try {
      const result = await ssoRequest<{
        domainVerificationToken: string;
      }>("/sso/request-domain-verification", {
        method: "POST",
        body: JSON.stringify({
          providerId: provider.providerId,
        }),
      });

      setVerificationTokens((current) => ({
        ...current,
        [provider.providerId]: result.domainVerificationToken,
      }));

      toast.info(
        `Add TXT _upstand-sso.${provider.domain} = ${result.domainVerificationToken}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to issue DNS challenge",
      );
    } finally {
      setProviderAction(null);
    }
  };

  const verify = async (providerId: string) => {
    setProviderAction({
      type: "verify",
      providerId,
    });

    try {
      await ssoRequest("/sso/verify-domain", {
        method: "POST",
        body: JSON.stringify({ providerId }),
      });

      toast.success("SSO domain verified");

      await refreshProviders();
      void settings.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Domain verification failed",
      );
    } finally {
      setProviderAction(null);
    }
  };

  const remove = async () => {
    if (!pendingRemove || removing) return;

    setRemoving(true);

    try {
      await ssoRequest("/sso/delete-provider", {
        method: "POST",
        body: JSON.stringify({
          providerId: pendingRemove.providerId,
        }),
      });

      toast.success("SSO provider removed");

      setPendingRemove(null);
      await refreshProviders();
      void settings.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to remove SSO provider",
      );
    } finally {
      setRemoving(false);
    }
  };

  const isActionPending = (type: "challenge" | "verify", providerId: string) =>
    providerAction?.type === type && providerAction.providerId === providerId;

  return (
    <DashboardPage className="flex-1">
      <DashboardPageHeader
        title="Single Sign-On"
        description="Register organization-scoped OIDC or SAML providers, verify ownership, and enforce provider sign-in."
        icon={<ShieldCheck className="size-6 text-primary" />}
        actions={
          <Button
            onClick={openCreateDialog}
            disabled={!organizationId}
            className="gap-2 font-medium"
          >
            <PlusIcon data-icon="inline-start" />
            Register Provider
          </Button>
        }
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Organization Enforcement</CardTitle>

            <CardDescription>
              Password sign-in is rejected for members after a verified provider
              is available.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="sso-enforced">
                Require SSO for this organization
              </Label>

              <p className="text-muted-foreground text-xs">
                Members must use a verified organization SSO provider to sign
                in.
              </p>
            </div>

            <Switch
              id="sso-enforced"
              checked={settings.data?.enforced === true}
              disabled={
                !organizationId ||
                settings.isPending ||
                updateSettings.isPending
              }
              onCheckedChange={(enforced) =>
                updateSettings.mutate({
                  organizationId,
                  enforced,
                })
              }
            />
          </CardContent>
        </Card>

        <div>
          {providersLoading
            ? Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>

                  <Skeleton className="h-8 w-24" />
                </div>
              ))
            : null}

          {!providersLoading && providersError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="font-medium text-destructive text-sm">
                Failed to load SSO providers
              </p>

              <p className="mt-1 text-muted-foreground text-sm">
                {providersError}
              </p>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void refreshProviders()}
              >
                Try Again
              </Button>
            </div>
          ) : null}

          {!providersLoading &&
            !providersError &&
            providers.map((provider) => {
              const challengePending = isActionPending(
                "challenge",
                provider.providerId,
              );

              const verificationPending = isActionPending(
                "verify",
                provider.providerId,
              );

              const verificationToken =
                verificationTokens[provider.providerId] ||
                provider.domainVerificationToken;

              return (
                <div
                  key={provider.providerId}
                  className="rounded-lg border p-4 text-sm"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">
                          {provider.providerId}
                        </p>

                        <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-[10px] text-muted-foreground uppercase">
                          {getProviderProtocol(provider)}
                        </span>

                        <span
                          className={
                            provider.domainVerified
                              ? "rounded-full bg-success/10 px-2 py-0.5 font-medium text-[10px] text-success uppercase"
                              : "rounded-full bg-warning/10 px-2 py-0.5 font-medium text-[10px] text-warning uppercase"
                          }
                        >
                          {provider.domainVerified ? "Verified" : "Unverified"}
                        </span>
                      </div>

                      <p className="mt-1 break-all text-muted-foreground text-xs">
                        {provider.domain} · {provider.issuer}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {!provider.domainVerified ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={challengePending || verificationPending}
                            onClick={() => void requestVerification(provider)}
                          >
                            {challengePending ? (
                              <Spinner data-icon="inline-start" />
                            ) : null}
                            DNS Challenge
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            disabled={challengePending || verificationPending}
                            onClick={() => void verify(provider.providerId)}
                          >
                            {verificationPending ? (
                              <Spinner data-icon="inline-start" />
                            ) : null}
                            Verify DNS
                          </Button>
                        </>
                      ) : null}

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${provider.providerId}`}
                        onClick={() => openEditDialog(provider)}
                      >
                        <Edit2 aria-hidden="true" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${provider.providerId}`}
                        onClick={() => setPendingRemove(provider)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    </div>
                  </div>

                  {!provider.domainVerified && verificationToken ? (
                    <div className="mt-3 rounded-md bg-muted/50 p-3">
                      <p className="mb-1 font-medium text-xs">DNS TXT record</p>

                      <p className="break-all font-mono text-[11px] text-muted-foreground">
                        TXT _upstand-sso.
                        {provider.domain} = {verificationToken}
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}

          {!providersLoading && !providersError && providers.length === 0 ? (
            <PageEmpty
              icon={KeyRound}
              title="No SSO providers registered"
              description="Register an OIDC or SAML provider to enable organization Single Sign-On."
              action={
                <Button
                  onClick={openCreateDialog}
                  size="sm"
                  className="mt-1 gap-2"
                >
                  <PlusIcon data-icon="inline-start" />
                  Register Provider
                </Button>
              }
            />
          ) : null}
        </div>
      </div>

      <ProviderDialog
        open={providerDialogOpen}
        onOpenChange={handleProviderDialogChange}
        organizationId={organizationId}
        provider={selectedProvider}
        onSaved={refreshProviders}
      />

      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open && !removing) {
            setPendingRemove(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove SSO Provider?</AlertDialogTitle>

            <AlertDialogDescription>
              <span className="font-medium text-foreground">
                {pendingRemove?.providerId}
              </span>{" "}
              will be permanently removed. Members using this provider will no
              longer be able to start SSO sign-in for this organization.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>

            <AlertDialogAction
              disabled={removing}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {removing ? <Spinner data-icon="inline-start" /> : null}

              {removing ? "Removing…" : "Remove Provider"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardPage>
  );
}
