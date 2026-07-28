"use client";

import {
  Cancel01Icon,
  Download01Icon,
  File01Icon,
  FolderIcon,
  FolderOpenIcon,
  PlusSignIcon,
  RefreshIcon,
  Search01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@upstand/ui/components/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@upstand/ui/components/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@upstand/ui/components/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@upstand/ui/components/tooltip";
import { cn } from "@upstand/ui/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";

interface ContainerFileExplorerProps {
  resourceId: string;
  initialContainerId?: string;
  initialPath?: string;
  title?: string;
  compact?: boolean;
}

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)),
    );
  }
  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer as ArrayBuffer;
}

export function ContainerFileExplorer({
  resourceId,
  initialContainerId,
  initialPath = "/",
  title = "Container Volume Explorer",
  compact = false,
}: ContainerFileExplorerProps) {
  const queryClient = useQueryClient();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [selectedContainer, setSelectedContainer] = useState<
    string | undefined
  >(initialContainerId);
  const hasActiveContainer = Boolean(selectedContainer);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [editingFileContent, setEditingFileContent] = useState<string>("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Modal dialog states
  const [newItemModal, setNewItemModal] = useState<"file" | "directory" | null>(
    null,
  );
  const [newItemParentPath, setNewItemParentPath] = useState<string>("/");
  const [newItemName, setNewItemName] = useState("");

  const [renameModalItem, setRenameModalItem] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [newRenamePath, setNewRenamePath] = useState("");

  const [deleteConfirmItem, setDeleteConfirmItem] = useState<{
    path: string;
    name: string;
  } | null>(null);

  const [chmodModalItem, setChmodModalItem] = useState<{
    path: string;
    name: string;
    permissions: string;
  } | null>(null);
  const [chmodMode, setChmodMode] = useState("0644");

  const [unsavedGuardAction, setUnsavedGuardAction] = useState<
    (() => void) | null
  >(null);

  const [targetUploadPath, setTargetUploadPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch list of containers for resource filter
  const { data: containersData = [] } = useQuery(
    trpc.resource.getContainers.queryOptions({ id: resourceId }),
  );

  // Auto-sync selected container if stale or dead
  useEffect(() => {
    if (containersData.length === 0) {
      if (selectedContainer !== undefined) {
        setSelectedContainer(undefined);
      }
      return;
    }

    if (containersData.length > 0) {
      const initialContainerExists = initialContainerId
        ? containersData.some(
            (c: { id: string; name: string }) =>
              c.id === initialContainerId ||
              c.id.startsWith(initialContainerId) ||
              initialContainerId.startsWith(c.id) ||
              c.name === initialContainerId,
          )
        : false;
      const exists = containersData.some(
        (c: { id: string; name: string }) =>
          c.id === selectedContainer ||
          c.id.startsWith(selectedContainer || "___") ||
          selectedContainer?.startsWith(c.id) ||
          c.name === selectedContainer,
      );
      if (initialContainerExists) {
        const matchingContainer = containersData.find(
          (c: { id: string; name: string }) =>
            c.id === initialContainerId ||
            c.id.startsWith(initialContainerId ?? "___") ||
            initialContainerId?.startsWith(c.id) ||
            c.name === initialContainerId,
        );
        if (matchingContainer && selectedContainer !== matchingContainer.id) {
          setSelectedContainer(matchingContainer.id);
        }
      } else if (!exists && containersData[0]) {
        setSelectedContainer(containersData[0].id);
      }
    }
  }, [containersData, initialContainerId, selectedContainer]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedSearchQuery(searchQuery.trim()),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset explorer state when the selected container changes
  useEffect(() => {
    setCurrentPath(initialPath);
    setSelectedFilePath(null);
    setSearchQuery("");
    setDebouncedSearchQuery("");
  }, [initialPath, selectedContainer]);

  // Fetch file list
  const {
    data: files = [],
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useQuery({
    ...trpc.containerFileManager.listFiles.queryOptions({
      resourceId,
      path: currentPath,
      containerId: selectedContainer,
    }),
    enabled: hasActiveContainer,
  });

  // Search files query (active when search query > 1 char)
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    ...trpc.containerFileManager.searchFiles.queryOptions({
      resourceId,
      query: debouncedSearchQuery,
      path: currentPath,
      containerId: selectedContainer,
    }),
    enabled: hasActiveContainer && debouncedSearchQuery.length > 1,
  });

  // Read file query
  const {
    data: readFileData,
    isFetching: isReadingFile,
    error: readFileError,
    refetch: refetchReadFile,
  } = useQuery({
    ...trpc.containerFileManager.readFile.queryOptions({
      resourceId,
      path: selectedFilePath ?? "",
      containerId: selectedContainer,
    }),
    enabled: Boolean(selectedFilePath),
  });

  useEffect(() => {
    if (readFileData?.content !== undefined) {
      setEditingFileContent(readFileData.content);
      setHasUnsavedChanges(false);
    }
  }, [readFileData]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Mutations
  const writeFileMutation = useMutation({
    ...trpc.containerFileManager.writeFile.mutationOptions(),
    onSuccess: () => {
      toast.success("File saved successfully");
      setHasUnsavedChanges(false);
      refetch();
    },
    onError: (err) => {
      toast.error(`Save failed: ${err.message}`);
    },
  });

  const createItemMutation = useMutation({
    ...trpc.containerFileManager.createItem.mutationOptions(),
    onSuccess: () => {
      toast.success(
        `${newItemModal === "directory" ? "Folder" : "File"} created successfully`,
      );
      setNewItemModal(null);
      setNewItemName("");
      refetch();
    },
    onError: (err) => {
      toast.error(`Creation failed: ${err.message}`);
    },
  });

  const renameItemMutation = useMutation({
    ...trpc.containerFileManager.renameItem.mutationOptions(),
    onSuccess: () => {
      toast.success("Item renamed successfully");
      setRenameModalItem(null);
      setNewRenamePath("");
      refetch();
    },
    onError: (err) => {
      toast.error(`Rename failed: ${err.message}`);
    },
  });

  const deleteItemMutation = useMutation({
    ...trpc.containerFileManager.deleteItem.mutationOptions(),
    onSuccess: () => {
      toast.success("Item deleted");
      if (
        selectedFilePath &&
        deleteConfirmItem &&
        selectedFilePath === deleteConfirmItem.path
      ) {
        setSelectedFilePath(null);
      }
      setDeleteConfirmItem(null);
      refetch();
    },
    onError: (err) => {
      toast.error(`Deletion failed: ${err.message}`);
    },
  });

  const changePermissionsMutation = useMutation({
    ...trpc.containerFileManager.changePermissions.mutationOptions(),
    onSuccess: () => {
      toast.success("Permissions updated successfully");
      setChmodModalItem(null);
      refetch();
    },
    onError: (err) => {
      toast.error(`Permission change failed: ${err.message}`);
    },
  });

  // This effect intentionally runs whenever the selected path changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedFilePath is the trigger for resetting editor state.
  useEffect(() => {
    setEditingFileContent("");
    setHasUnsavedChanges(false);
  }, [selectedFilePath]);

  const checkUnsavedAndRun = (action: () => void) => {
    if (hasUnsavedChanges) {
      setUnsavedGuardAction(() => action);
    } else {
      action();
    }
  };

  const handleSaveFile = useCallback(() => {
    if (!selectedFilePath) return;
    writeFileMutation.mutate({
      resourceId,
      path: selectedFilePath,
      content: editingFileContent,
      containerId: selectedContainer,
    });
  }, [
    selectedFilePath,
    editingFileContent,
    selectedContainer,
    resourceId,
    writeFileMutation,
  ]);

  // Keyboard shortcut listener for Save (Ctrl+S / Cmd+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        if (selectedFilePath && hasUnsavedChanges) {
          e.preventDefault();
          handleSaveFile();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFilePath, hasUnsavedChanges, handleSaveFile]);

  const handleDownloadFile = async (path: string, fileName: string) => {
    try {
      toast.loading("Preparing download…", { id: "downloading" });
      const result = await queryClient.fetchQuery(
        trpc.containerFileManager.readFile.queryOptions({
          resourceId,
          path,
          containerId: selectedContainer,
          encoding: "base64",
        }),
      );
      const blob = new Blob([base64ToArrayBuffer(result.content)], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("File downloaded", { id: "downloading" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Download failed: ${message}`, { id: "downloading" });
    }
  };

  const handleFileUploadSelect = (targetDir: string) => {
    setTargetUploadPath(targetDir);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      toast.error("Uploads are limited to 10 MB.");
      e.target.value = "";
      return;
    }
    const uploadDir = targetUploadPath || currentPath;
    const destPath =
      uploadDir === "/"
        ? `/${file.name}`
        : `${uploadDir.replace(/\/$/, "")}/${file.name}`;

    const reader = new FileReader();
    reader.onload = (event) => {
      const arrayBuffer = event.target?.result as ArrayBuffer;
      if (!arrayBuffer) return;
      const base64Content = arrayBufferToBase64(arrayBuffer);
      writeFileMutation.mutate(
        {
          resourceId,
          path: destPath,
          content: base64Content,
          isBase64: true,
          containerId: selectedContainer,
        },
        {
          onSuccess: () => {
            toast.success(`Uploaded ${file.name} to ${destPath}`);
            refetch();
          },
        },
      );
    };
    reader.onerror = () => toast.error(`Could not read ${file.name}.`);
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const pathParts = currentPath.split("/").filter(Boolean);
  const displayItems = debouncedSearchQuery.length > 1 ? searchResults : files;

  const navigateUp = () => {
    if (currentPath === "/") return;
    const lastSlash = currentPath.lastIndexOf("/");
    const parentPath = currentPath.substring(0, lastSlash) || "/";
    checkUnsavedAndRun(() => setCurrentPath(parentPath));
  };

  const lineCount = editingFileContent
    ? editingFileContent.split("\n").length
    : 0;
  const charCount = editingFileContent ? editingFileContent.length : 0;

  const handleFileRowKeyDown = (
    event: React.KeyboardEvent<HTMLTableRowElement>,
    action: () => void,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden border border-border bg-card text-card-foreground",
        compact
          ? "h-full min-h-0 rounded-lg shadow-none"
          : "h-[750px] rounded-xl shadow-lg",
      )}
    >
      {/* Hidden File Input for Container Upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Explorer Header & Control Toolbar */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 border-border/70 border-b bg-muted/40 py-2.5",
          compact ? "px-3" : "px-4",
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <HugeiconsIcon icon={FolderOpenIcon} className="h-4 w-4" />
            </span>
            <span className="font-semibold text-foreground text-sm tracking-tight">
              {title}
            </span>
          </div>

          {/* Container Selector Filter */}
          {containersData.length > 0 && (
            <Select
              items={[
                { value: "all", label: "All Containers / Default Volume" },
                ...containersData.map((c) => ({
                  value: c.id || c.name,
                  label: `🐳 ${c.name} (${c.id ? c.id.slice(0, 8) : "container"})`,
                })),
              ]}
              value={selectedContainer || "all"}
              onValueChange={(val) =>
                checkUnsavedAndRun(() =>
                  setSelectedContainer(
                    val === "all" || val === null ? undefined : val,
                  ),
                )
              }
            >
              <SelectTrigger
                size="sm"
                className="h-8 border-input bg-background font-medium text-foreground text-xs"
              >
                <SelectValue placeholder="All Containers / Default Volume" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  All Containers / Default Volume
                </SelectItem>
                {containersData.map((c) => (
                  <SelectItem key={c.id || c.name} value={c.id || c.name}>
                    🐳 {c.name} ({c.id ? c.id.slice(0, 8) : "container"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setNewItemParentPath(currentPath);
                    setNewItemModal("file");
                  }}
                  disabled={!hasActiveContainer}
                  className="h-8 font-medium text-xs"
                >
                  <HugeiconsIcon
                    icon={PlusSignIcon}
                    className="mr-1 h-3.5 w-3.5"
                  />
                  New File
                </Button>
              }
            />
            <TooltipContent>
              Create new file in current directory
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setNewItemParentPath(currentPath);
                    setNewItemModal("directory");
                  }}
                  disabled={!hasActiveContainer}
                  className="h-8 font-medium text-xs"
                >
                  <HugeiconsIcon
                    icon={FolderIcon}
                    className="mr-1 h-3.5 w-3.5"
                  />
                  New Folder
                </Button>
              }
            />
            <TooltipContent>
              Create new subfolder in current directory
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => handleFileUploadSelect(currentPath)}
                  disabled={!hasActiveContainer}
                  className="h-8 font-medium text-xs"
                >
                  <HugeiconsIcon
                    icon={Upload01Icon}
                    className="mr-1 h-3.5 w-3.5"
                  />
                  Upload File
                </Button>
              }
            />
            <TooltipContent>
              Upload local file to container folder
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => refetch()}
                  disabled={!hasActiveContainer || isRefetching}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  aria-label="Refresh directory"
                >
                  <HugeiconsIcon
                    icon={RefreshIcon}
                    className={cn("h-4 w-4", isRefetching && "animate-spin")}
                  />
                </Button>
              }
            />
            <TooltipContent>Refresh directory listing</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Split Layout */}
      <div
        className={cn(
          "grid min-h-0 flex-1 overflow-hidden",
          compact ? "grid-cols-12" : "grid-cols-1 md:grid-cols-12",
        )}
      >
        {/* Left Sidebar: File Tree & Navigation */}
        <div
          className={cn(
            "flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-border/70 border-r bg-card/40",
            compact ? "col-span-4" : "md:col-span-4 lg:col-span-4",
          )}
        >
          {/* Breadcrumb Path & Search */}
          <div className="space-y-2 border-border/50 border-b bg-muted/20 p-3">
            {/* Breadcrumb */}
            <div className="flex flex-wrap items-center justify-between gap-1 font-mono text-muted-foreground text-xs">
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => checkUnsavedAndRun(() => setCurrentPath("/"))}
                  className={cn(
                    "rounded px-1.5 py-0.5 transition-colors hover:text-primary",
                    currentPath === "/" &&
                      "bg-accent font-semibold text-accent-foreground",
                  )}
                >
                  / (root)
                </button>
                {pathParts.map((part, index) => {
                  const subPath = `/${pathParts.slice(0, index + 1).join("/")}`;
                  const isLast = index === pathParts.length - 1;
                  return (
                    <span key={subPath} className="flex items-center gap-1">
                      <span>/</span>
                      <button
                        type="button"
                        onClick={() =>
                          checkUnsavedAndRun(() => setCurrentPath(subPath))
                        }
                        className={cn(
                          "rounded px-1.5 py-0.5 transition-colors hover:text-primary",
                          isLast &&
                            "bg-accent font-semibold text-accent-foreground",
                        )}
                      >
                        {part}
                      </button>
                    </span>
                  );
                })}
              </div>

              {/* Volume Shortcuts */}
              <div className="flex items-center gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    checkUnsavedAndRun(() =>
                      setCurrentPath("/var/lib/postgresql/data"),
                    )
                  }
                  title="Jump to Postgres Data Volume"
                >
                  pgdata
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    checkUnsavedAndRun(() => setCurrentPath("/var/lib/mysql"))
                  }
                  title="Jump to MySQL Data Volume"
                >
                  mysql
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    checkUnsavedAndRun(() => setCurrentPath("/data"))
                  }
                  title="Jump to /data Volume"
                >
                  /data
                </Button>
              </div>
            </div>

            {/* Filter Input */}
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-muted-foreground"
              />
              <Input
                placeholder="Search files in container…"
                aria-label="Search files in container"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 bg-background pl-8 font-mono text-foreground text-xs"
              />
            </div>
          </div>

          {/* Directory File List */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!hasActiveContainer ? (
              <div
                className="flex h-48 flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground text-xs"
                role="status"
                aria-live="polite"
              >
                <span className="font-medium text-foreground">
                  No active container is available.
                </span>
                <span>
                  Deploy and start this resource before browsing its container
                  files.
                </span>
              </div>
            ) : isLoading || isSearching ? (
              <div
                className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground text-xs"
                role="status"
                aria-live="polite"
              >
                <Spinner className="h-5 w-5 text-primary" />
                <span>Reading container file system…</span>
              </div>
            ) : error ? (
              <div className="flex flex-col gap-3 p-4 text-destructive text-xs">
                <span>Error loading container files: {error.message}</span>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : (
              <ContextMenu>
                <ContextMenuTrigger
                  render={<div className="block min-h-full" />}
                >
                  <Table className="text-xs">
                    <TableHeader className="bg-muted/30">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-8 font-semibold">
                          Name
                        </TableHead>
                        <TableHead className="h-8 w-20 text-right font-semibold">
                          Size
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* Parent Directory Navigation Row */}
                      {currentPath !== "/" && !debouncedSearchQuery && (
                        <TableRow
                          onClick={navigateUp}
                          onKeyDown={(event) =>
                            handleFileRowKeyDown(event, navigateUp)
                          }
                          tabIndex={0}
                          role="button"
                          className="group cursor-pointer transition-colors hover:bg-accent/60"
                        >
                          <TableCell className="flex min-w-0 items-center gap-2 truncate py-2 font-mono text-muted-foreground">
                            <HugeiconsIcon
                              icon={FolderOpenIcon}
                              className="h-4 w-4 shrink-0 text-amber-500"
                            />
                            <span className="font-semibold">..</span>
                            <span className="text-[10px] text-muted-foreground">
                              (parent directory)
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-right font-mono text-muted-foreground">
                            --
                          </TableCell>
                        </TableRow>
                      )}

                      {displayItems.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={2}
                            className="p-6 text-center text-muted-foreground text-xs"
                          >
                            {debouncedSearchQuery.length > 1
                              ? `No files found for “${debouncedSearchQuery}”.`
                              : "Directory is empty."}
                          </TableCell>
                        </TableRow>
                      ) : (
                        displayItems.map((file) => (
                          <ContextMenu key={file.path}>
                            <ContextMenuTrigger
                              render={
                                <TableRow
                                  onClick={() => {
                                    checkUnsavedAndRun(() => {
                                      if (file.type === "directory") {
                                        setCurrentPath(file.path);
                                      } else {
                                        setSelectedFilePath(file.path);
                                      }
                                    });
                                  }}
                                  onKeyDown={(event) =>
                                    handleFileRowKeyDown(event, () => {
                                      checkUnsavedAndRun(() => {
                                        if (file.type === "directory") {
                                          setCurrentPath(file.path);
                                        } else {
                                          setSelectedFilePath(file.path);
                                        }
                                      });
                                    })
                                  }
                                  tabIndex={0}
                                  role="button"
                                  className={cn(
                                    "group cursor-pointer transition-colors hover:bg-accent/60",
                                    selectedFilePath === file.path &&
                                      "bg-accent font-medium text-accent-foreground",
                                  )}
                                />
                              }
                            >
                              <TableCell className="flex min-w-0 items-center gap-2 truncate py-2 font-mono text-foreground">
                                {file.type === "directory" ? (
                                  <HugeiconsIcon
                                    icon={FolderIcon}
                                    className="h-4 w-4 shrink-0 text-amber-500"
                                  />
                                ) : (
                                  <HugeiconsIcon
                                    icon={File01Icon}
                                    className="h-4 w-4 shrink-0 text-primary"
                                  />
                                )}
                                <span className="truncate">{file.name}</span>
                              </TableCell>
                              <TableCell className="py-2 text-right font-mono text-muted-foreground">
                                {file.type === "directory"
                                  ? "--"
                                  : `${Math.round(file.sizeBytes / 1024)} KB`}
                              </TableCell>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-52 font-mono text-xs">
                              {file.type === "directory" ? (
                                <ContextMenuItem
                                  onClick={() =>
                                    checkUnsavedAndRun(() =>
                                      setCurrentPath(file.path),
                                    )
                                  }
                                >
                                  📂 Open Directory
                                </ContextMenuItem>
                              ) : (
                                <ContextMenuItem
                                  onClick={() =>
                                    checkUnsavedAndRun(() =>
                                      setSelectedFilePath(file.path),
                                    )
                                  }
                                >
                                  📄 Open / Edit File
                                </ContextMenuItem>
                              )}
                              {file.type === "file" && (
                                <ContextMenuItem
                                  onClick={() =>
                                    handleDownloadFile(file.path, file.name)
                                  }
                                >
                                  📥 Download File
                                </ContextMenuItem>
                              )}
                              <ContextMenuItem
                                onClick={() => {
                                  setRenameModalItem({
                                    path: file.path,
                                    name: file.name,
                                  });
                                  setNewRenamePath(file.path);
                                }}
                              >
                                ✏️ Rename / Move
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => {
                                  setChmodModalItem({
                                    path: file.path,
                                    name: file.name,
                                    permissions: file.permissions || "0644",
                                  });
                                  const perm = file.permissions || "0644";
                                  setChmodMode(
                                    perm.length === 3 ? `0${perm}` : perm,
                                  );
                                }}
                              >
                                🔒 Change Permissions (chmod)
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() =>
                                  handleFileUploadSelect(
                                    file.type === "directory"
                                      ? file.path
                                      : currentPath,
                                  )
                                }
                              >
                                📤 Upload File Here
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => {
                                  setNewItemParentPath(
                                    file.type === "directory"
                                      ? file.path
                                      : currentPath,
                                  );
                                  setNewItemModal("file");
                                }}
                              >
                                📄 New File Here
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => {
                                  setNewItemParentPath(
                                    file.type === "directory"
                                      ? file.path
                                      : currentPath,
                                  );
                                  setNewItemModal("directory");
                                }}
                              >
                                📁 New Folder Here
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() =>
                                  setDeleteConfirmItem({
                                    path: file.path,
                                    name: file.name,
                                  })
                                }
                                className="text-destructive focus:text-destructive"
                              >
                                🗑️ Delete
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-52 font-mono text-xs">
                  <ContextMenuItem
                    onClick={() => handleFileUploadSelect(currentPath)}
                  >
                    📤 Upload File to {currentPath}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      setNewItemParentPath(currentPath);
                      setNewItemModal("file");
                    }}
                  >
                    📄 New File in {currentPath}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      setNewItemParentPath(currentPath);
                      setNewItemModal("directory");
                    }}
                  >
                    📁 New Folder in {currentPath}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )}
          </div>
        </div>

        {/* Right Main Editor Panel */}
        <div
          className={cn(
            "min-w-0 flex-col border-border bg-background text-foreground",
            compact
              ? "col-span-8 flex border-t-0"
              : "flex border-t md:col-span-8 md:border-t-0 lg:col-span-8",
          )}
        >
          {selectedFilePath ? (
            <div className="flex h-full flex-col">
              {/* Tab Header */}
              <div className="flex items-center justify-between border-border border-b bg-muted/40 px-4 py-2">
                <div className="flex items-center gap-2 truncate font-mono text-primary text-xs">
                  <HugeiconsIcon
                    icon={File01Icon}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="truncate font-semibold">
                    {selectedFilePath}
                  </span>
                  {hasUnsavedChanges && (
                    <span
                      className="h-2 w-2 rounded-full bg-amber-500"
                      title="Unsaved changes"
                    />
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    onClick={handleSaveFile}
                    disabled={writeFileMutation.isPending || !hasUnsavedChanges}
                    className="h-7 font-medium text-xs"
                  >
                    {writeFileMutation.isPending ? "Saving…" : "Save (Ctrl+S)"}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      handleDownloadFile(
                        selectedFilePath,
                        selectedFilePath.split("/").pop() || "file",
                      )
                    }
                    className="h-7 text-xs"
                    aria-label="Download file"
                  >
                    <HugeiconsIcon
                      icon={Download01Icon}
                      className="h-3.5 w-3.5"
                    />
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      checkUnsavedAndRun(() => setSelectedFilePath(null))
                    }
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    aria-label="Close file editor"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Code Editor Body */}
              <div className="relative flex-1 overflow-hidden">
                {isReadingFile ? (
                  <div
                    className="flex h-full items-center justify-center gap-2 text-muted-foreground text-xs"
                    role="status"
                    aria-live="polite"
                  >
                    <Spinner className="h-5 w-5 text-primary" />
                    <span>Loading file contents…</span>
                  </div>
                ) : readFileError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-destructive text-xs">
                    <p>Could not read this file: {readFileError.message}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void refetchReadFile()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (
                  <textarea
                    value={editingFileContent}
                    onChange={(e) => {
                      setEditingFileContent(e.target.value);
                      setHasUnsavedChanges(true);
                    }}
                    className="h-full w-full resize-none border-none bg-background p-4 font-mono text-foreground text-xs leading-relaxed outline-none selection:bg-primary/20 focus-visible:ring-2 focus-visible:ring-primary/50"
                    placeholder="Empty file content…"
                    spellCheck={false}
                    aria-label={`Editing ${selectedFilePath}`}
                  />
                )}
              </div>

              {/* Editor Status Bar */}
              <div className="flex items-center justify-between border-border border-t bg-muted/30 px-4 py-1.5 font-mono text-[10px] text-muted-foreground">
                <span>
                  Lines: {lineCount} · Chars: {charCount}
                </span>
                <span>UTF-8 · Container Volume</span>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
              <HugeiconsIcon
                icon={FolderOpenIcon}
                className="h-12 w-12 text-muted-foreground/50"
              />
              <div className="space-y-1">
                <p className="font-semibold text-foreground text-sm">
                  No File Selected
                </p>
                <p className="max-w-sm text-xs">
                  Select a file from the explorer list or right-click to open,
                  rename, upload, or create new files inside your container
                  volume.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Dialog for New File / Folder */}
      <Dialog
        open={Boolean(newItemModal)}
        onOpenChange={(open) => !open && setNewItemModal(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              Create New {newItemModal === "directory" ? "Folder" : "File"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Path:{" "}
              <span className="font-mono font-semibold text-foreground">
                {newItemParentPath}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="item-name" className="font-medium text-xs">
              Name
            </Label>
            <Input
              id="item-name"
              name="item-name"
              autoComplete="off"
              placeholder={
                newItemModal === "directory" ? "my-folder" : "config.env"
              }
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewItemModal(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!newItemName.trim() || !newItemModal) return;
                createItemMutation.mutate({
                  resourceId,
                  parentPath: newItemParentPath,
                  name: newItemName.trim(),
                  type: newItemModal,
                  containerId: selectedContainer,
                });
              }}
              disabled={createItemMutation.isPending || !newItemName.trim()}
            >
              {createItemMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Dialog for Rename / Move */}
      <Dialog
        open={Boolean(renameModalItem)}
        onOpenChange={(open) => !open && setRenameModalItem(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              Rename / Move Item
            </DialogTitle>
            <DialogDescription className="text-xs">
              Original:{" "}
              <span className="font-mono font-semibold text-foreground">
                {renameModalItem?.path}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="rename-path" className="font-medium text-xs">
              New Path
            </Label>
            <Input
              id="rename-path"
              name="rename-path"
              autoComplete="off"
              aria-label="New file path"
              value={newRenamePath}
              onChange={(e) => setNewRenamePath(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenameModalItem(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!renameModalItem || !newRenamePath.trim()) return;
                renameItemMutation.mutate({
                  resourceId,
                  oldPath: renameModalItem.path,
                  newPath: newRenamePath.trim(),
                  containerId: selectedContainer,
                });
              }}
              disabled={renameItemMutation.isPending || !newRenamePath.trim()}
            >
              {renameItemMutation.isPending ? "Renaming..." : "Save Path"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Dialog for Delete Confirmation */}
      <Dialog
        open={Boolean(deleteConfirmItem)}
        onOpenChange={(open) => !open && setDeleteConfirmItem(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-destructive text-sm">
              Confirm Deletion
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to delete{" "}
              <span className="font-mono font-semibold text-foreground">
                {deleteConfirmItem?.name}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmItem(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (!deleteConfirmItem) return;
                deleteItemMutation.mutate({
                  resourceId,
                  path: deleteConfirmItem.path,
                  containerId: selectedContainer,
                });
              }}
              disabled={deleteItemMutation.isPending}
            >
              {deleteItemMutation.isPending ? "Deleting..." : "Delete Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Guard Dialog */}
      <Dialog
        open={Boolean(unsavedGuardAction)}
        onOpenChange={(open) => !open && setUnsavedGuardAction(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-amber-500 text-sm">
              Unsaved Changes
            </DialogTitle>
            <DialogDescription className="text-xs">
              You have unsaved changes in{" "}
              <span className="font-mono font-semibold text-foreground">
                {selectedFilePath}
              </span>
              . Discard changes and proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUnsavedGuardAction(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const action = unsavedGuardAction;
                setHasUnsavedChanges(false);
                setUnsavedGuardAction(null);
                if (action) action();
              }}
            >
              Discard Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Permissions (chmod) Dialog */}
      <Dialog
        open={chmodModalItem !== null}
        onOpenChange={(open) => {
          if (!open) setChmodModalItem(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change Permissions (chmod)</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              Modify file permissions for{" "}
              <span className="font-semibold text-primary">
                {chmodModalItem?.name}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="chmod-mode" className="text-xs">
                Octal Permission Mode (e.g. 0644, 0755, 0777)
              </Label>
              <Input
                id="chmod-mode"
                placeholder="0644"
                value={chmodMode}
                onChange={(e) => setChmodMode(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setChmodMode("0644")}
                className="h-6 text-[10px]"
              >
                0644 (File Default)
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setChmodMode("0755")}
                className="h-6 text-[10px]"
              >
                0755 (Dir/Exec)
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setChmodMode("0600")}
                className="h-6 text-[10px]"
              >
                0600 (Private)
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setChmodMode("0777")}
                className="h-6 text-[10px]"
              >
                0777 (Full Access)
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChmodModalItem(null)}
              disabled={changePermissionsMutation.isPending}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!chmodModalItem) return;
                changePermissionsMutation.mutate({
                  resourceId,
                  containerId: selectedContainer,
                  path: chmodModalItem.path,
                  mode: chmodMode,
                });
              }}
              disabled={changePermissionsMutation.isPending}
              className="text-xs"
            >
              {changePermissionsMutation.isPending
                ? "Applying…"
                : "Apply Permissions"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
