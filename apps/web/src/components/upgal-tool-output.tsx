"use client";

import type { UpGalUIAction } from "@upstand/api/ai/upgal";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import { cn } from "@upstand/ui/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ToolOutput } from "@/components/ai-elements/tool";
import {
  ArrowUpRightIcon,
  BoxIcon,
  DatabaseIcon,
  FileTextIcon,
  RotateCw,
  ServerIcon,
} from "@/components/huge-icons";

type ToolResultProps = {
  name: string;
  input?: unknown;
  onReplay?: (action: UpGalUIAction) => void;
  output: unknown;
};

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const labelFor = (value: string) =>
  value
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (first) => first.toUpperCase());

const toolTitles: Record<string, string> = {
  list_projects: "Projects",
  list_environments: "Environments",
  list_resources: "Resources",
  list_servers: "Servers",
  list_deployments: "Deployments",
  list_docker_containers: "Docker containers",
  list_docker_images: "Docker images",
  list_docker_volumes: "Docker volumes",
  list_docker_services: "Docker services",
  search_web: "Web search results",
};

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

function ResultIcon({ name }: { name: string }) {
  if (name.includes("log")) return <FileTextIcon aria-hidden="true" />;
  if (name.includes("server")) return <ServerIcon aria-hidden="true" />;
  if (name.includes("docker") || name.includes("container")) {
    return <BoxIcon aria-hidden="true" />;
  }
  return <DatabaseIcon aria-hidden="true" />;
}

type ResultAction = {
  href: Route;
  label: string;
};

function resultAction(
  name: string,
  record: RecordValue,
  input: RecordValue | undefined,
): ResultAction | undefined {
  const id = stringValue(record.id);
  if (!id) return undefined;

  if (name === "list_projects" || name === "create_project") {
    return { href: `/projects/${id}` as Route, label: "Open project" };
  }

  const projectId = stringValue(record.projectId);
  const environmentId = stringValue(record.environmentId);

  if (name === "list_environments" || name === "create_environment") {
    if (!projectId) return undefined;
    return {
      href: `/projects/${projectId}/${id}` as Route,
      label: "Open environment",
    };
  }

  if (name === "list_resources") {
    if (!projectId || !environmentId) return undefined;
    return {
      href: `/projects/${projectId}/${environmentId}/${id}` as Route,
      label: "Open resource",
    };
  }

  // Mutation results can contain only the target ID. Keep the action available
  // when the model supplied the complete route context in its input.
  const inputProjectId = stringValue(input?.projectId);
  const inputEnvironmentId = stringValue(input?.environmentId);
  if (
    inputProjectId &&
    (environmentId || inputEnvironmentId) &&
    (name === "deploy_resource" || name === "control_resource")
  ) {
    return {
      href: `/projects/${inputProjectId}/${environmentId ?? inputEnvironmentId}/${id}` as Route,
      label: "Open resource",
    };
  }

  return undefined;
}

function ActionLink({ action }: { action: ResultAction }) {
  return (
    <Link
      aria-label={action.label}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-4xl border border-border bg-background px-3 font-medium text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
      )}
      href={action.href}
    >
      {action.label}
      <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

