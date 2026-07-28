export const VOLUME_COLOR = "#f97316"; // Orange
export const SERVER_COLOR = "#3b82f6"; // Blue

const NETWORK_PALETTE = [
  "#06b6d4", // Cyan
  "#10b981", // Emerald
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#f59e0b", // Amber
  "#6366f1", // Indigo
  "#14b8a6", // Teal
  "#84cc16", // Lime
];

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

export function networkColor(networkName: string): string {
  if (networkName === "bridge") return "#64748b"; // Slate
  if (networkName === "host") return "#ef4444"; // Red
  if (networkName === "none") return "#475569";
  const index = djb2Hash(networkName) % NETWORK_PALETTE.length;
  return NETWORK_PALETTE[index];
}

export function getStatusColor(status?: string): {
  bg: string;
  text: string;
  dot: string;
} {
  const s = (status ?? "").toLowerCase();
  if (s.includes("run") || s === "healthy" || s === "ready") {
    return { bg: "rgba(16, 185, 129, 0.15)", text: "#10b981", dot: "#10b981" };
  }
  if (s.includes("pause") || s.includes("restart")) {
    return { bg: "rgba(245, 158, 11, 0.15)", text: "#f59e0b", dot: "#f59e0b" };
  }
  if (
    s.includes("exit") ||
    s.includes("stop") ||
    s.includes("dead") ||
    s === "down"
  ) {
    return { bg: "rgba(239, 68, 68, 0.15)", text: "#ef4444", dot: "#ef4444" };
  }
  return { bg: "rgba(148, 163, 184, 0.15)", text: "#94a3b8", dot: "#94a3b8" };
}
