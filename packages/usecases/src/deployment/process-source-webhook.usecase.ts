import { createHmac, timingSafeEqual } from "node:crypto";
import type { IUnitOfWork, Resource } from "@upstand/domain";
import { parseResourceCredentials } from "../resource/resource-credentials";
import { matchesDockerImageWebhook } from "./docker-image-webhook";
import { QueueDeploymentUseCase } from "./queue-deployment.usecase";
import { matchesSafeGlob } from "./safe-glob";

export type SourceWebhookProvider =
  | "github"
  | "gitlab"
  | "gitea"
  | "bitbucket"
  | "dockerhub";

export interface ProcessSourceWebhookInput {
  providerId: string;
  provider: SourceWebhookProvider;
  bodyText: string;
  headers: Record<string, string | undefined>;
}

export interface ProcessSourceWebhookResult {
  accepted: boolean;
  queued: number;
  ignored: number;
  reason?: string;
}

export interface DeploymentEnqueuer {
  execute(input: {
    resourceId: string;
    title: string;
    sourceRevision?: string;
  }): Promise<unknown>;
}

interface ParsedWebhook {
  repository: string | undefined;
  ref: string | undefined;
  isTag: boolean;
  changedFiles: string[];
  title: string;
  sourceRevision?: string;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function verifyHmac(
  bodyText: string,
  received: string | undefined,
  secret: string,
): boolean {
  if (!received) return false;
  const digest = createHmac("sha256", secret).update(bodyText).digest("hex");
  const expected = received.startsWith("sha256=") ? `sha256=${digest}` : digest;
  return safeEqual(expected, received);
}

function verifyWebhook(
  provider: SourceWebhookProvider,
  bodyText: string,
  headers: Record<string, string | undefined>,
  config: JsonRecord,
): boolean {
  const secret =
    readString(config.webhookSecret) ?? readString(config.githubWebhookSecret);

  if (provider === "gitlab") {
    const token = headers["x-gitlab-token"];
    return Boolean(secret && token && safeEqual(secret, token));
  }

  if (!secret) return false;
  if (provider === "github") {
    return verifyHmac(bodyText, headers["x-hub-signature-256"], secret);
  }

  return verifyHmac(
    bodyText,
    headers["x-hub-signature"] ?? headers["x-gitea-signature"],
    secret,
  );
}

function collectCommitFiles(commits: unknown): string[] {
  if (!Array.isArray(commits)) return [];
  const files = new Set<string>();
  for (const commit of commits) {
    const record = asRecord(commit);
    for (const key of ["added", "modified", "removed"]) {
      const values = record[key];
      if (Array.isArray(values)) {
        for (const value of values) {
          if (typeof value === "string") files.add(value);
        }
      }
    }
  }
  return [...files];
}

function parseWebhook(
  provider: SourceWebhookProvider,
  payload: JsonRecord,
  headers: Record<string, string | undefined>,
): ParsedWebhook | null {
  if (provider === "dockerhub") {
    const repository = asRecord(payload.repository);
    const pushData = asRecord(payload.push_data);
    const tag = readString(pushData.tag);
    return {
      repository:
        readString(repository.repo_name) ?? readString(repository.name),
      ref: tag,
      isTag: true,
      changedFiles: [],
      title: `Docker Hub image update${tag ? ` (${tag})` : ""}`,
    };
  }

  if (provider === "github") {
    const repository = asRecord(payload.repository);
    const ref = readString(payload.ref);
    const event = headers["x-github-event"];
    if (event !== "push") return null;
    const refName = ref?.replace(/^refs\/(heads|tags)\//, "");
    return {
      repository: readString(repository.full_name),
      ref: refName,
      isTag: ref?.startsWith("refs/tags/") ?? false,
      changedFiles: collectCommitFiles(payload.commits),
      title: `GitHub webhook deployment${refName ? ` (${refName})` : ""}`,
      sourceRevision: readString(payload.after),
    };
  }

  if (provider === "gitlab") {
    if (readString(payload.object_kind) !== "push") return null;
    const project = asRecord(payload.project);
    const ref = readString(payload.ref);
    const refName = ref?.replace(/^refs\/(heads|tags)\//, "");
    return {
      repository: readString(project.path_with_namespace),
      ref: refName,
      isTag: ref?.startsWith("refs/tags/") ?? false,
      changedFiles: collectCommitFiles(payload.commits),
      title: `GitLab webhook deployment${refName ? ` (${refName})` : ""}`,
      sourceRevision: readString(payload.after),
    };
  }

  if (provider === "gitea") {
    const repository = asRecord(payload.repository);
    const ref = readString(payload.ref);
    const refName = ref?.replace(/^refs\/(heads|tags)\//, "");
    return {
      repository:
        readString(repository.full_name) ?? readString(repository.name),
      ref: refName,
      isTag: ref?.startsWith("refs/tags/") ?? false,
      changedFiles: collectCommitFiles(payload.commits),
      title: `Gitea webhook deployment${refName ? ` (${refName})` : ""}`,
      sourceRevision: readString(payload.after),
    };
  }

  const repository = asRecord(payload.repository);
  const changes = Array.isArray(payload.push)
    ? payload.push
    : Array.isArray(payload.changes)
      ? payload.changes
      : [];
  const firstChange = asRecord(changes[0]);
  const newRef = asRecord(firstChange.new);
  const ref = readString(newRef.name);
  const commits = changes.flatMap((change) => {
    const record = asRecord(change);
    return Array.isArray(record.commits) ? record.commits : [];
  });
  return {
    repository: readString(repository.full_name) ?? readString(repository.name),
    ref,
    isTag: readString(newRef.type) === "tag",
    changedFiles: collectCommitFiles(commits),
    title: `Bitbucket webhook deployment${ref ? ` (${ref})` : ""}`,
    sourceRevision: readString(asRecord(newRef.target).hash),
  };
}

function normalizeTrigger(value: unknown): "push" | "tag" {
  return String(value ?? "push")
    .toLowerCase()
    .includes("tag")
    ? "tag"
    : "push";
}

function matchesPath(pattern: string, file: string): boolean {
  return matchesSafeGlob(pattern, file);
}

function matchesTagPattern(
  pattern: string | null | undefined,
  tag: string,
): boolean {
  if (!pattern?.trim()) {
    return true;
  }
  return matchesSafeGlob(pattern, tag, { starMatchesSlash: true });
}

function resourceConfig(resource: Resource): JsonRecord {
  return asRecord(parseResourceCredentials(resource.credentials));
}

function matchesResource(
  resource: Resource,
  provider: SourceWebhookProvider,
  providerId: string,
  parsed: ParsedWebhook,
): boolean {
  const expectedProvider =
    provider === "dockerhub" ? "docker-registry" : provider;
  if (
    resource.provider !== expectedProvider ||
    (resource.type !== "application" && resource.type !== "compose")
  ) {
    return false;
  }
  const config = resourceConfig(resource);
  if (config.autoDeploy === false) return false;
  if (
    typeof config.githubAccount === "string" &&
    config.githubAccount !== providerId
  ) {
    return false;
  }

  const configuredRepository = readString(config.repository);
  if (provider === "dockerhub") {
    const image = readString(config.dockerImage) ?? resource.dockerImage;
    if (!image || !parsed.repository) return false;
    if (!matchesDockerImageWebhook(image, parsed.repository, parsed.ref)) {
      return false;
    }
  } else if (
    !configuredRepository ||
    !parsed.repository ||
    configuredRepository.toLowerCase() !== parsed.repository.toLowerCase()
  ) {
    return false;
  }

  if (provider !== "dockerhub") {
    const trigger = normalizeTrigger(
      resource.triggerType === "tag" ? "tag" : (config.triggerType ?? "push"),
    );
    if (trigger === "tag" && !parsed.isTag) return false;
    if (trigger === "push" && parsed.isTag) return false;

    if (trigger === "tag") {
      if (parsed.ref && !matchesTagPattern(resource.tagPattern, parsed.ref)) {
        return false;
      }
    } else {
      const configuredBranch = readString(config.branch);
      if (configuredBranch && parsed.ref && configuredBranch !== parsed.ref)
        return false;
    }
  }

  let typedWatchPaths: unknown = resource.watchPaths;
  if (typeof typedWatchPaths === "string") {
    try {
      typedWatchPaths = JSON.parse(typedWatchPaths);
    } catch {
      typedWatchPaths = [];
    }
  }
  const normalizedTypedWatchPaths = Array.isArray(typedWatchPaths)
    ? typedWatchPaths.filter((path): path is string => typeof path === "string")
    : [];
  const watchPaths =
    normalizedTypedWatchPaths.length > 0
      ? normalizedTypedWatchPaths
      : Array.isArray(config.watchPaths)
        ? config.watchPaths.filter(
            (path): path is string => typeof path === "string",
          )
        : [];
  if (
    watchPaths.length > 0 &&
    parsed.changedFiles.length > 0 &&
    !parsed.changedFiles.some((file) =>
      watchPaths.some((path) => matchesPath(path, file)),
    )
  ) {
    return false;
  }
  return true;
}

export class ProcessSourceWebhookUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly createEnqueuer: (
      uow: IUnitOfWork,
    ) => DeploymentEnqueuer = (uow) => new QueueDeploymentUseCase(uow),
  ) {}

  async execute(
    input: ProcessSourceWebhookInput,
  ): Promise<ProcessSourceWebhookResult> {
    const provider = await this.uow.gitProviderRepository.findById(
      input.providerId,
    );
    if (!provider || provider.provider !== input.provider) {
      throw new Error("Git provider not found");
    }
    let config: JsonRecord;
    let payload: JsonRecord;
    try {
      config = asRecord(JSON.parse(provider.config));
      payload = asRecord(JSON.parse(input.bodyText));
    } catch {
      throw new Error("Invalid webhook JSON payload");
    }
    if (!verifyWebhook(input.provider, input.bodyText, input.headers, config)) {
      throw new Error("Invalid webhook signature");
    }

    const parsed = parseWebhook(input.provider, payload, input.headers);
    if (!parsed) {
      return { accepted: true, queued: 0, ignored: 1, reason: "event_ignored" };
    }

    const projects = await this.uow.projectRepository.findByOrganizationId(
      provider.organizationId,
    );
    const ownedResources: Resource[] = [];
    for (const project of projects) {
      const environments = await this.uow.environmentRepository.findByProjectId(
        project.id,
      );
      for (const environment of environments) {
        const resources = await this.uow.resourceRepository.findByEnvironmentId(
          environment.id,
        );
        ownedResources.push(...resources);
      }
    }
    const matches = ownedResources.filter((resource) =>
      matchesResource(resource, input.provider, input.providerId, parsed),
    );
    const enqueuer = this.createEnqueuer(this.uow);
    for (const resource of matches) {
      await enqueuer.execute({
        resourceId: resource.id,
        title: parsed.title,
        sourceRevision: parsed.sourceRevision,
      });
    }
    return {
      accepted: true,
      queued: matches.length,
      ignored: ownedResources.length - matches.length,
    };
  }
}
