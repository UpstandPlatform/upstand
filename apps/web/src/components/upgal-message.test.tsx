import { describe, expect, test } from "bun:test";
import type { UpGalUIMessage } from "@upstand/api/ai/upgal";
import { renderToStaticMarkup } from "react-dom/server";
import { UpGalMessage } from "./upgal-message";

function renderMessage(
  role: UpGalUIMessage["role"],
  parts: UpGalUIMessage["parts"],
) {
  return renderToStaticMarkup(
    <UpGalMessage
      approve={() => undefined}
      message={{ id: "message-1", parts, role } as UpGalUIMessage}
    />,
  );
}

describe("UpGalMessage", () => {
  test("renders adjacent tool calls as readable trace entries", () => {
    const markup = renderMessage("assistant", [
      {
        type: "tool-list_projects",
        toolCallId: "tool-1",
        state: "output-available",
        input: {},
        output: [],
      },
      {
        type: "tool-list_environments",
        toolCallId: "tool-2",
        state: "output-available",
        input: { projectId: "project-1" },
        output: [],
      },
    ] as UpGalUIMessage["parts"]);

    expect(markup).toContain('data-slot="trace"');
    expect(markup).toContain("Completed project lookup");
    expect(markup).toContain("Completed environment lookup");
  });

  test("shows uploaded file names and media types in the message", () => {
    const markup = renderMessage("user", [
      {
        type: "file",
        url: "data:text/plain;base64,bG9ncw==",
        filename: "deploy.log",
        mediaType: "text/plain",
      },
    ] as UpGalUIMessage["parts"]);

    expect(markup).toContain("deploy.log");
    expect(markup).toContain("text/plain");
  });
});
