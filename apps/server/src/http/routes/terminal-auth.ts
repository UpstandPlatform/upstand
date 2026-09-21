export function decodeTerminalControlFrame(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (data instanceof Uint8Array) return Buffer.from(data).toString("utf8");
  return null;
}
