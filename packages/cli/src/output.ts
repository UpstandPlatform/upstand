import type { OutputMode } from "./types";
import { renderJson, renderMessage, type UiTone } from "./ui";

export class Output {
  constructor(private readonly mode: OutputMode) {}

  async value(value: unknown, label?: string): Promise<void> {
    if (this.mode === "json") return renderJson(value);
    if (this.mode === "silent") return;
    await renderMessage(
      label ? `${label}\n${formatValue(value)}` : formatValue(value),
    );
  }

  async message(message: string, tone: UiTone = "default"): Promise<void> {
    if (this.mode === "silent" || this.mode === "json") return;
    await renderMessage(message, tone);
  }

  async error(message: string): Promise<void> {
    if (this.mode === "json") return renderJson({ error: message });
    if (this.mode !== "silent") await renderMessage(message, "error");
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.length
      ? value
          .map((item, index) => `${index + 1}. ${formatValue(item)}`)
          .join("\n")
      : "No results.";
  if (typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${formatValue(item)}`)
      .join("\n");
  return String(value);
}