function CollectionResult({
  name,
  input,
  records,
}: {
  name: string;
  input: RecordValue | undefined;
  records: RecordValue[];
}) {
  const title = toolTitles[name] ?? labelFor(name);
  return (
    <section aria-label={`${title} results`} className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <ResultIcon name={name} />
        <span className="font-medium text-xs">{title}</span>
        <Badge className="ml-auto rounded-full" variant="secondary">
          {records.length}
        </Badge>
      </div>
      {records.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-muted-foreground text-xs">
          No results found.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {records.map((record, index) => {
            const title = String(
              record.name ??
                record.serviceName ??
                record.hostname ??
                record.Names ??
                record.id ??
                record.ID ??
                `Result ${index + 1}`,
            );
            const subtitle =
              record.status ??
              record.State ??
              record.currentState ??
              record.image ??
              record.Image ??
              record.ipAddress;
            const action = resultAction(name, record, input);
            const content = (
              <>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm" translate="no">
                      {title}
                    </p>
                    {subtitle !== undefined ? (
                      <p className="mt-1 truncate text-muted-foreground text-xs">
                        {displayValue(subtitle)}
                      </p>
                    ) : null}
                  </div>
                  {action ? (
                    <ArrowUpRightIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                </div>
                {action ? (
                  <span className="mt-3 block text-primary text-xs">
                    {action.label}
                  </span>
                ) : null}
              </>
            );
            return action ? (
              <Link
                className="min-w-0 rounded-md border bg-muted/20 px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                href={action.href}
                key={`${title}-${index}`}
              >
                {content}
              </Link>
            ) : (
              <article
                className="min-w-0 rounded-md border bg-muted/20 px-3 py-2"
                key={`${title}-${index}`}
              >
                {content}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DetailsResult({
  name,
  input,
  output,
}: {
  name: string;
  input: RecordValue | undefined;
  output: RecordValue;
}) {
  const entries = Object.entries(output).filter(
    ([, value]) => value !== undefined && typeof value !== "object",
  );
  const action = resultAction(name, output, input);
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div className="min-w-0" key={key}>
            <dt className="truncate text-muted-foreground text-xs">
              {labelFor(key)}
            </dt>
            <dd
              className={cn(
                "mt-1 break-words font-medium text-sm",
                key.toLowerCase().includes("id") && "font-mono text-xs",
              )}
            >
              {displayValue(value)}
            </dd>
          </div>
        ))}
      </dl>
      {action ? <ActionLink action={action} /> : null}
    </div>
  );
}

function LogsResult({ output }: { output: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
      {output || "No log output returned."}
    </pre>
  );
}

function UiActionResult({
  onReplay,
  output,
}: {
  onReplay?: (action: UpGalUIAction) => void;
  output: UpGalUIAction;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 p-3">
      <p className="min-w-0 text-muted-foreground text-xs">
        UpGal started a {output.steps.length}-step walkthrough. Follow the guide
        on the page; it will not submit forms for you.
      </p>
      {onReplay ? (
        <Button
          className="shrink-0"
          onClick={() => onReplay(output)}
          size="sm"
          variant="outline"
        >
          <RotateCw aria-hidden="true" data-icon="inline-start" />
          Replay
        </Button>
      ) : null}
    </div>
  );
}

function WebSearchResult({ output }: { output: RecordValue }) {
  const results = Array.isArray(output.results)
    ? output.results.filter(isRecord)
    : [];
  return (
    <section aria-label="Web search results" className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <DatabaseIcon aria-hidden="true" />
        <span className="font-medium text-xs">Web search results</span>
        <Badge className="ml-auto rounded-full" variant="secondary">
          {results.length}
        </Badge>
      </div>
      {results.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-muted-foreground text-xs">
          No web results found.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {results.map((result, index) => {
            const url = stringValue(result.url);
            return (
              <a
                className="rounded-md border bg-muted/20 px-3 py-2 hover:bg-muted/50"
                href={url}
                key={`${url ?? "result"}-${index}`}
                rel="noreferrer"
                target="_blank"
              >
                <p className="font-medium text-sm">
                  {displayValue(result.title)}
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  {displayValue(result.description)}
                </p>
                {url ? (
                  <p className="mt-1 truncate text-[11px] text-primary">
                    {url}
                  </p>
                ) : null}
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function UpGalToolOutput({
  name,
  input,
  onReplay,
  output,
}: ToolResultProps): ReactNode {
  if (
    isRecord(output) &&
    output.kind === "ui_action_plan" &&
    Array.isArray(output.steps)
  ) {
    return (
      <UiActionResult
        onReplay={onReplay}
        output={output as unknown as UpGalUIAction}
      />
    );
  }
  if (isRecord(output) && Array.isArray(output.results)) {
    return <WebSearchResult output={output} />;
  }
  if (typeof output === "string" && name.includes("log")) {
    return <LogsResult output={output} />;
  }

  const inputRecord = isRecord(input) ? input : undefined;
  const records = Array.isArray(output)
    ? output.filter(isRecord)
    : isRecord(output) && Array.isArray(output.items)
      ? output.items.filter(isRecord)
      : null;
  if (records) {
    return (
      <CollectionResult input={inputRecord} name={name} records={records} />
    );
  }
  if (isRecord(output)) {
    return <DetailsResult input={inputRecord} name={name} output={output} />;
  }
  return <ToolOutput output={output} errorText={undefined} />;
}
