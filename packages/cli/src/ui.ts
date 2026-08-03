import { Box, createCliRenderer, Text } from "@opentui/core";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";

export type UiTone = "default" | "success" | "error" | "muted";

const colors: Record<UiTone, string> = {
  default: "#E5E7EB",
  success: "#86EFAC",
  error: "#FCA5A5",
  muted: "#9CA3AF",
};

export function isInteractiveTerminal(): boolean {
  return Boolean(
    process.stdout.isTTY && process.stdin.isTTY && !process.env.CI,
  );
}

export async function renderMessage(
  message: string,
  tone: UiTone = "default",
): Promise<void> {
  if (!isInteractiveTerminal()) {
    if (tone === "error") process.stderr.write(`${message}\n`);
    else process.stdout.write(`${message}\n`);
    return;
  }
  const renderer = await createCliRenderer({
    screenMode: "main-screen",
    useMouse: false,
    exitOnCtrlC: true,
    targetFps: 30,
  });
  const keymap = createDefaultOpenTuiKeymap(renderer);
  keymap.registerLayer({
    bindings: [{ key: "q", cmd: "cli.quit" }],
    commands: [
      {
        name: "cli.quit",
        run: () => {
          renderer.destroy();
        },
      },
    ],
  });
  renderer.root.add(
    Box(
      { flexDirection: "column", padding: 1, width: "100%" },
      Text({ content: message, fg: colors[tone], wrapMode: "word" }),
    ),
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  renderer.destroy();
}

export async function renderJson(value: unknown): Promise<void> {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
