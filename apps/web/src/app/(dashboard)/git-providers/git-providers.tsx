"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getUpGalTargetDefinition } from "@upstand/api/ai/upgal-ui-targets";
import { Badge } from "@upstand/ui/components/badge";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@upstand/ui/components/field";
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
import { Switch } from "@upstand/ui/components/switch";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import { CardGridSkeleton } from "@/components/dashboard/page-skeleton";
import {
  ArrowRightIcon as ArrowRight,
  CheckCircle2,
  GitBranchIcon,
  PlusIcon,
  Trash2Icon,
} from "@/components/huge-icons";
import { UpGalTarget } from "@/components/upgal-target";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import type { authClient } from "@/lib/auth-client";
import {
  buildGithubAppManifest,
  getGithubAppInstallationUrl,
  getGithubAppManifestCreationUrl,
} from "@/lib/github-app";
import { safeExternalUrl } from "@/lib/safe-external-url";
import { getServerApiUrl, getServerUrl } from "@/lib/server-url";
import { trpc } from "@/utils/trpc";

const addGitProviderTarget = getUpGalTargetDefinition("add-git-provider");

type ProviderType = "github" | "gitlab" | "bitbucket" | "gitea";

export default function GitProviders({
  // biome-ignore lint/correctness/noUnusedFunctionParameters: session is received but not used directly in this view
  session,
}: {
  session: typeof authClient.$Infer.Session;
}) {
  const organizationState = useRequiredActiveOrganization();
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [providerType, setProviderType] = useState<ProviderType>("github");

  // Generic states
  const [name, setName] = useState("");

  // GitHub-specific state
  const [isOrganization, setIsOrganization] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [manifest, setManifest] = useState("");
  const [githubManifestState, setGithubManifestState] = useState("");

  // GitLab-specific state
  const [gitlabUrl, setGitlabUrl] = useState("https://gitlab.com");
  const [gitlabAppId, setGitlabAppId] = useState("");
  const [gitlabSecret, setGitlabSecret] = useState("");
  const [gitlabGroupName, setGitlabGroupName] = useState("");

  // Bitbucket-specific state
  const [bitbucketUsername, setBitbucketUsername] = useState("");
  const [bitbucketAppPassword, setBitbucketAppPassword] = useState("");
  const [bitbucketWorkspace, setBitbucketWorkspace] = useState("");

  // Gitea-specific state
  const [giteaUrl, setGiteaUrl] = useState("");
  const [giteaClientId, setGiteaClientId] = useState("");
  const [giteaClientSecret, setGiteaClientSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const [deleteProviderOpen, setDeleteProviderOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const orgId = organizationState.organizationId as string;

  const resetForms = () => {
    setName("");
    setIsOrganization(false);
    setOrgName("");
    setGitlabUrl("https://gitlab.com");
    setGitlabAppId("");
    setGitlabSecret("");
    setGitlabGroupName("");
    setBitbucketUsername("");
    setBitbucketAppPassword("");
    setBitbucketWorkspace("");
    setGiteaUrl("");
    setGiteaClientId("");
    setGiteaClientSecret("");
    setWebhookSecret("");
    setGithubManifestState("");
  };

  // Queries
  const {
    data: providers,
    isLoading: loadingProviders,
    refetch,
  } = useQuery({
    ...trpc.gitProvider.list.queryOptions({ organizationId: orgId }),
    enabled: organizationState.status === "ready",
  });

  const createMutation = useMutation({
    ...trpc.gitProvider.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Git Provider registered successfully");
      setAddProviderOpen(false);
      resetForms();
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to save Git Provider");
    },
  });

  const deleteMutation = useMutation({
    ...trpc.gitProvider.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Git Provider deleted successfully");
      setSelectedProvider(null);
      setDeleteProviderOpen(false);
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete Git Provider");
    },
  });

  const { mutateAsync: createGithubManifestState } = useMutation(
    trpc.gitProvider.createGithubManifestState.mutationOptions(),
  );

  // Manifest builder trigger
  const fetchManifestOptions = useCallback(async () => {
    if (!orgId) return;
    try {
      const state = await createGithubManifestState({
        organizationId: orgId,
      });
      setGithubManifestState(state.state);

      const serverUrl = getServerUrl();
      const manifestData = buildGithubAppManifest({
        organizationId: orgId,
        serverUrl,
        state: state.state,
      });
      setManifest(JSON.stringify(manifestData));
    } catch {
      toast.error("Failed to compile manifest setup details");
    }
  }, [createGithubManifestState, orgId]);

  useEffect(() => {
    if (addProviderOpen && providerType === "github") {
      void fetchManifestOptions();
    }
  }, [addProviderOpen, providerType, fetchManifestOptions]);

  const getGithubAppCreationUrl = () => {
    return getGithubAppManifestCreationUrl(
      isOrganization ? orgName : undefined,
      githubManifestState,
    );
  };

  const handleCreateNonGithub = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!orgId) {
      toast.error("No active organization selected");
      return;
    }
    if (!name.trim()) {
      toast.error("Please enter a name for the Git provider");
      return;
    }

    let config: Record<string, unknown> = {};
    if (providerType === "gitlab") {
      config = {
        gitlabUrl: gitlabUrl.trim() || "https://gitlab.com",
        applicationId: gitlabAppId.trim(),
        clientSecret: gitlabSecret.trim(),
        groupName: gitlabGroupName.trim() || null,
      };
    } else if (providerType === "bitbucket") {
      config = {
        bitbucketUsername: bitbucketUsername.trim(),
        bitbucketAppPassword: bitbucketAppPassword.trim(),
        bitbucketWorkspace: bitbucketWorkspace.trim() || null,
      };
    } else if (providerType === "gitea") {
      config = {
        giteaUrl: giteaUrl.trim(),
        clientId: giteaClientId.trim(),
        clientSecret: giteaClientSecret.trim(),
      };
    }

    createMutation.mutate({
      organizationId: orgId,
      name: name.trim(),
      provider: providerType,
      config: JSON.stringify({
        ...config,
        webhookSecret: webhookSecret.trim() || null,
      }),
    });
  };

  const handleDelete = () => {
    if (selectedProvider) {
      deleteMutation.mutate({ id: selectedProvider.id });
    }
  };

  const getInstallationManagementUrl = (
    provider: ProviderType,
    config: Record<string, unknown>,
  ): string => {
    const value = (key: string): string | undefined => {
      const candidate: unknown = config[key];
      return typeof candidate === "string" ? candidate : undefined;
    };
    if (provider === "github") {
      return (
        safeExternalUrl(
          `https://github.com/settings/installations/${encodeURIComponent(value("githubInstallationId") ?? "")}`,
        ) ?? "#"
      );
    }
    if (provider === "gitlab") {
      const baseUrl = safeExternalUrl(
        value("gitlabUrl") || "https://gitlab.com",
      );
      return baseUrl
        ? `${baseUrl.replace(/\/$/, "")}/profile/applications`
        : "#";
    }
    return "#";
  };

  return (
    <DashboardPage>
      {/* Header */}
      <DashboardPageHeader
        title="Git Providers"
        description="Connect GitHub, GitLab, Bitbucket, or Gitea to access repositories and deploy resources."
        icon={<GitBranchIcon className="size-6 text-primary" />}
        actions={
          <UpGalTarget definition={addGitProviderTarget}>
            <Button
              onClick={() => {
                resetForms();
                setProviderType("github");
                setAddProviderOpen(true);
              }}
              className="gap-2 font-medium"
            >
              <PlusIcon data-icon="inline-start" />
              Add Git Provider
            </Button>
          </UpGalTarget>
        }
      />

      {/* Main List */}
      {loadingProviders ? (
        <CardGridSkeleton count={2} className="grid gap-4 md:grid-cols-2" />
      ) : !orgId ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          Please select an organization to view Git providers.
        </div>
      ) : providers && providers.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {providers.map((provider) => {
            const config = JSON.parse(provider.config);
            const githubInstallUrl = getGithubAppInstallationUrl(config);
            let isInstalled = false;

            if (provider.provider === "github") {
              isInstalled = !!config.githubInstallationId;
            } else if (
              provider.provider === "gitlab" ||
              provider.provider === "gitea"
            ) {
              isInstalled = !!config.accessToken;
            } else if (provider.provider === "bitbucket") {
              isInstalled = true; // Bitbucket Credentials are ready instantly
            }

            return (
              <Card key={provider.id} className="flex h-full flex-col">
                <CardHeader className="gap-3 pb-3">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted font-semibold text-muted-foreground text-xs uppercase">
                      {provider.provider.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="truncate text-sm">
                            {provider.name}
                          </CardTitle>
                          <CardDescription className="mt-1 truncate text-xs capitalize">
                            {provider.provider} ·{" "}
                            {provider.provider === "github"
                              ? "GitHub App"
                              : provider.provider === "bitbucket"
                                ? "App password"
                                : "OAuth"}
                          </CardDescription>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setSelectedProvider({
                              id: provider.id,
                              name: provider.name,
                            });
                            setDeleteProviderOpen(true);
                          }}
                          className="-mt-2 -mr-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Delete ${provider.name}`}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge
                      variant={isInstalled ? "secondary" : "outline"}
                      className="gap-1.5"
                    >
                      <span
                        className={
                          isInstalled
                            ? "size-1.5 rounded-full bg-success"
                            : "size-1.5 rounded-full bg-muted-foreground"
                        }
                      />
                      {isInstalled ? "Connected" : "Needs setup"}
                    </Badge>
                    <span className="truncate text-muted-foreground">
                      {provider.provider === "github"
                        ? config.githubAppName || "GitHub App"
                        : provider.provider === "bitbucket"
                          ? config.bitbucketUsername || "Bitbucket account"
                          : config.gitlabUrl || config.giteaUrl}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4 pt-0">
                  <p className="text-muted-foreground text-xs">
                    {isInstalled
                      ? "Repository access is ready for deployments."
                      : "Authorize this provider to access repositories."}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    {!isInstalled ? (
                      provider.provider === "github" ? (
                        githubInstallUrl ? (
                          <a
                            href={githubInstallUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-primary text-xs hover:underline"
                          >
                            Install GitHub App
                            <ArrowRight className="size-4" />
                          </a>
                        ) : null
                      ) : (
                        <a
                          href={getServerApiUrl(
                            `/git-providers/oauth/authorize?id=${provider.id}`,
                          )}
                          className="inline-flex items-center gap-1.5 text-primary text-xs hover:underline"
                        >
                          Authorize via OAuth
                          <ArrowRight className="size-4" />
                        </a>
                      )
                    ) : (
                      <div className="flex items-center gap-3">
                        <Badge variant="success" className="gap-1">
                          <CheckCircle2 className="size-3" />
                          Connected
                        </Badge>
                        <a
                          href={getInstallationManagementUrl(
                            provider.provider as ProviderType,
                            config,
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-primary text-xs hover:underline"
                        >
                          Manage access
                        </a>
                      </div>
                    )}
                    <ArrowRight className="size-4" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <PageEmpty
          icon={GitBranchIcon}
          title="No Git providers yet"
          description="Connect GitHub, GitLab, Bitbucket, or Gitea to access repositories and deploy resources."
          action={
            <UpGalTarget definition={addGitProviderTarget}>
              <Button
                onClick={() => {
                  resetForms();
                  setProviderType("github");
                  setAddProviderOpen(true);
                }}
              >
                <PlusIcon data-icon="inline-start" />
                Add Git Provider
              </Button>
            </UpGalTarget>
          }
        />
      )}

      {/* Add Provider Dialog */}
      <Dialog open={addProviderOpen} onOpenChange={setAddProviderOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100vw-1rem)] max-w-[min(96vw,720px)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Git Provider</DialogTitle>
            <DialogDescription>
              Select your Git provider type and configure the credentials.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel>Provider Type</FieldLabel>
                <Select
                  value={providerType as string}
                  onValueChange={(val) => {
                    if (val) setProviderType(val as ProviderType);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Provider Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="github">
                      GitHub App (Manifest Flow)
                    </SelectItem>
                    <SelectItem value="gitlab">GitLab (OAuth Flow)</SelectItem>
                    <SelectItem value="bitbucket">
                      Bitbucket (Credentials)
                    </SelectItem>
                    <SelectItem value="gitea">Gitea (OAuth Flow)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>

            {/* GitHub App Manifest Form */}
            {providerType === "github" && (
              <form
                action={
                  githubManifestState ? getGithubAppCreationUrl() : undefined
                }
                method="post"
                className="flex flex-col gap-4"
              >
                <input
                  type="text"
                  name="manifest"
                  id="manifest"
                  value={manifest}
                  readOnly
                  className="hidden"
                />

                <div className="flex items-center justify-between rounded-lg">
                  <div className="space-y-0.5">
                    <Label htmlFor="is-org" className="font-medium text-sm">
                      Organization App
                    </Label>
                    <p className="text-muted-foreground text-xs">
                      Create this app for a GitHub Organization instead of
                      personal account.
                    </p>
                  </div>
                  <Switch
                    id="is-org"
                    checked={isOrganization}
                    onCheckedChange={setIsOrganization}
                  />
                </div>

                {isOrganization && (
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="org-name">
                        GitHub Organization Name
                      </FieldLabel>
                      <Input
                        id="org-name"
                        required
                        placeholder="e.g. my-awesome-org"
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                      />
                    </Field>
                  </FieldGroup>
                )}

                <DialogFooter className="flex items-center gap-2 pt-4 sm:justify-between">
                  <a
                    href={
                      isOrganization && orgName.trim()
                        ? `https://github.com/organizations/${encodeURIComponent(orgName.trim())}/settings/installations`
                        : "https://github.com/settings/installations"
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary text-xs hover:underline"
                  >
                    Unsure if already installed?
                  </a>
                  <Button
                    type="submit"
                    disabled={
                      (isOrganization && !orgName.trim()) ||
                      !githubManifestState
                    }
                    className="gap-1.5"
                  >
                    Create GitHub App
                    <ArrowRight className="size-4" />
                  </Button>
                </DialogFooter>
              </form>
            )}

            {/* Non-GitHub Forms */}
            {providerType !== "github" && (
              <form
                onSubmit={handleCreateNonGithub}
                className="flex flex-col gap-4"
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="name">Provider Name</FieldLabel>
                    <Input
                      id="name"
                      required
                      placeholder="e.g. My GitLab, Gitea Instance"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>

                  {/* GitLab Fields */}
                  {providerType === "gitlab" && (
                    <>
                      <Field>
                        <FieldLabel htmlFor="gitlab-url">GitLab URL</FieldLabel>
                        <Input
                          id="gitlab-url"
                          required
                          placeholder="https://gitlab.com"
                          value={gitlabUrl}
                          onChange={(e) => setGitlabUrl(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="gitlab-app-id">
                          Application ID (Client ID)
                        </FieldLabel>
                        <Input
                          id="gitlab-app-id"
                          required
                          placeholder="OAuth application ID"
                          value={gitlabAppId}
                          onChange={(e) => setGitlabAppId(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="gitlab-secret">
                          Client Secret
                        </FieldLabel>
                        <Input
                          id="gitlab-secret"
                          required
                          type="password"
                          placeholder="OAuth client secret"
                          value={gitlabSecret}
                          onChange={(e) => setGitlabSecret(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="gitlab-group">
                          Group Name (Optional)
                        </FieldLabel>
                        <Input
                          id="gitlab-group"
                          placeholder="Filter repositories by GitLab group slug"
                          value={gitlabGroupName}
                          onChange={(e) => setGitlabGroupName(e.target.value)}
                        />
                      </Field>
                    </>
                  )}

                  {/* Bitbucket Fields */}
                  {providerType === "bitbucket" && (
                    <>
                      <Field>
                        <FieldLabel htmlFor="bitbucket-username">
                          Bitbucket Username
                        </FieldLabel>
                        <Input
                          id="bitbucket-username"
                          required
                          placeholder="Bitbucket username"
                          value={bitbucketUsername}
                          onChange={(e) => setBitbucketUsername(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="bitbucket-app-pwd">
                          App Password
                        </FieldLabel>
                        <Input
                          id="bitbucket-app-pwd"
                          required
                          type="password"
                          placeholder="Bitbucket app password"
                          value={bitbucketAppPassword}
                          onChange={(e) =>
                            setBitbucketAppPassword(e.target.value)
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="bitbucket-workspace">
                          Workspace Name (Optional)
                        </FieldLabel>
                        <Input
                          id="bitbucket-workspace"
                          placeholder="Bitbucket workspace slug"
                          value={bitbucketWorkspace}
                          onChange={(e) =>
                            setBitbucketWorkspace(e.target.value)
                          }
                        />
                      </Field>
                    </>
                  )}

                  {/* Gitea Fields */}
                  {providerType === "gitea" && (
                    <>
                      <Field>
                        <FieldLabel htmlFor="gitea-url">
                          Gitea Server URL
                        </FieldLabel>
                        <Input
                          id="gitea-url"
                          required
                          placeholder="https://gitea.com or custom self-hosted URL"
                          value={giteaUrl}
                          onChange={(e) => setGiteaUrl(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="gitea-client-id">
                          Client ID
                        </FieldLabel>
                        <Input
                          id="gitea-client-id"
                          required
                          placeholder="Gitea OAuth Application Client ID"
                          value={giteaClientId}
                          onChange={(e) => setGiteaClientId(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="gitea-secret">
                          Client Secret
                        </FieldLabel>
                        <Input
                          id="gitea-secret"
                          required
                          type="password"
                          placeholder="Gitea OAuth Application Client Secret"
                          value={giteaClientSecret}
                          onChange={(e) => setGiteaClientSecret(e.target.value)}
                        />
                      </Field>
                    </>
                  )}

                  <Field>
                    <FieldLabel htmlFor="provider-webhook-secret">
                      Webhook signing secret (optional)
                    </FieldLabel>
                    <Input
                      id="provider-webhook-secret"
                      type="password"
                      placeholder="Use the same secret configured in the provider webhook"
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                    />
                    <FieldDescription>
                      Required for signed auto-deploy webhooks. It is stored in
                      the provider configuration.
                    </FieldDescription>
                  </Field>
                </FieldGroup>

                <DialogFooter className="gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddProviderOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? (
                      <>
                        <Spinner data-icon="inline-start" />
                        Registering…
                      </>
                    ) : (
                      "Save Provider"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={deleteProviderOpen}
        onOpenChange={(open) => {
          setDeleteProviderOpen(open);
          if (!open) setSelectedProvider(null);
        }}
        title="Delete Git Provider?"
        description={
          <>
            This will permanently delete{" "}
            <strong>{selectedProvider?.name}</strong> and stop Upstand from
            fetching repositories from it. This action cannot be undone.
          </>
        }
        actionLabel="Delete Provider"
        pending={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </DashboardPage>
  );
}
