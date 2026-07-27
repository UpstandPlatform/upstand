import type { IUnitOfWork } from "@upstand/domain";
import { z } from "zod";
import type {
  DockerExecPort,
  DockerInspectionTarget,
  DockerInventoryReaderPort,
} from "../ports/docker";
import {
  containerBelongsToResource,
  shellQuote,
} from "../server/container-resolution.helper";
import { resolveDockerInspectionTarget } from "../server/docker-inspection-target.helper";

export function normalizeContainerPath(rawPath: string): string {
  if (!rawPath?.trim()) return "/";
  const parts = rawPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.length === 0 ? "/" : `/${stack.join("/")}`;
}

export const MAX_CONTAINER_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_CONTAINER_FILE_CONTENT_LENGTH =
  Math.ceil(MAX_CONTAINER_FILE_SIZE_BYTES / 3) * 4;
const MAX_CONTAINER_FILE_PATH_LENGTH = 4096;
const MAX_CONTAINER_FILE_NAME_LENGTH = 255;
const NO_ACTIVE_CONTAINER_MESSAGE =
  "Active running container not found for this resource.";

function isNoActiveContainerError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === NO_ACTIVE_CONTAINER_MESSAGE
  );
}

const PROTECTED_SYSTEM_PATHS = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/sys",
  "/usr",
] as const;

function assertValidContainerPath(rawPath: string, label = "Path"): string {
  if (rawPath.length > MAX_CONTAINER_FILE_PATH_LENGTH) {
    throw new Error(`${label} is too long.`);
  }
  if (
    [...rawPath].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new Error(`${label} contains unsupported control characters.`);
  }

  const normalizedPath = normalizeContainerPath(rawPath);
  if (
    PROTECTED_SYSTEM_PATHS.some(
      (protectedPath) =>
        normalizedPath === protectedPath ||
        normalizedPath.startsWith(`${protectedPath}/`),
    )
  ) {
    throw new Error(`${label} targets a protected system path.`);
  }

  return normalizedPath;
}

function assertValidItemName(name: string): string {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > MAX_CONTAINER_FILE_NAME_LENGTH) {
    throw new Error("Item name must be between 1 and 255 characters.");
  }
  if (
    trimmedName === "." ||
    trimmedName === ".." ||
    trimmedName.includes("/") ||
    trimmedName.includes("\\") ||
    trimmedName.includes("|") ||
    trimmedName.includes("\0")
  ) {
    throw new Error("Item name contains invalid path characters.");
  }
  return trimmedName;
}

function assertContentSize(content: string, isBase64 = false): void {
  if (isBase64) {
    if (
      content.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        content,
      )
    ) {
      throw new Error("Uploaded file content is not valid base64.");
    }
    if (
      Buffer.from(content, "base64").byteLength > MAX_CONTAINER_FILE_SIZE_BYTES
    ) {
      throw new Error("File exceeds the 10 MB size limit.");
    }
    return;
  }

  if (Buffer.byteLength(content, "utf8") > MAX_CONTAINER_FILE_SIZE_BYTES) {
    throw new Error("File exceeds the 10 MB size limit.");
  }
}

const DANGEROUS_SYSTEM_PATHS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/sys",
  "/usr",
  "/var",
]);

export const FileExplorerItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "directory", "symlink", "other"]),
  sizeBytes: z.number(),
  permissions: z.string(),
  updatedAt: z.string(),
});

export type FileExplorerItem = z.infer<typeof FileExplorerItemSchema>;

export const ListContainerFilesInputSchema = z.object({
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
  containerId: z.string().optional(),
  path: z.string().max(MAX_CONTAINER_FILE_PATH_LENGTH).default("/"),
});

export const ReadContainerFileInputSchema = z.object({
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
  containerId: z.string().optional(),
  path: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
  encoding: z.enum(["text", "base64"]).default("text"),
});

export const WriteContainerFileInputSchema = z.object({
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
  containerId: z.string().optional(),
  path: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
  content: z.string().max(MAX_CONTAINER_FILE_CONTENT_LENGTH),
  isBase64: z.boolean().optional(),
});

export const CreateContainerItemInputSchema = z.object({
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
  containerId: z.string().optional(),
  parentPath: z.string().max(MAX_CONTAINER_FILE_PATH_LENGTH).default("/"),
  name: z.string().min(1).max(MAX_CONTAINER_FILE_NAME_LENGTH),
  type: z.enum(["file", "directory"]),
});

export const RenameContainerItemInputSchema = z.object({
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
  containerId: z.string().optional(),
  oldPath: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
  newPath: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
});

export const DeleteContainerItemInputSchema = z.object({
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
  containerId: z.string().optional(),
  path: z.string().min(1).max(MAX_CONTAINER_FILE_PATH_LENGTH),
});

export const SearchContainerFilesInputSchema = z.object({
  organizationId: z.string().min(1),
  resourceId: z.string().min(1),
  containerId: z.string().optional(),
  path: z.string().max(MAX_CONTAINER_FILE_PATH_LENGTH).default("/"),
  query: z.string().min(1).max(100),
});

