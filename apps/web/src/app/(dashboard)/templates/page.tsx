"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getUpGalTargetDefinition } from "@upstand/api/ai/upgal-ui-targets";
import type { Template } from "@upstand/domain";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { Input } from "@upstand/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@upstand/ui/components/input-group";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Separator } from "@upstand/ui/components/separator";
import { Textarea } from "@upstand/ui/components/textarea";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import { PagePagination } from "@/components/dashboard/page-pagination";
import { CardGridSkeleton } from "@/components/dashboard/page-skeleton";
import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  Check,
  Code2,
  Download,
  FilePlus2,
  LayoutTemplate,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  Search,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "@/components/huge-icons";
import { CodeEditor, CodeSurface } from "@/components/shared/code-editor";
import { UpGalTarget } from "@/components/upgal-target";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { downloadText } from "@/lib/browser";
import { safeExternalUrl } from "@/lib/safe-external-url";
import { trpc } from "@/utils/trpc";

const DEFAULT_COMPOSE = `services:
  app:
    image: nginx:alpine
    ports:
      - "8080:80"
`;

const PROMPT_PRESETS = [
  "A production-ready Postgres database with persistent named storage",
  "A small Go API with Postgres and a private network",
  "A self-hosted analytics stack with a web UI and a database",
];

type EditorMode = "library" | "studio";
const createTemplateTarget = getUpGalTargetDefinition("create-template");
type TemplateRecord = Omit<Template, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
type DeployableTemplate = Pick<
  TemplateRecord,
  "id" | "name" | "description" | "tags"
> & {
  source: "custom" | "builtin";
  version?: string;
  logoUrl?: string;
  links?: Record<string, string | undefined>;
};

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function getServiceCount(composeFile: string): number {
  const servicesSection = composeFile.split(/^services:\s*$/m)[1];
  if (!servicesSection) return 0;
  return (servicesSection.match(/^ {2}[A-Za-z0-9_.-]+:\s*$/gm) ?? []).length;
}

