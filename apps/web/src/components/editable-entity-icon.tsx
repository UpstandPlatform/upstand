"use client";

import { Button } from "@upstand/ui/components/button";
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
import { Spinner } from "@upstand/ui/components/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@upstand/ui/components/tabs";
import { cn } from "@upstand/ui/lib/utils";
import Image from "next/image";
import type React from "react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { AlertTriangleIcon, Pencil, Trash2Icon } from "@/components/huge-icons";
import {
  compressAndConvertToDataUri,
  PRESET_ICON_OPTIONS,
  validateImageFile,
} from "@/lib/icon-utils";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface EditableEntityIconProps {
  icon?: string | null;
  defaultIcon: React.ReactNode;
  entityName: string;
  entityType?: "project" | "resource" | "profile" | string;
  sizeClassName?: string;
  iconSizeClassName?: string;
  bgClassName?: string;
  onSaveIcon: (newIcon: string | null) => Promise<void>;
  disabled?: boolean;
}

export function RenderEntityIcon({
  icon,
  defaultIcon,
  className = "size-full object-cover rounded-[inherit]",
}: {
  icon?: string | null;
  defaultIcon: React.ReactNode;
  className?: string;
}) {
  if (!icon) {
    return <>{defaultIcon}</>;
  }

  if (icon.startsWith("preset:")) {
    const preset = PRESET_ICON_OPTIONS.find((p) => p.id === icon);
    if (preset?.Icon) {
      const PresetIcon = preset.Icon;
      return (
        <PresetIcon
          className={cn("size-1/2 shrink-0 text-foreground", className)}
        />
      );
    }
  }

  if (
    icon.startsWith("data:image/") ||
    icon.startsWith("http://") ||
    icon.startsWith("https://")
  ) {
    return (
      <Image
        src={icon}
        alt="Icon"
        fill
        unoptimized
        className={className}
        onError={(e) => {
          // Fallback if image URL fails to load
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }

  return <>{defaultIcon}</>;
}

export function EditableEntityIcon({
  icon,
  defaultIcon,
  entityName,
  entityType = "project",
  sizeClassName = "size-9 rounded-full",
  bgClassName = "bg-primary/10 text-primary",
  onSaveIcon,
  disabled = false,
}: EditableEntityIconProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "presets" | "url">(
    "upload",
  );
  const [selectedIcon, setSelectedIcon] = useState<string | null>(icon ?? null);
  const [urlInput, setUrlInput] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const fileInputId = useId();

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setSelectedIcon(icon ?? null);
    setValidationError(null);
    if (icon && (icon.startsWith("http://") || icon.startsWith("https://"))) {
      setUrlInput(icon);
      setActiveTab("url");
    } else if (icon?.startsWith("preset:")) {
      setActiveTab("presets");
    } else {
      setActiveTab("upload");
    }
    setModalOpen(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setValidationError(null);
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setValidationError(validation.error || "Invalid file");
      return;
    }

    try {
      setIsProcessing(true);
      const dataUri = await compressAndConvertToDataUri(file, 256);
      setSelectedIcon(dataUri);
    } catch (error: unknown) {
      setValidationError(errorMessage(error) || "Failed to process image file");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUrlApply = () => {
    setValidationError(null);
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setValidationError("Please enter a valid URL");
      return;
    }
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      setValidationError("URL must start with http:// or https://");
      return;
    }
    setSelectedIcon(trimmed);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSaveIcon(selectedIcon);
      toast.success(
        `Changed ${entityType} icon for "${entityName}" successfully`,
      );
      setModalOpen(false);
    } catch (error: unknown) {
      toast.error(errorMessage(error) || "Failed to save icon");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefault = async () => {
    setSelectedIcon(null);
    try {
      setIsSaving(true);
      await onSaveIcon(null);
      toast.success(`Reset icon for "${entityName}" to default`);
      setModalOpen(false);
    } catch (error: unknown) {
      toast.error(errorMessage(error) || "Failed to reset icon");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div
        onClick={handleOpen}
        className={cn(
          "group/icon relative flex shrink-0 items-center justify-center overflow-hidden transition-all duration-200",
          sizeClassName,
          bgClassName,
          !disabled && "cursor-pointer hover:ring-2 hover:ring-primary/40",
        )}
        title={disabled ? undefined : `Click to change ${entityType} icon`}
      >
        <RenderEntityIcon icon={icon} defaultIcon={defaultIcon} />

        {!disabled && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-black/60 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover/icon:opacity-100">
            <Pencil className="size-4 text-white" aria-hidden="true" />
          </div>
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="flex max-h-[85vh] w-[92vw] max-w-md flex-col gap-0 overflow-hidden rounded-2xl border border-border/50 bg-card p-0 shadow-2xl">
          <DialogHeader className="shrink-0 border-border/40 border-b p-5">
            <DialogTitle className="font-bold text-xl">Change Icon</DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              Customize icon for{" "}
              <span className="font-semibold text-foreground">
                {entityName}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {/* Current Selected Preview */}
            <div className="flex items-center gap-4 rounded-xl border border-border/40 bg-accent/20 p-3">
              <div
                className={cn(
                  "relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full",
                  bgClassName,
                )}
              >
                <RenderEntityIcon
                  icon={selectedIcon}
                  defaultIcon={defaultIcon}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground text-sm">
                  Icon Preview
                </p>
                <p className="truncate text-muted-foreground text-xs">
                  {selectedIcon
                    ? selectedIcon.startsWith("data:")
                      ? "Custom uploaded image"
                      : selectedIcon.startsWith("preset:")
                        ? `Preset: ${PRESET_ICON_OPTIONS.find((p) => p.id === selectedIcon)?.label || selectedIcon.slice(7)}`
                        : selectedIcon
                    : "Default icon"}
                </p>
              </div>
              {selectedIcon && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIcon(null)}
                  title="Clear custom icon"
                  className="size-8 p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              )}
            </div>

            {validationError && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-destructive text-xs">
                <AlertTriangleIcon className="size-4 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            {/* Selector Tabs */}
            <Tabs
              value={activeTab}
              onValueChange={(v) => {
                if (v === "upload" || v === "presets" || v === "url") {
                  setActiveTab(v);
                }
                setValidationError(null);
              }}
            >
              <TabsList className="grid w-full grid-cols-3 border border-border/40 bg-muted/30">
                <TabsTrigger value="upload" className="text-xs">
                  Upload File
                </TabsTrigger>
                <TabsTrigger value="presets" className="text-xs">
                  Presets
                </TabsTrigger>
                <TabsTrigger value="url" className="text-xs">
                  Image URL
                </TabsTrigger>
              </TabsList>

              {/* Upload Tab */}
              <TabsContent value="upload" className="space-y-3 pt-3">
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-border/60 border-dashed p-6 text-center transition-colors hover:border-primary/50">
                  <Input
                    id={fileInputId}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <Label
                    htmlFor={fileInputId}
                    className="flex cursor-pointer flex-col items-center gap-2"
                  >
                    {isProcessing ? (
                      <Spinner className="size-8 text-primary" />
                    ) : (
                      <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Pencil className="size-5" />
                      </div>
                    )}
                    <span className="font-medium text-foreground text-sm">
                      Click to choose or drag image file
                    </span>
                    <span className="text-muted-foreground text-xs">
                      PNG, JPEG, WebP, GIF, or SVG (Max 2MB, resized to 256px)
                    </span>
                  </Label>
                </div>
              </TabsContent>

              {/* Presets Tab */}
              <TabsContent value="presets" className="space-y-3 pt-3">
                <div className="grid grid-cols-4 gap-2">
                  {[...PRESET_ICON_OPTIONS]
                    .sort((a, b) => {
                      if (
                        a.category === entityType &&
                        b.category !== entityType
                      )
                        return -1;
                      if (
                        a.category !== entityType &&
                        b.category === entityType
                      )
                        return 1;
                      return 0;
                    })
                    .map((preset) => {
                      const PresetIcon = preset.Icon;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setSelectedIcon(preset.id);
                            setValidationError(null);
                          }}
                          className={cn(
                            "flex flex-col items-center justify-center rounded-xl border p-2.5 transition-all hover:border-primary/50 hover:bg-accent/40",
                            selectedIcon === preset.id
                              ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/30"
                              : "border-border/40 bg-card/50 text-foreground",
                          )}
                        >
                          <div className="flex size-7 items-center justify-center">
                            <PresetIcon className="size-5 shrink-0 text-foreground" />
                          </div>
                          <span className="mt-1 w-full truncate text-center font-medium text-[10px] text-muted-foreground">
                            {preset.label}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </TabsContent>

              {/* URL Tab */}
              <TabsContent value="url" className="space-y-3 pt-3">
                <div className="space-y-2">
                  <Label htmlFor="icon-url" className="text-xs">
                    Image Address (HTTP/HTTPS)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="icon-url"
                      placeholder="https://example.com/logo.png"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      className="border-border/40 text-xs focus:border-primary"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleUrlApply}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="shrink-0 border-border/40 border-t bg-muted/20 p-4">
            <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isSaving || !icon}
                onClick={handleResetToDefault}
                className="w-full justify-center text-muted-foreground text-xs hover:text-foreground sm:w-auto"
              >
                Reset to Default
              </Button>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setModalOpen(false)}
                  disabled={isSaving}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving || isProcessing}
                  className="w-full gap-2 sm:w-auto"
                >
                  {isSaving && <Spinner className="size-3.5" />}
                  Save Icon
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
