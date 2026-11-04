import { describe, expect, test } from "bun:test";
import {
  getAffectedProductionImages,
  getProductionImageFlags,
} from "./ci-image-matrix";

const names = (files: readonly string[]) =>
  getAffectedProductionImages(files).map((image) => image.name);

describe("CI production image selection", () => {
  test("skips image builds for documentation and release metadata", () => {
    expect(
      names([
        "CONTRIBUTING.md",
        ".github/BRANCH_PROTECTION.md",
        ".changeset/bright-dragons-deploy.md",
        "apps/fumadocs/content/docs/features/routing.mdx",
      ]),
    ).toEqual([]);
    expect(getProductionImageFlags(["CONTRIBUTING.md"])).toEqual({
      server: false,
      web: false,
      fumadocs: false,
      schedules: false,
      "deployment-worker": false,
      monitoring: false,
      "docker-broker": false,
    });
  });

  test("builds only the service image changed by an app source edit", () => {
    expect(names(["apps/server/src/index.ts"])).toEqual(["server"]);
    expect(names(["apps/web/src/app/page.tsx"])).toEqual(["web"]);
    expect(names(["apps/fumadocs/src/app/layout.tsx"])).toEqual(["fumadocs"]);
    expect(names(["apps/monitoring/main.go"])).toEqual(["monitoring"]);
    expect(names(["apps/docker-broker/main.go"])).toEqual(["docker-broker"]);
  });

  test("builds both schedules images when their shared app changes", () => {
    expect(names(["apps/schedules/src/worker.ts"])).toEqual([
      "schedules",
      "deployment-worker",
    ]);
  });

  test("rebuilds Node images for shared packages and root build inputs", () => {
    const nodeImages = [
      "server",
      "web",
      "fumadocs",
      "schedules",
      "deployment-worker",
    ];
    expect(names(["packages/domain/src/project.ts"])).toEqual(nodeImages);
    expect(names(["bun.lock"])).toEqual(nodeImages);
  });

  test("rebuilds all images when the shared build action changes", () => {
    expect(names([".github/actions/build-pruned-image/action.yml"])).toEqual([
      "server",
      "web",
      "fumadocs",
      "schedules",
      "deployment-worker",
      "monitoring",
      "docker-broker",
    ]);
  });

  test("skips unrelated desktop and CLI source changes", () => {
    expect(
      names([
        "apps/desktop/src/main/index.ts",
        "packages/cli/src/index.ts",
        "scripts/ci-image-matrix.ts",
        "scripts/ci-image-matrix.test.ts",
      ]),
    ).toEqual([]);
  });

  test("rebuilds every image for unknown build inputs", () => {
    expect(names(["new-runtime/worker/Dockerfile"])).toEqual([
      "server",
      "web",
      "fumadocs",
      "schedules",
      "deployment-worker",
      "monitoring",
      "docker-broker",
    ]);
  });
});
