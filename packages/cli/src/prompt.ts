import {
  Box,
  createCliRenderer,
  Input,
  InputRenderableEvents,
  Select,
  SelectRenderableEvents,
  Text,
} from "@opentui/core";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { isInteractiveTerminal } from "./ui";

export type PromptOption = {
  label: string;
  value: string;
  description?: string;
};

function ensureInteractive(): void {
  if (!isInteractiveTerminal()) {
    throw new Error(
      "This value is required. Provide it as an option or run the command in an interactive terminal.",
    );
  }
}

function promptRenderer(title: string) {
  return createCliRenderer({
    screenMode: "main-screen",
    useMouse: false,
    exitOnCtrlC: true,
    targetFps: 30,
  }).then((renderer) => {
    renderer.root.add(
      Box(
        { flexDirection: "column", padding: 1, width: "100%", gap: 1 },
        Text({ content: title, fg: "#E5E7EB" }),
      ),
    );
    return renderer;
  });
}

export async function promptText(
  title: string,
  initialValue = "",
): Promise<string> {
  ensureInteractive();
  const renderer = await promptRenderer(title);
  const input = Input({
    value: initialValue,
    placeholder: "Type a value and press Enter",
    width: 70,
    focusedBackgroundColor: "#1F2937",
    cursorColor: "#86EFAC",
    minLength: 1,
  });
  renderer.root.add(input);
  input.focus();

  return new Promise<string>((resolve, reject) => {
    const keymap = createDefaultOpenTuiKeymap(renderer);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      renderer.destroy();
      callback();
    };
    input.on(InputRenderableEvents.ENTER, (value: string) => {
      finish(() => resolve(value.trim()));
    });
    keymap.registerLayer({
      bindings: [{ key: "escape", cmd: "prompt.cancel" }],
      commands: [
        {
          name: "prompt.cancel",
          run: () => finish(() => reject(new Error("Prompt cancelled."))),
        },
      ],
    });
  });
}

export async function promptSelect(
  title: string,
  options: PromptOption[],
): Promise<string> {
  ensureInteractive();
  if (options.length === 0)
    throw new Error(`No choices available for ${title}.`);
  const renderer = await promptRenderer(title);
  const select = Select({
    width: 70,
    height: Math.min(12, Math.max(4, options.length + 1)),
    options: options.map((option) => ({
      name: option.label,
      description: option.description ?? "",
      value: option.value,
    })),
    selectedBackgroundColor: "#1F2937",
    selectedTextColor: "#86EFAC",
  });
  renderer.root.add(select);
  select.focus();

  return new Promise<string>((resolve, reject) => {
    const keymap = createDefaultOpenTuiKeymap(renderer);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      renderer.destroy();
      callback();
    };
    select.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option) => {
      finish(() => resolve(String(option.value)));
    });
    keymap.registerLayer({
      bindings: [{ key: "escape", cmd: "prompt.cancel" }],
      commands: [
        {
          name: "prompt.cancel",
          run: () => finish(() => reject(new Error("Prompt cancelled."))),
        },
      ],
    });
  });
}

export async function promptConfirm(title: string): Promise<boolean> {
  const value = await promptSelect(title, [
    { label: "Yes", value: "yes", description: "Continue this operation" },
    {
      label: "No",
      value: "no",
      description: "Cancel and leave everything unchanged",
    },
  ]);
  return value === "yes";
}
