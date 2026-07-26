import { describe, expect, test } from "bun:test";
import {
  buildUpGalInstructions,
  UPGAL_INTENT_RULES,
  UPGAL_TEMPLATE_GENERATION_RULES,
} from "./upgal-instructions";
import { describeUpGalPage } from "./upgal-page-context";

describe("UpGal instructions", () => {
  test("distinguishes verified identity from client page metadata", () => {
    const instructions = buildUpGalInstructions({
      organizationId: "org-1",
      userId: "user-1",
      userName: "Ada Lovelace",
      page: {
        path: "/projects/project-1",
        title: "Project overview",
      },
    });

    expect(instructions).toContain("Ada Lovelace");
    expect(instructions).toContain("/projects/project-1");
    expect(instructions).toContain("Project details and its environments.");
    expect(instructions).toContain('"projectId":"project-1"');
    expect(instructions).toContain("server-verified");
    expect(instructions).toContain("client-reported application metadata");
    expect(instructions).toContain("Prefer named volumes");
  });

  test("publishes deterministic Compose generation rules", () => {
    expect(UPGAL_TEMPLATE_GENERATION_RULES.join("\n")).toContain(
      "return only one YAML document",
    );
    expect(UPGAL_TEMPLATE_GENERATION_RULES.join("\n")).toContain(
      "Docker socket mounts",
    );
  });

  test("separates guidance intent from mutation intent", () => {
    const intentRules = UPGAL_INTENT_RULES.join("\n");
    const instructions = buildUpGalInstructions({
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(intentRules).toContain("how to");
    expect(intentRules).toContain("never call a mutation tool");
    expect(intentRules).toContain("whether the user wants instructions");
    expect(instructions).toContain(intentRules);
  });

  test("describes nested resource pages with route identifiers", () => {
    expect(
      describeUpGalPage({
        path: "/projects/project-1/environment-1/resource-1",
        title: "Projects",
      }),
    ).toEqual({
      path: "/projects/project-1/environment-1/resource-1",
      title: "Projects",
      description:
        "Resource details, configuration, deployments, logs, and runtime controls.",
      routeParameters: {
        projectId: "project-1",
        environmentId: "environment-1",
        resourceId: "resource-1",
      },
    });
  });
});
