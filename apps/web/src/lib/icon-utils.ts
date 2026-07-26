export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];

export const MAX_RAW_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateImageFile(file: File): ValidationResult {
  if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
    return {
      valid: false,
      error:
        "Unsupported file format. Please select a PNG, JPEG, WebP, GIF, or SVG image.",
    };
  }

  if (file.size > MAX_RAW_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: "Selected file exceeds the maximum size limit of 2MB.",
    };
  }

  return { valid: true };
}

/**
 * Resizes raster images using HTML Canvas to a max dimension (default 256px)
 * and returns a compressed WebP/PNG Data URI. Passes SVGs through as Data URIs.
 */
export async function compressAndConvertToDataUri(
  file: File,
  maxDimension = 256,
): Promise<string> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Handle SVG directly
  if (file.type.toLowerCase().includes("svg")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read SVG file"));
      reader.readAsDataURL(file);
    });
  }

  // Handle raster images (PNG, JPEG, WebP, GIF)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get 2D canvas context"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Try WebP first for ultra-light compression, fallback to PNG
        let dataUrl = canvas.toDataURL("image/webp", 0.85);
        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/png");
        }

        resolve(dataUrl);
      };

      img.onerror = () => reject(new Error("Failed to load image into canvas"));
      img.src = e.target?.result as string;
    };

    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

import {
  Activity,
  Bot,
  Boxes,
  Briefcase,
  Code2,
  Cpu,
  Database,
  FolderIcon,
  Globe,
  HardDrive,
  type HugeIcon,
  KeyRound,
  Layers,
  Network,
  PackageIcon,
  Rocket,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserRound,
  Users,
} from "@/components/huge-icons";

export interface PresetIconOption {
  id: string;
  label: string;
  category: "project" | "resource" | "profile" | "general";
  Icon: HugeIcon;
}

// Entity-Specific Vector Preset Icon Options
export const PRESET_ICON_OPTIONS: PresetIconOption[] = [
  // --- Project Presets ---
  {
    id: "preset:folder",
    label: "Project Folder",
    category: "project",
    Icon: FolderIcon,
  },
  {
    id: "preset:rocket",
    label: "Deployment Rocket",
    category: "project",
    Icon: Rocket,
  },
  {
    id: "preset:boxes",
    label: "Cluster Services",
    category: "project",
    Icon: Boxes,
  },
  {
    id: "preset:layers",
    label: "App Stack",
    category: "project",
    Icon: Layers,
  },
  { id: "preset:code", label: "Source Code", category: "project", Icon: Code2 },
  {
    id: "preset:globe",
    label: "Web Service",
    category: "project",
    Icon: Globe,
  },
  {
    id: "preset:package",
    label: "Build Package",
    category: "project",
    Icon: PackageIcon,
  },

  // --- Resource Presets ---
  {
    id: "preset:database",
    label: "Database Engine",
    category: "resource",
    Icon: Database,
  },
  {
    id: "preset:server",
    label: "Server Node",
    category: "resource",
    Icon: Server,
  },
  {
    id: "preset:terminal",
    label: "CLI / Console",
    category: "resource",
    Icon: Terminal,
  },
  {
    id: "preset:cpu",
    label: "Processor Unit",
    category: "resource",
    Icon: Cpu,
  },
  {
    id: "preset:harddrive",
    label: "Storage Volume",
    category: "resource",
    Icon: HardDrive,
  },
  {
    id: "preset:network",
    label: "Virtual Network",
    category: "resource",
    Icon: Network,
  },
  {
    id: "preset:shield",
    label: "Security Gateway",
    category: "resource",
    Icon: ShieldCheck,
  },
  {
    id: "preset:activity",
    label: "Monitor Stream",
    category: "resource",
    Icon: Activity,
  },

  // --- Profile / User Presets ---
  {
    id: "preset:user",
    label: "Personal Account",
    category: "profile",
    Icon: UserRound,
  },
  {
    id: "preset:users",
    label: "Team Member",
    category: "profile",
    Icon: Users,
  },
  {
    id: "preset:developer",
    label: "Developer",
    category: "profile",
    Icon: Code2,
  },
  {
    id: "preset:admin",
    label: "Admin / Ops",
    category: "profile",
    Icon: ShieldCheck,
  },
  { id: "preset:bot", label: "AI Agent", category: "profile", Icon: Bot },
  {
    id: "preset:sparkles",
    label: "Pro Account",
    category: "profile",
    Icon: Sparkles,
  },
  {
    id: "preset:key",
    label: "Access Token",
    category: "profile",
    Icon: KeyRound,
  },
  {
    id: "preset:briefcase",
    label: "Organization",
    category: "profile",
    Icon: Briefcase,
  },
];