export default function TemplatesPage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const importInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<EditorMode>("library");
  const [search, setSearch] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [templatePage, setTemplatePage] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [composeFile, setComposeFile] = useState(DEFAULT_COMPOSE);
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [generatedModel, setGeneratedModel] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [deployingSource, setDeployingSource] = useState<"custom" | "builtin">(
    "custom",
  );
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [serverId, setServerId] = useState("");
  const [buildServerId, setBuildServerId] = useState("");
  const [composeType, setComposeType] = useState<"stack" | "compose">("stack");
  const [resourceName, setResourceName] = useState("");
  const [appName, setAppName] = useState("");
  const [randomize, setRandomize] = useState(true);

  const templates = useQuery({
    ...trpc.template.list.queryOptions({
      organizationId,
      search: search.trim() || undefined,
      page: templatePage,
      pageSize: 12,
    }),
    enabled: organizationState.status === "ready",
  });
  const catalog = useQuery({
    ...trpc.template.catalog.queryOptions({
      search: search.trim() || undefined,
      page: catalogPage,
      pageSize: 12,
    }),
    enabled: organizationState.status === "ready",
    staleTime: 15 * 60 * 1000,
  });
  const projects = useQuery({
    ...trpc.project.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });
  const environments = useQuery({
    ...trpc.environment.list.queryOptions({ projectId }),
    enabled: Boolean(projectId),
  });
  const servers = useQuery({
    ...trpc.server.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });
  const aiSettings = useQuery({
    ...trpc.ai.listProviders.queryOptions({ organizationId }),
    enabled: Boolean(organizationId),
  });

  const clearEditor = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setTags("");
    setComposeFile(DEFAULT_COMPOSE);
    setGenerationPrompt("");
    setGeneratedModel(null);
  };

  const openNewEditor = () => {
    clearEditor();
    setMode("studio");
  };

  const openEditor = (
    template: NonNullable<typeof templates.data>["items"][number],
  ) => {
    setEditingId(template.id);
    setName(template.name);
    setDescription(template.description ?? "");
    setTags(template.tags.join(", "));
    setComposeFile(template.composeFile);
    setGeneratedModel(null);
    setMode("studio");
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCatalogPage(1);
    setTemplatePage(1);
  };

  const handleClearSearch = () => handleSearchChange("");

  const create = useMutation({
    ...trpc.template.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Template saved to your organization catalog");
      clearEditor();
      setMode("library");
      void templates.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const update = useMutation({
    ...trpc.template.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Template updated");
      clearEditor();
      setMode("library");
      void templates.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const generate = useMutation({
    ...trpc.ai.generateTemplate.mutationOptions(),
    onSuccess: (result) => {
      setComposeFile(result.composeFile);
      if (!name.trim()) setName("Generated Compose template");
      setGeneratedModel(result.model);
      toast.success(
        "Draft generated and safety-checked. Review it before saving.",
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    ...trpc.template.remove.mutationOptions(),
    onSuccess: () => {
      toast.success("Template deleted");
      setDeleteTarget(null);
      void templates.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const deploy = useMutation({
    ...trpc.template.deploy.mutationOptions(),
    onSuccess: () => {
      toast.success("Deployment queued. Track its progress in Deployments.");
      setDeployingId(null);
      setDeployingSource("custom");
      setProjectId("");
      setEnvironmentId("");
      setServerId("");
      setBuildServerId("");
    },
    onError: (error) => toast.error(error.message),
  });

  const selectedTemplate: DeployableTemplate | undefined =
    deployingSource === "builtin"
      ? catalog.data?.items.find((template) => template.id === deployingId)
      : (() => {
          const template = templates.data?.items.find(
            (candidate) => candidate.id === deployingId,
          );
          return template
            ? { ...template, source: "custom" as const }
            : undefined;
        })();
  const readyServers = (servers.data ?? []).filter(
    (server) => server.status === "ready",
  );
  const aiReady = Boolean(
    aiSettings.data?.some(
      (provider) => provider.configured && provider.enabled,
    ),
  );
  const isSaving = create.isPending || update.isPending;
  const canGenerate = Boolean(
    organizationId &&
      generationPrompt.trim().length >= 8 &&
      !generate.isPending,
  );
  const serviceCount = useMemo(
    () => getServiceCount(composeFile),
    [composeFile],
  );

  const importComposeFile = async (file: File) => {
    if (!/\.(ya?ml)$/i.test(file.name)) {
      toast.error("Choose a .yml or .yaml Compose file");
      return;
    }
    if (file.size > 1_048_576) {
      toast.error("Compose files must not exceed 1 MiB");
      return;
    }
    try {
      setComposeFile(await file.text());
      if (!name.trim()) setName(file.name.replace(/\.ya?ml$/i, ""));
      setGeneratedModel(null);
      setMode("studio");
      toast.success(
        "Compose file loaded. The server will validate it when saved.",
      );
    } catch {
      toast.error("The Compose file could not be read");
    }
  };

  const exportTemplate = (template: { name: string; composeFile: string }) => {
    downloadText(
      template.composeFile,
      `${slug(template.name) || "compose-template"}.yaml`,
      "application/x-yaml;charset=utf-8",
    );
  };

  const submitEditor = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId) return toast.error("Select an organization first");
    if (!name.trim()) return toast.error("Template name is required");
    if (!composeFile.trim()) return toast.error("Compose YAML is required");
    const input = {
      organizationId,
      name: name.trim(),
      description: description.trim() || null,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      composeFile,
    };
    if (editingId) update.mutate({ ...input, id: editingId });
    else create.mutate(input);
  };

  return (
    <DashboardPage className="gap-5 sm:gap-6">
      <DashboardPageHeader
        title="Templates"
        icon={
          <LayoutTemplate className="size-6 text-primary" aria-hidden="true" />
        }
        description="Build reusable Compose blueprints, generate safe drafts with UpGal, and deploy them to any environment."
        actions={
          <>
            {mode === "studio" && (
              <Button variant="outline" onClick={() => setMode("library")}>
                <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                Back to catalog
              </Button>
            )}
            <UpGalTarget definition={createTemplateTarget}>
              <Button onClick={openNewEditor}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                New template
              </Button>
            </UpGalTarget>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Saved templates"
          value={templates.data?.total ?? 0}
          icon={<Boxes aria-hidden="true" />}
        />
        <MetricCard
          label="Built-in catalog"
          value={catalog.data?.total ?? 0}
          icon={<FilePlus2 aria-hidden="true" />}
        />
        <MetricCard
          label="AI generation"
          value={aiReady ? "Ready" : "Setup needed"}
          icon={<Sparkles aria-hidden="true" />}
          accent={!aiReady}
        />
      </div>

      {mode === "studio" ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="border-b bg-muted/15">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>
                    {editingId ? "Edit template" : "Create a template"}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Compose YAML is checked for syntax and unsafe host access
                    before it is stored.
                  </CardDescription>
                </div>
                {editingId && (
                  <Badge variant="outline">Editing saved template</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <form className="space-y-6" onSubmit={submitEditor}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="template-name">Name</Label>
                    <Input
                      id="template-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Production web stack"
                      maxLength={120}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-tags">Tags</Label>
                    <Input
                      id="template-tags"
                      value={tags}
                      onChange={(event) => setTags(event.target.value)}
                      placeholder="web, postgres, production"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-description">Description</Label>
                  <Input
                    id="template-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="What this blueprint is for and what it expects"
                    maxLength={500}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Label htmlFor="template-compose">Compose YAML</Label>
                      <p className="mt-1 text-muted-foreground text-xs">
                        Named volumes and networks are supported; host binds and
                        Docker socket mounts are blocked.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => importInputRef.current?.click()}
                    >
                      <Upload data-icon="inline-start" aria-hidden="true" />
                      Import YAML
                    </Button>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".yaml,.yml,application/yaml,text/yaml"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void importComposeFile(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </div>
                  <CodeSurface className="[&_.cm-editor]:min-h-[28rem]">
                    <CodeEditor
                      id="template-compose"
                      value={composeFile}
                      onChange={(value) => {
                        setComposeFile(value);
                        setGeneratedModel(null);
                      }}
                      language="yaml"
                      lineWrapping
                      aria-label="Docker Compose YAML"
                    />
                  </CodeSurface>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Code2 className="size-4" aria-hidden="true" />
                    {serviceCount} service{serviceCount === 1 ? "" : "s"}{" "}
                    detected in draft
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        clearEditor();
                        setMode("library");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSaving || !organizationId}
                    >
                      {isSaving && (
                        <Loader2
                          className="animate-spin"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />
                      )}
                      {editingId ? "Update template" : "Save template"}
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>

          <aside className="space-y-5">
            <Card className="border-primary/25 bg-primary/[0.035]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <WandSparkles
                    className="size-4 text-primary"
                    aria-hidden="true"
                  />
                  Generate with UpGal
                </CardTitle>
                <CardDescription>
                  Describe the stack in plain language. UpGal returns YAML only,
                  then the same server safety validator checks it.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!aiReady && !aiSettings.isPending && (
                  <Alert>
                    <AlertCircle className="size-4" aria-hidden="true" />
                    <AlertTitle>AI provider not configured</AlertTitle>
                    <AlertDescription>
                      Add a provider in{" "}
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => {
                          window.dispatchEvent(
                            new CustomEvent("open-settings-dialog", {
                              detail: { page: "upgal" },
                            }),
                          );
                        }}
                      >
                        AI settings
                      </button>{" "}
                      to generate drafts.
                    </AlertDescription>
                  </Alert>
                )}
                <Textarea
                  value={generationPrompt}
                  onChange={(event) => setGenerationPrompt(event.target.value)}
                  placeholder="A small Go API with Postgres and a private network"
                  className="min-h-28 resize-y"
                  maxLength={2000}
                  aria-label="Describe the Compose template to generate"
                />
                <div className="flex flex-wrap gap-1.5">
                  {PROMPT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="rounded-full border px-2.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                      onClick={() => setGenerationPrompt(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <Button
                  type="button"
                  className="w-full"
                  variant="outline"
                  disabled={!canGenerate || !aiReady}
                  onClick={() =>
                    generate.mutate({
                      organizationId,
                      request: generationPrompt.trim(),
                    })
                  }
                >
                  {generate.isPending ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                  ) : (
                    <Sparkles data-icon="inline-start" aria-hidden="true" />
                  )}
                  {generate.isPending ? "Generating draft…" : "Generate draft"}
                </Button>
                {generatedModel && (
                  <p className="flex items-center gap-1.5 text-success text-xs">
                    <Check className="size-3.5" aria-hidden="true" />
                    Generated and validated with {generatedModel}. Review before
                    saving.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Studio checklist</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ChecklistItem
                  done={Boolean(name.trim())}
                  label="Name the blueprint"
                />
                <ChecklistItem
                  done={serviceCount > 0}
                  label="Define at least one service"
                />
                <ChecklistItem
                  done={Boolean(composeFile.trim())}
                  label="Keep the Compose file non-empty"
                />
                <p className="pt-1 text-muted-foreground text-xs leading-relaxed">
                  The authoritative syntax and safety checks run on the server
                  when you save.
                </p>
              </CardContent>
            </Card>
          </aside>
        </section>
      ) : (
        <>
          <Card>
            <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Built-in catalog</CardTitle>
                <CardDescription className="mt-1">
                  {catalog.data?.total ?? 0} maintained open-source templates,
                  imported locally and ready to deploy without an external
                  catalog.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {catalog.isPending ? (
                <CardGridSkeleton
                  count={4}
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                />
              ) : catalog.isError ? (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>Catalog unavailable</AlertTitle>
                  <AlertDescription>
                    The built-in catalog could not be loaded. Saved templates
                    remain available; reload the page to retry.
                  </AlertDescription>
                </Alert>
              ) : catalog.data?.items.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
                  {catalog.data.items.map((template) => {
                    const githubUrl = safeExternalUrl(template.links?.github);
                    return (
                      <article
                        key={template.id}
                        className="flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/10 p-4 transition-colors hover:border-primary/35 hover:bg-primary/[0.025]"
                      >
                        <div className="flex items-start gap-3">
                          <TemplateLogo
                            name={template.name}
                            src={template.logoUrl}
                          />
                          <div className="min-w-0">
                            <h3 className="truncate font-medium">
                              {template.name}
                            </h3>
                            <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                              {template.description}
                            </p>
                          </div>
                        </div>
                        <div className="flex min-h-6 flex-wrap gap-1">
                          {template.tags.slice(0, 4).map((tag) => (
                            <Badge
                              key={tag}
                              variant="secondary"
                              className="text-[10px]"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-auto flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">
                              {template.version}
                            </span>
                            {githubUrl && (
                              <a
                                href={githubUrl}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open ${template.name} on GitHub`}
                                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <GithubMark />
                              </a>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => {
                              setDeployingSource("builtin");
                              setDeployingId(template.id);
                              setResourceName(template.name);
                              setAppName(slug(template.name));
                            }}
                          >
                            <Rocket
                              data-icon="inline-start"
                              aria-hidden="true"
                            />{" "}
                            Deploy
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <PageEmpty
                  icon={Search}
                  title="No catalog matches"
                  description="Try a different search term."
                />
              )}
              {catalog.data && catalog.data.pageCount > 1 && (
                <PagePagination
                  className="mt-2"
                  page={catalog.data.page}
                  pageSize={12}
                  total={catalog.data.total}
                  onPageChange={setCatalogPage}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Your catalog</CardTitle>
                <CardDescription className="mt-1">
                  Saved blueprints are scoped to the active organization.
                </CardDescription>
              </div>
              <InputGroup className="w-full sm:w-72">
                <InputGroupInput
                  value={search}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  placeholder="Search templates"
                  aria-label="Search templates"
                />
                <InputGroupAddon align="inline-start">
                  <Search className="size-4" aria-hidden="true" />
                </InputGroupAddon>
                {search ? (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      type="button"
                      size="icon-xs"
                      aria-label="Clear search"
                      onClick={handleClearSearch}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </InputGroupButton>
                  </InputGroupAddon>
                ) : null}
              </InputGroup>
            </CardHeader>
            <CardContent>
              {templates.isPending ? (
                <CardGridSkeleton
                  count={4}
                  className="grid gap-3 lg:grid-cols-2"
                />
              ) : templates.data?.items.length ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {templates.data.items.map((template) => (
                    <article
                      key={template.id}
                      className="group flex min-w-0 flex-col rounded-xl border p-4 transition-colors hover:border-primary/35"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <Code2 className="size-4" aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="truncate font-medium">
                              {template.name}
                            </h3>
                            <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                              {template.description || "No description"}
                            </p>
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {getServiceCount(template.composeFile)} services
                        </Badge>
                      </div>
                      <div className="mt-3 flex min-h-6 flex-wrap gap-1">
                        {template.tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <Separator className="my-4" />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-muted-foreground text-xs">
                          Updated{" "}
                          {new Date(template.updatedAt).toLocaleDateString()}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditor(template)}
                          >
                            <Pencil
                              data-icon="inline-start"
                              aria-hidden="true"
                            />{" "}
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => exportTemplate(template)}
                          >
                            <Download
                              data-icon="inline-start"
                              aria-hidden="true"
                            />{" "}
                            Export
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setDeployingSource("custom");
                              setDeployingId(template.id);
                              setResourceName(template.name);
                              setAppName(slug(template.name));
                            }}
                          >
                            <Rocket
                              data-icon="inline-start"
                              aria-hidden="true"
                            />{" "}
                            Deploy
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Delete ${template.name}`}
                            onClick={() =>
                              setDeleteTarget({
                                id: template.id,
                                name: template.name,
                              })
                            }
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <PageEmpty
                  icon={search ? Search : Plus}
                  title={search ? "No templates match" : "No templates yet"}
                  description={
                    search
                      ? "Try another search term."
                      : "Create a template or import a Compose file to get started."
                  }
                  action={
                    !search ? (
                      <Button onClick={openNewEditor}>
                        <Plus data-icon="inline-start" aria-hidden="true" />{" "}
                        Create Template
                      </Button>
                    ) : undefined
                  }
                />
              )}
              {templates.data && templates.data.pageCount > 1 && (
                <PagePagination
                  page={templates.data.page}
                  pageSize={12}
                  total={templates.data.total}
                  onPageChange={setTemplatePage}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the saved blueprint. Existing resources
              created from it are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                deleteTarget &&
                remove.mutate({ organizationId, id: deleteTarget.id })
              }
            >
              {remove.isPending && (
                <Loader2
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden="true"
                />
              )}
              Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedTemplate && (
        <DeployDialog
          template={selectedTemplate}
          open
          projects={projects.data ?? []}
          environments={environments.data ?? []}
          servers={readyServers}
          projectId={projectId}
          environmentId={environmentId}
          serverId={serverId}
          buildServerId={buildServerId}
          composeType={composeType}
          resourceName={resourceName}
          appName={appName}
          randomize={randomize}
          isPending={deploy.isPending}
          onClose={() => setDeployingId(null)}
          onProjectChange={(value) => {
            setProjectId(value);
            setEnvironmentId("");
          }}
          onEnvironmentChange={setEnvironmentId}
          onServerChange={setServerId}
          onBuildServerChange={setBuildServerId}
          onComposeTypeChange={setComposeType}
          onResourceNameChange={setResourceName}
          onAppNameChange={setAppName}
          onRandomizeChange={setRandomize}
          onDeploy={() =>
            deploy.mutate({
              organizationId,
              templateId: selectedTemplate.id,
              source: selectedTemplate.source,
              environmentId,
              resourceName: resourceName.trim(),
              appName: appName.trim(),
              composeType,
              serverId: serverId || undefined,
              buildServerId: buildServerId || null,
              randomize,
            })
          }
        />
      )}
    </DashboardPage>
  );
}

function MetricCard({
  label,
  value,
  icon,
  accent = false,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-xs">{label}</p>
          <p
            className={`mt-1 font-semibold text-lg ${accent ? "text-warning" : ""}`}
          >
            {value}
          </p>
        </div>
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

function TemplateLogo({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  const safeSrc = safeExternalUrl(src);
  return (
    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background text-primary">
      {safeSrc && !failed ? (
        // biome-ignore lint/performance/noImgElement: Catalog logos are external repository assets and need a native fallback on load failure.
        <img
          src={safeSrc}
          alt={`${name} logo`}
          width={36}
          height={36}
          loading="lazy"
          className="size-8 object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Code2 className="size-4" aria-hidden="true" />
      )}
    </div>
  );
}

function GithubMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4 fill-current"
      role="img"
    >
      <title>GitHub</title>
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.26c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.28c0 .32.22.69.83.57A12 12 0 0 0 12 .5" />
    </svg>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex size-5 items-center justify-center rounded-full border ${done ? "border-success bg-success text-success-foreground" : "text-muted-foreground"}`}
      >
        {done ? (
          <Check className="size-3" aria-hidden="true" />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        )}
      </span>
      <span className={done ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );
}

function SectionHeading({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-[11px] text-primary">
        {step}
      </span>
      <div>
        <h3 className="font-medium text-sm">{title}</h3>
        <p className="mt-1 text-muted-foreground text-xs">{description}</p>
      </div>
    </div>
  );
}

type DeployDialogProps = {
  template: DeployableTemplate;
  open: boolean;
  projects: { id: string; name: string }[];
  environments: { id: string; name: string }[];
  servers: { id: string; name: string; serverType: string }[];
  projectId: string;
  environmentId: string;
  serverId: string;
  buildServerId: string;
  composeType: "stack" | "compose";
  resourceName: string;
  appName: string;
  randomize: boolean;
  isPending: boolean;
  onClose: () => void;
  onProjectChange: (value: string) => void;
  onEnvironmentChange: (value: string) => void;
  onServerChange: (value: string) => void;
  onBuildServerChange: (value: string) => void;
  onComposeTypeChange: (value: "stack" | "compose") => void;
  onResourceNameChange: (value: string) => void;
  onAppNameChange: (value: string) => void;
  onRandomizeChange: (value: boolean) => void;
  onDeploy: () => void;
};

function DeployDialog({
  template,
  open,
  projects,
  environments,
  servers,
  projectId,
  environmentId,
  serverId,
  buildServerId,
  composeType,
  resourceName,
  appName,
  randomize,
  isPending,
  onClose,
  onProjectChange,
  onEnvironmentChange,
  onServerChange,
  onBuildServerChange,
  onComposeTypeChange,
  onResourceNameChange,
  onAppNameChange,
  onRandomizeChange,
  onDeploy,
}: DeployDialogProps) {
  const canDeploy = Boolean(
    projectId && environmentId && resourceName.trim() && appName.trim(),
  );
  const githubUrl = safeExternalUrl(template.links?.github);
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="no-scrollbar max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-2xl sm:w-[calc(100%-2rem)]">
        <DialogHeader>
          <DialogTitle>Deploy {template.name}</DialogTitle>
          <DialogDescription>
            Create a new resource from this template. The template stays
            unchanged and the first deployment is queued after validation.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-xl border bg-muted/20 p-4">
          <TemplateLogo name={template.name} src={template.logoUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{template.name}</p>
              <Badge variant="secondary">
                {template.source === "builtin" ? "Built-in" : "Organization"}
              </Badge>
              {template.version && (
                <span className="text-muted-foreground text-xs">
                  v{template.version}
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
              {template.description || "Compose template"}
            </p>
          </div>
          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Open ${template.name} source on GitHub`}
            >
              <GithubMark />
            </a>
          )}
        </div>
        <div className="space-y-5">
          <section className="space-y-3">
            <SectionHeading
              step={1}
              title="Choose a destination"
              description="Select the project and environment that will own the new resource."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Project"
                value={projectId || "_none"}
                onValueChange={(value) =>
                  onProjectChange(value === "_none" ? "" : value)
                }
                items={projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                }))}
                placeholder="Select project"
              />
              <SelectField
                label="Environment"
                value={environmentId || "_none"}
                disabled={!projectId}
                onValueChange={(value) =>
                  onEnvironmentChange(value === "_none" ? "" : value)
                }
                items={environments.map((environment) => ({
                  value: environment.id,
                  label: environment.name,
                }))}
                placeholder="Select environment"
              />
            </div>
          </section>
          <Separator />
          <section className="space-y-3">
            <SectionHeading
              step={2}
              title="Name the resource"
              description="These names identify the resource and its stable Compose app key in the dashboard."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="deploy-resource-name">Resource name</Label>
                <Input
                  id="deploy-resource-name"
                  value={resourceName}
                  onChange={(event) => onResourceNameChange(event.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deploy-app-name">App name</Label>
                <Input
                  id="deploy-app-name"
                  value={appName}
                  onChange={(event) => onAppNameChange(event.target.value)}
                  maxLength={120}
                />
              </div>
            </div>
          </section>
          <Separator />
          <section className="space-y-3">
            <SectionHeading
              step={3}
              title="Configure runtime"
              description="Leave targets automatic unless this stack needs a specific server role."
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                label="Deployment target"
                value={serverId || "_automatic"}
                onValueChange={(value) =>
                  onServerChange(value === "_automatic" ? "" : value)
                }
                items={servers
                  .filter((server) => server.serverType === "deploy")
                  .map((server) => ({
                    value: server.id,
                    label: `${server.name} (${server.serverType})`,
                  }))}
                placeholder="Automatic"
                allowEmptyLabel="Automatic (recommended)"
                emptyValue="_automatic"
              />
              <SelectField
                label="Build target"
                value={buildServerId || "_automatic"}
                onValueChange={(value) =>
                  onBuildServerChange(value === "_automatic" ? "" : value)
                }
                items={servers
                  .filter(
                    (server) =>
                      server.serverType === "build" ||
                      server.serverType === "deploy",
                  )
                  .map((server) => ({ value: server.id, label: server.name }))}
                placeholder="Automatic"
                allowEmptyLabel="Automatic"
                emptyValue="_automatic"
              />
              <SelectField
                label="Compose mode"
                value={composeType}
                onValueChange={(value) =>
                  onComposeTypeChange(value as "stack" | "compose")
                }
                items={[
                  { value: "stack", label: "Docker Swarm stack" },
                  { value: "compose", label: "Docker Compose" },
                ]}
                placeholder="Select mode"
              />
            </div>
            <Label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
              <Checkbox
                checked={randomize}
                onCheckedChange={(value) => onRandomizeChange(value)}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="block font-medium">Isolate names</span>
                <span className="text-muted-foreground text-xs">
                  Avoid service, network, and volume collisions when the
                  template is deployed more than once.
                </span>
              </span>
            </Label>
          </section>
        </div>
        <DialogFooter className="flex-wrap items-center justify-between border-t pt-4 sm:justify-between">
          <p className="text-muted-foreground text-xs">
            The template remains unchanged; deployment creates a new resource.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!canDeploy || isPending} onClick={onDeploy}>
              {isPending ? (
                <Loader2
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden="true"
                />
              ) : (
                <Rocket data-icon="inline-start" aria-hidden="true" />
              )}
              Queue deployment
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SelectField({
  label,
  value,
  items,
  onValueChange,
  placeholder,
  disabled,
  allowEmptyLabel,
  emptyValue = "_none",
}: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onValueChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  allowEmptyLabel?: string;
  emptyValue?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        items={[
          { value: emptyValue, label: allowEmptyLabel ?? placeholder },
          ...items,
        ]}
        value={value}
        onValueChange={(nextValue) => onValueChange(nextValue ?? emptyValue)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={emptyValue}>
              {allowEmptyLabel ?? placeholder}
            </SelectItem>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
