export type UiTone = "default" | "success" | "error" | "muted";

export function isInteractiveTerminal(): boolean {
  return Boolean(
    process.stdout.isTTY && process.stdin.isTTY && !process.env.CI,
  );
}

export async function renderMessage(
  message: string,
  tone: UiTone = "default",
): Promise<void> {
  // One-shot command output must remain in scrollback. Rendering it in an
  // OpenTUI main screen and destroying the renderer restores the terminal and
  // clears the message, making commands appear to print and immediately exit.
  // OpenTUI remains appropriate for interactive prompts, which own their
  // renderer lifecycle until the user completes them.
  if (tone === "error") process.stderr.write(`${message}\n`);
  else process.stdout.write(`${message}\n`);
}

export async function renderJson(value: unknown): Promise<void> {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
