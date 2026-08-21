import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import type { ContainerFileSystemPort } from "../ports/container-file-system";
import type {
  DockerInspectionTarget,
  DockerInventoryReaderPort,
} from "../ports/docker";
import { containerBelongsToResource } from "../server/container-resolution.helper";
import { resolveDockerInspectionTarget } from "../server/docker-inspection-target.helper";

export const MAX_CONTAINER_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_CONTAINER_FILE_CONTENT_LENGTH =
  Math.ceil(MAX_CONTAINER_FILE_SIZE_BYTES / 3) * 4;
const MAX_CONTAINER_FILE_PATH_LENGTH = 4096;
const MAX_CONTAINER_FILE_NAME_LENGTH = 255;

const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function assertNoControlCharacters(value: string, label: string): void {
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new Error(`${label} contains unsupported control characters.`);
  }
}

function assertAbsolutePath(value: string, label: string): string {
  if (value.length > MAX_CONTAINER_FILE_PATH_LENGTH) {
    throw new Error(`${label} is too long.`);
  }
  assertNoControlCharacters(value, label);
  if (!value.startsWith("/") || value.includes("\\")) {
    throw new Error(`${label} must be an absolute POSIX path.`);
  }
  const segments = value.split("/").filter(Boolean);
  if (
    segments.some((segment) => segment === "." || segment === "..") ||
    value.includes("//")
  ) {
    throw new Error(`${label} contains an unsupported path segment.`);
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function assertMountPath(value: string): string {
  return assertAbsolutePath(value, "Mount path");
}

function assertFilePath(value: string, label: string): string {
  return assertAbsolutePath(value, label);
}

function assertMutationPath(value: string, label: string): string {
  const path = assertFilePath(value, label);
  if (path === "/") {
    throw new Error(`${label} cannot target the mount root.`);
  }
  return path;
}

function assertItemName(name: string): string {
  if (
    !name ||
    name.length > MAX_CONTAINER_FILE_NAME_LENGTH ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error("Item name contains invalid path characters.");
  }
  assertNoControlCharacters(name, "Item name");
  return name;
}

function assertContentSize(content: string, isBase64: boolean): string {
  if (content.length > MAX_CONTAINER_FILE_CONTENT_LENGTH) {
    throw new Error("File exceeds the 10 MB size limit.");
  }
  if (!isBase64) {
    if (Buffer.byteLength(content, "utf8") > MAX_CONTAINER_FILE_SIZE_BYTES) {
      throw new Error("File exceeds the 10 MB size limit.");
    }
    return Buffer.from(content, "utf8").toString("base64");
  }
  if (content.length % 4 !== 0 || !BASE64_PATTERN.test(content)) {
    throw new Error("Uploaded file content is not valid base64.");
  }
  if (
    Buffer.from(content, "base64").byteLength > MAX_CONTAINER_FILE_SIZE_BYTES
  ) {
    throw new Error("File exceeds the 10 MB size limit.");
  }
  return content;
}

export const FileExplorerItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "directory", "symlink", "other"]),
  sizeBytes: z.number(),
  permissions: z.string(),
  updatedAt: z.string(),
});

export type FileExplorerItem = z.infer<typeof FileExplorerItemSchema>;

const resourceInput = {
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
  containerId: z.string().min(1),
  mountPath: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
};

export const ListContainerMountsInputSchema = z.object({
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
  containerId: z.string().min(1),
});

export const ListContainerFilesInputSchema = z.object({
  ...resourceInput,
  path: z.string().max(MAX_CONTAINER_FILE_PATH_LENGTH).default("/"),
});

export const ReadContainerFileInputSchema = z.object({
  ...resourceInput,
  path: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
  encoding: z.enum(["text", "base64"]).default("text"),
});

export const WriteContainerFileInputSchema = z.object({
  ...resourceInput,
  path: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
  content: z.string().max(MAX_CONTAINER_FILE_CONTENT_LENGTH),
  isBase64: z.boolean().default(false),
});