export class ContainerFileManagerUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly docker: DockerExecPort,
    private readonly dockerInventory: DockerInventoryReaderPort,
  ) {}

  private async resolveTargetContainer(
    organizationId: string,
    resourceId: string,
    requestedContainerId?: string,
  ): Promise<{ target: DockerInspectionTarget; containerId: string }> {
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

    const resourceServerId = resource.serverId || "local";
    const target = await resolveDockerInspectionTarget(
      this.uow,
      {
        organizationId,
        serverId: resourceServerId,
      },
      { localServerIds: ["local", "manager"] },
    );

    const containers = await this.dockerInventory.listContainers(target);
    const ownedContainers = containers.filter((container) =>
      containerBelongsToResource(container, resource),
    );

    let selected = ownedContainers[0];
    if (requestedContainerId) {
      const matches = ownedContainers.filter(
        (c) =>
          c.id === requestedContainerId ||
          c.id.startsWith(requestedContainerId) ||
          c.name === requestedContainerId,
      );
      if (matches.length !== 1) {
        throw new Error("Requested container is not part of this resource.");
      }
      selected = matches[0];
    }

    if (!selected) {
      throw new Error(NO_ACTIVE_CONTAINER_MESSAGE);
    }

    return { target, containerId: selected.id };
  }

  async listFiles(
    input: z.infer<typeof ListContainerFilesInputSchema>,
  ): Promise<FileExplorerItem[]> {
    let target: DockerInspectionTarget;
    let containerId: string;
    try {
      ({ target, containerId } = await this.resolveTargetContainer(
        input.organizationId,
        input.resourceId,
        input.containerId,
      ));
    } catch (error) {
      if (!input.containerId && isNoActiveContainerError(error)) return [];
      throw error;
    }

    const normalizedPath = normalizeContainerPath(input.path);
    const safePath = shellQuote(normalizedPath);
    const command = `cd ${safePath} 2>/dev/null && for f in ./* ./.* ; do [ -e "$f" ] || [ -L "$f" ] || continue; [ "$f" = "./." ] || [ "$f" = "./.." ] && continue; name=\${f#./}; if [ -d "$f" ]; then type="directory"; elif [ -L "$f" ]; then type="symlink"; else type="file"; fi; stat_out=$(stat -c '%s|%a|%Y' "$f" 2>/dev/null || echo "0|644|0"); echo "$type|$stat_out|$name"; done`;

    const result = await this.execChecked(target, containerId, command);

    const items: FileExplorerItem[] = [];
    const lines = (result.output || "")
      .split("\n")
      .filter((line: string) => line.trim());

    for (const line of lines) {
      const parts = line.split("|");
      if (parts.length >= 5) {
        const fileTypeRaw = parts[0]?.toLowerCase() || "";
        const sizeBytes = Number.parseInt(parts[1] || "0", 10);
        const permissions = parts[2] || "755";
        const timestampSec = Number.parseInt(parts[3] || "0", 10);
        const rawName = parts.slice(4).join("|").replace(/^\.\//, "") || "";

        if (!rawName) continue;

        let type: FileExplorerItem["type"] = "file";
        if (fileTypeRaw.includes("directory")) type = "directory";
        else if (
          fileTypeRaw.includes("symlink") ||
          fileTypeRaw.includes("symbolic link")
        )
          type = "symlink";

        const itemPath =
          normalizedPath === "/"
            ? `/${rawName}`
            : `${normalizedPath.replace(/\/$/, "")}/${rawName}`;

        const updatedAt =
          timestampSec > 0
            ? new Date(timestampSec * 1000).toISOString()
            : new Date().toISOString();

        items.push({
          name: rawName,
          path: itemPath,
          type,
          sizeBytes,
          permissions,
          updatedAt,
        });
      }
    }

    return items.sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async readFile(
    input: z.infer<typeof ReadContainerFileInputSchema>,
  ): Promise<{ content: string; path: string; encoding: "text" | "base64" }> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
    );

    const normalizedPath = assertValidContainerPath(input.path, "File path");
    const encoding = input.encoding ?? "text";
    const safePath = shellQuote(normalizedPath);
    const command =
      encoding === "base64"
        ? `test -f ${safePath} && test -r ${safePath} && [ "$(wc -c < ${safePath})" -le ${MAX_CONTAINER_FILE_SIZE_BYTES} ] && base64 ${safePath}`
        : `test -f ${safePath} && test -r ${safePath} && [ "$(wc -c < ${safePath})" -le ${MAX_CONTAINER_FILE_SIZE_BYTES} ] && cat -- ${safePath}`;

    const result = await this.execChecked(target, containerId, command);

    return {
      content: result.output || "",
      path: normalizedPath,
      encoding,
    };
  }

  async writeFile(
    input: z.infer<typeof WriteContainerFileInputSchema>,
  ): Promise<{ success: boolean }> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
    );

    const normalizedPath = assertValidContainerPath(input.path, "File path");
    assertContentSize(input.content, input.isBase64);
    const base64Content = input.isBase64
      ? input.content
      : Buffer.from(input.content, "utf8").toString("base64");

    const safePath = shellQuote(normalizedPath);
    const dirPath = shellQuote(
      normalizedPath.substring(0, normalizedPath.lastIndexOf("/")) || "/",
    );

    const command = `test -d ${dirPath} && printf '%s' ${shellQuote(base64Content)} | base64 -d > ${safePath}`;

    await this.execChecked(target, containerId, command);

    return { success: true };
  }

  async createItem(
    input: z.infer<typeof CreateContainerItemInputSchema>,
  ): Promise<{ success: boolean }> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
    );

    const parent = assertValidContainerPath(input.parentPath, "Parent path");
    const itemName = assertValidItemName(input.name);
    const targetPath =
      parent === "/"
        ? `/${itemName}`
        : `${parent.replace(/\/$/, "")}/${itemName}`;
    assertValidContainerPath(targetPath, "Item path");

    const safeTarget = shellQuote(targetPath);
    const dirPath = shellQuote(
      targetPath.substring(0, targetPath.lastIndexOf("/")) || "/",
    );

    const command =
      input.type === "directory"
        ? `mkdir -p -- ${safeTarget}`
        : `mkdir -p -- ${dirPath} && touch -- ${safeTarget}`;

    await this.execChecked(target, containerId, command);

    return { success: true };
  }

  async renameItem(
    input: z.infer<typeof RenameContainerItemInputSchema>,
  ): Promise<{ success: boolean }> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
    );

    const oldNormalized = assertValidContainerPath(
      input.oldPath,
      "Original path",
    );
    const newNormalized = assertValidContainerPath(input.newPath, "New path");

    if (DANGEROUS_SYSTEM_PATHS.has(oldNormalized) || oldNormalized === "/") {
      throw new Error(
        "Renaming system root or system directory is forbidden for security.",
      );
    }

    const newDir = shellQuote(
      newNormalized.substring(0, newNormalized.lastIndexOf("/")) || "/",
    );

    const command = `test -d ${newDir} && mv -f -- ${shellQuote(oldNormalized)} ${shellQuote(newNormalized)}`;

    await this.execChecked(target, containerId, command);

    return { success: true };
  }

  async deleteItem(
    input: z.infer<typeof DeleteContainerItemInputSchema>,
  ): Promise<{ success: boolean }> {
    const { target, containerId } = await this.resolveTargetContainer(
      input.organizationId,
      input.resourceId,
      input.containerId,
    );

    const normalizedPath = assertValidContainerPath(input.path, "Delete path");
    if (DANGEROUS_SYSTEM_PATHS.has(normalizedPath) || normalizedPath === "/") {
      throw new Error(
        "Deletion of system root or system directory is forbidden for security.",
      );
    }

    const command = `rm -rf -- ${shellQuote(normalizedPath)}`;

    await this.execChecked(target, containerId, command);

    return { success: true };
  }

  async searchFiles(
    input: z.infer<typeof SearchContainerFilesInputSchema>,
  ): Promise<FileExplorerItem[]> {
    let target: DockerInspectionTarget;
    let containerId: string;
    try {
      ({ target, containerId } = await this.resolveTargetContainer(
        input.organizationId,
        input.resourceId,
        input.containerId,
      ));
    } catch (error) {
      if (!input.containerId && isNoActiveContainerError(error)) return [];
      throw error;
    }

    const normalizedPath = assertValidContainerPath(input.path, "Search path");
    const searchTerm = input.query.replace(/[*?]/g, "").trim();
    if (!searchTerm) return [];
    const safePattern = shellQuote(`*${searchTerm}*`);
    const command = `find ${shellQuote(normalizedPath)} -maxdepth 4 -name ${safePattern} -print 2>/dev/null | head -n 50 | while IFS= read -r filePath; do if [ -d "$filePath" ]; then type="directory"; elif [ -L "$filePath" ]; then type="symlink"; else type="file"; fi; printf '%s|%s\\n' "$type" "$filePath"; done`;

    const result = await this.execChecked(target, containerId, command);
    const lines = (result.output || "")
      .split("\n")
      .filter((l: string) => l.trim());

    return lines.map((line: string) => {
      const [rawType, ...pathParts] = line.split("|");
      const filePath = pathParts.length > 0 ? pathParts.join("|") : line;
      const type =
        rawType === "directory" || rawType === "symlink" ? rawType : "file";
      const name = filePath.split("/").pop() || filePath;
      return {
        name,
        path: filePath,
        type,
        sizeBytes: 0,
        permissions: "644",
        updatedAt: new Date().toISOString(),
      };
    });
  }

  private async execChecked(
    target: DockerInspectionTarget,
    containerId: string,
    command: string,
  ): Promise<{ output: string; stderr?: string; exitCode?: number }> {
    const result = await this.docker.execContainerCommand(
      target,
      containerId,
      command,
    );
    if (result.exitCode !== undefined && result.exitCode !== 0) {
      throw new Error(
        result.stderr?.trim() || "Container file operation failed.",
      );
    }
    return result;
  }
}
