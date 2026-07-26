// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { defineUpGalTarget, UpGalTarget } from "./upgal-target";

describe("UpGalTarget", () => {
  test("keeps the wrapped control content while adding typed metadata", () => {
    const markup = renderToStaticMarkup(
      <UpGalTarget
        definition={defineUpGalTarget({
          id: "create-project",
          label: "Create project button",
          kind: "button",
          action: "open_dialog",
        })}
      >
        <button type="button">Create project</button>
      </UpGalTarget>,
    );

    expect(markup).toContain('data-upgal-target="create-project"');
    expect(markup).toContain('data-upgal-action="open_dialog"');
    expect(markup).toContain(">Create project</button>");
  });
});