export const CreateContainerItemInputSchema = z.object({
  ...resourceInput,
  parentPath: z.string().max(MAX_CONTAINER_FILE_PATH_LENGTH).default("/"),
  name: z.string().min(1).max(MAX_CONTAINER_FILE_NAME_LENGTH),
  type: z.enum(["file", "directory"]),
});

export const RenameContainerItemInputSchema = z.object({
  ...resourceInput,
  oldPath: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
  newPath: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
});

export const DeleteContainerItemInputSchema = z.object({
  ...resourceInput,
  path: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
});

export const ChangeContainerItemPermissionsInputSchema = z.object({
  ...resourceInput,
  path: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
  mode: z.string().regex(/^[0-7]{3,4}$/),
});

export const SearchContainerFilesInputSchema = z.object({
  ...resourceInput,
  path: z.string().max(MAX_CONTAINER_FILE_PATH_LENGTH).default("/"),
  query: z.string().min(1).max(100),
});

export type ContainerFileExecutionOptions = {
  allowLocalInCloud?: boolean;
};

export class ContainerFileManagerUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly dockerInventory: DockerInventoryReaderPort,
    private readonly fileSystem: ContainerFileSystemPort,
  ) {}

  private async resolveTargetContainer(
    organizationId: string,
    resourceId: string,
    containerId: string,
    options: ContainerFileExecutionOptions = {},
  ): Promise<{
    target: DockerInspectionTarget;
    containerId: string;
  }> {
    const resource = await this.uow.resourceRepository.findById(resourceId);
    if (!resource) throw new Error("Resource not found.");

    const environment = await this.uow.environmentRepository.findById(
      resource.environmentId,
    );
    const project = environment
      ? await this.uow.projectRepository.findById(environment.projectId)
      : null;
    if (!project || project.organizationId !== organizationId) {
      throw new Error("Resource is not part of the active organization.");
    }

    const target = await resolveDockerInspectionTarget(
      this.uow,
      { organizationId, serverId: resource.serverId || "local" },
      {
        localServerIds: ["local", "manager"],
        allowLocalInCloud: options.allowLocalInCloud,
      },
    );
    const containers = await this.dockerInventory.listContainers(target);
    const selected = containers.find(
      (candidate) =>
        candidate.id === containerId &&
        containerBelongsToResource(candidate, resource),
    );
    if (!selected) {
      throw new Error("Requested container is not part of this resource.");
    }
    return { target, containerId: selected.id };
  }

  private async resolveMount(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    mutation: boolean,
  ): Promise<string> {
    const normalizedMountPath = assertMountPath(mountPath);
    const mounts = await this.fileSystem.getContainerMounts(
      target,
      containerId,
    );
    const mount = mounts.find(
      (candidate) => candidate.destination === normalizedMountPath,
    );
    if (!mount) {
      throw new Error(
        "Requested mount is not a named volume on this container.",
      );
    }
    if (mutation && mount.readOnly) {
      throw new Error("The requested volume is mounted read-only.");
    }
    return mount.destination;
  }

  async listMounts(
    input: z.infer<typeof ListContainerMountsInputSchema>,
    options: ContainerFileExecutionOptions = {},
  ): Promise<Array<{ name: string; mountPath: string; readOnly: boolean }>> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
      options,
    );
    return this.fileSystem
      .getContainerMounts(target, containerId)
      .then((mounts) =>
        mounts.map((mount) => ({
          name: mount.name,
          mountPath: mount.destination,
          readOnly: mount.readOnly,
        })),
      );
  }

  async listFiles(
    input: z.infer<typeof ListContainerFilesInputSchema>,
    options: ContainerFileExecutionOptions = {},
  ): Promise<FileExplorerItem[]> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
      options,
    );
    const mountPath = await this.resolveMount(
      target,
      containerId,
      input.mountPath,
      false,
    );
    return this.fileSystem.listFiles(
      target,
      containerId,
      mountPath,
      assertFilePath(input.path, "Path"),
    );
  }

  async readFile(
    input: z.infer<typeof ReadContainerFileInputSchema>,
    options: ContainerFileExecutionOptions = {},
  ): Promise<{ content: string; path: string; encoding: "text" | "base64" }> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
      options,
    );
    const path = assertFilePath(input.path, "File path");
    const mountPath = await this.resolveMount(
      target,
      containerId,
      input.mountPath,
      false,
    );
    const result = await this.fileSystem.readFile(
      target,
      containerId,
      mountPath,
      path,
      "base64",
    );
    const content =
      input.encoding === "base64"
        ? result.content
        : Buffer.from(result.content, "base64").toString("utf8");
    return { content, path, encoding: input.encoding };
  }

  async writeFile(
    input: z.infer<typeof WriteContainerFileInputSchema>,
    options: ContainerFileExecutionOptions = {},
  ): Promise<{ success: true }> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
      options,
    );
    const path = assertMutationPath(input.path, "File path");
    const mountPath = await this.resolveMount(
      target,
      containerId,
      input.mountPath,
      true,
    );
    await this.fileSystem.writeFile(
      target,
      containerId,
      mountPath,
      path,
      assertContentSize(input.content, input.isBase64),
    );
    return { success: true };
  }

  async createItem(
    input: z.infer<typeof CreateContainerItemInputSchema>,
    options: ContainerFileExecutionOptions = {},
  ): Promise<{ success: true }> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
      options,
    );
    const parentPath = assertFilePath(input.parentPath, "Parent path");
    const mountPath = await this.resolveMount(
      target,
      containerId,
      input.mountPath,
      true,
    );
    const name = assertItemName(input.name);
    const path = parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
    await this.fileSystem.createItem(
      target,
      containerId,
      mountPath,
      path,
      input.type,
    );
    return { success: true };
  }

  async renameItem(
    input: z.infer<typeof RenameContainerItemInputSchema>,
    options: ContainerFileExecutionOptions = {},
  ): Promise<{ success: true }> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
      options,
    );
    const oldPath = assertMutationPath(input.oldPath, "Original path");
    const newPath = assertMutationPath(input.newPath, "New path");
    const mountPath = await this.resolveMount(
      target,
      containerId,
      input.mountPath,
      true,
    );
    await this.fileSystem.renameItem(
      target,
      containerId,
      mountPath,
      oldPath,
      newPath,
    );
    return { success: true };
  }

  async deleteItem(
    input: z.infer<typeof DeleteContainerItemInputSchema>,
    options: ContainerFileExecutionOptions = {},
  ): Promise<{ success: true }> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
      options,
    );
    const path = assertMutationPath(input.path, "Delete path");
    const mountPath = await this.resolveMount(
      target,
      containerId,
      input.mountPath,
      true,
    );
    await this.fileSystem.deleteItem(target, containerId, mountPath, path);
    return { success: true };
  }

  async changePermissions(
    input: z.infer<typeof ChangeContainerItemPermissionsInputSchema>,
    options: ContainerFileExecutionOptions = {},
  ): Promise<{ success: true }> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
      options,
    );
    const path = assertMutationPath(input.path, "File path");
    const mountPath = await this.resolveMount(
      target,
      containerId,
      input.mountPath,
      true,
    );
    await this.fileSystem.changePermissions(
      target,
      containerId,
      mountPath,
      path,
      input.mode,
    );
    return { success: true };
  }

  async searchFiles(
    input: z.infer<typeof SearchContainerFilesInputSchema>,
    options: ContainerFileExecutionOptions = {},
  ): Promise<FileExplorerItem[]> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
      options,
    );
    assertNoControlCharacters(input.query, "Search query");
    const mountPath = await this.resolveMount(
      target,
      containerId,
      input.mountPath,
      false,
    );
    return this.fileSystem.searchFiles(
      target,
      containerId,
      mountPath,
      assertFilePath(input.path, "Search path"),
      input.query,
    );
  }
}
