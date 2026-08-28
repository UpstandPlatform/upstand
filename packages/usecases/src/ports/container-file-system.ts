import type { DockerInspectionTarget } from "./docker";

export interface ContainerVolumeMount {
  type: "volume";
  name: string;
  destination: string;
  readOnly: boolean;
}

export type ContainerFileItemType = "file" | "directory" | "symlink" | "other";

export interface ContainerFileItem {
  name: string;
  path: string;
  type: ContainerFileItemType;
  sizeBytes: number;
  permissions: string;
  updatedAt: string;
}

export interface ContainerFileSystemPort {
  getContainerMounts(
    target: DockerInspectionTarget,
    containerId: string,
    resourceId: string,
  ): Promise<ContainerVolumeMount[]>;
  listFiles(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    path: string,
    resourceId: string,
  ): Promise<ContainerFileItem[]>;
  readFile(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    path: string,
    encoding: "text" | "base64",
    resourceId: string,
  ): Promise<{ content: string }>;
  writeFile(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    path: string,
    contentBase64: string,
    resourceId: string,
  ): Promise<void>;
  createItem(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    path: string,
    type: "file" | "directory",
    resourceId: string,
  ): Promise<void>;
  renameItem(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    oldPath: string,
    newPath: string,
    resourceId: string,
  ): Promise<void>;
  deleteItem(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    path: string,
    resourceId: string,
  ): Promise<void>;
  changePermissions(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    path: string,
    mode: string,
    resourceId: string,
  ): Promise<void>;
  searchFiles(
    target: DockerInspectionTarget,
    containerId: string,
    mountPath: string,
    path: string,
    query: string,
    resourceId: string,
  ): Promise<ContainerFileItem[]>;
}
