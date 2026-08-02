import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ApplicationBuildConfig } from "@upstand/domain";
import { DockerService } from "./docker.service";

/**
 * These source-only fixtures are copied verbatim from oblien/openship's
 * `fixtures/deploy` directory. They represent every stack family we promise
 * Railpack deployments can receive without a hand-written Dockerfile.
 */
const fixtureRoot = path.resolve(
  import.meta.dir,
  "../../../../fixtures/openship/deploy",
);

const fixtures = [
  ["node", "package.json"],
  ["python-fastapi", "requirements.txt"],
  ["go", "go.mod"],
  ["rust-axum", "Cargo.toml"],
  ["dotnet", "HelloApi.csproj"],
  ["kotlin", "build.gradle.kts"],
  ["springboot", "pom.xml"],
  ["laravel", "artisan"],
] as const;

const upstreamSha256: Record<string, string> = {
  "README.md":
    "5313baaebda03d976c5c32c87a0e58c38c977b2b50b740563e8d3799ad34fde0",
  "dotnet/HelloApi.csproj":
    "3907d65f65edfab42139f6c65d53bbb134478991ed61d75adaae46cfaf433611",
  "dotnet/Program.cs":
    "6db63f73bcf5c2e986854bfd1f623159665e9c108d87163e80951240620bb255",
  "go/go.mod":
    "1c35432f0ee1df08010f96ea01daa5d52c6d360cd271d6b4601775daf910e035",
  "go/main.go":
    "2adb19f0133857f1bc8af3554f80fbe90aaac2cf42122121ab094753d0cec80f",
  "kotlin/build.gradle.kts":
    "01df40b2bdef08a6405bec438252a228d2cdce333b637bf1a9308544d58aaeae",
  "kotlin/settings.gradle.kts":
    "529beadaac951239adb5044c845fbac5c34e1893e76551854bc63f216fec67f8",
  "kotlin/src/main/kotlin/Main.kt":
    "38add0b42b1bc5b90c041512b9aec02bbbbe4d7ef080f752525052990baddaa2",
  "laravel/artisan":
    "c2df42d226aaa8da169b2ee573aa6a87b2ceeda18fa7632b9249175acb577e54",
  "laravel/composer.json":
    "a04bf3467a0425b7f0898e5fba32b83b0d1b24ffb37b927210717f6ff9e467a1",
  "laravel/public/index.php":
    "cc9607404811f4a4a4dec53eded5b3f0f0bec117825bf1d9586d852ec999c53e",
  "node/package.json":
    "4457dc2e1ca4c004ca5db1acbe63def543a8d4786b7df2a12ef111f9619911b8",
  "node/server.js":
    "92de2ea9279422bd6871b2639a190c5fcaf828d3229484613ee92b6652804730",
  "python-fastapi/main.py":
    "3467865d57e426e0b4dfd3f1cfa96556cf71aa9c4226f3315c7f7899312b70d9",
  "python-fastapi/requirements.txt":
    "719b99f871aed8fd38cd238329af3bf0bf61b3c51fd2208020ae40daa5bb0285",
  "rust-axum/Cargo.toml":
    "3711856e5ad6b17adf77ada9dbae54410052b02fbea214c348ae2bbc8ec8b62b",
  "rust-axum/src/main.rs":
    "10bccdb0ec924b77fdd1900fa342157a9e78213c4f3df8fa486662a584e7c3de",
  "springboot/pom.xml":
    "13d5eb93e0f90c4b75022caa97b4d6145b3dcce85dbe94b2b4bd20436027dacf",
  "springboot/src/main/java/com/example/DemoApplication.java":
    "3576ddfbef06fc65ceb527c32bc7d521cb1553064899254d801b22f33d556882",
  "springboot/src/main/resources/application.properties":
    "07c9238427c36969ea7848162467177d4c8b1d3f493aeef1e9e035d64704240a",
};

type BuildCall = {
  command: string;
  args: string[];
  environment?: NodeJS.ProcessEnv;
};

function createBuildHarness(): {
  build(config: ApplicationBuildConfig, fixturePath: string): Promise<void>;
  calls: BuildCall[];
} {
  const service = new DockerService({} as never);
  const privateService = service as unknown as {
    ensureRailpack(
      version: string,
      onLog: (line: string) => void,
    ): Promise<string>;
    runCommandAsync(
      command: string,
      args: string[],
      onLog: (line: string) => void,
      environment?: NodeJS.ProcessEnv,
    ): Promise<void>;
    buildApplicationImage(
      clonePath: string,
      imageName: string,
      config: ApplicationBuildConfig,
      envVars: Record<string, string>,
      onLog: (line: string) => void,
      buildSecrets: Record<string, string>,
      preserveForRollback: boolean,
    ): Promise<void>;
  };
  const calls: BuildCall[] = [];
  privateService.ensureRailpack = async () => "/tools/railpack";
  privateService.runCommandAsync = async (
    command,
    args,
    _onLog,
    environment,
  ) => {
    calls.push({ command, args, environment });
  };
  return {
    calls,
    build: (config, fixturePath) =>
      privateService.buildApplicationImage(
        fixturePath,
        "upstand-fixture:test",
        config,
        { PORT: "3000" },
        () => {},
        {},
        false,
      ),
  };
}

describe("OpenShip deployment fixtures", () => {
  test("keeps the complete upstream stack-fixture matrix", () => {
    for (const [fixture, marker] of fixtures) {
      expect(fs.existsSync(path.join(fixtureRoot, fixture, marker))).toBe(true);
    }
  });

  test("preserves the OpenShip sources exactly at 3d64ba6a23464f94b1fbf0951a10e54facb2e161", () => {
    for (const [relativePath, expectedHash] of Object.entries(upstreamSha256)) {
      const actualHash = createHash("sha256")
        // Git may materialize text fixtures with CRLF on Windows. The source
        // repository stores canonical LF blobs, so normalize that checkout-only
        // representation difference before validating the upstream content.
        .update(
          fs
            .readFileSync(path.join(fixtureRoot, relativePath), "utf8")
            .replaceAll("\r\n", "\n"),
        )
        .digest("hex");
      expect(actualHash, relativePath).toBe(expectedHash);
    }
  });

  for (const [fixture] of fixtures) {
    test(`sends the ${fixture} fixture through the Railpack deployment pipeline`, async () => {
      const harness = createBuildHarness();
      await harness.build(
        { type: "railpack", buildPath: ".", railpackVersion: "0.15.4" },
        path.join(fixtureRoot, fixture),
      );

      expect(harness.calls).toHaveLength(6);
      const [
        prepare,
        buildxVersion,
        createBuilder,
        inspectBuilder,
        build,
        cleanup,
      ] = harness.calls;
      expect(prepare).toMatchObject({
        command: "/tools/railpack",
        args: expect.arrayContaining([
          "prepare",
          path.join(fixtureRoot, fixture),
          "--env",
          "PORT",
        ]),
      });
      expect(prepare?.environment?.PORT).toBe("3000");
      expect(buildxVersion).toMatchObject({
        command: "docker",
        args: ["buildx", "version"],
      });
      expect(createBuilder?.args.slice(0, 3)).toEqual([
        "buildx",
        "create",
        "--name",
      ]);
      expect(inspectBuilder?.args.slice(0, 2)).toEqual(["buildx", "inspect"]);
      expect(build).toMatchObject({
        command: "docker",
        args: expect.arrayContaining([
          "buildx",
          "build",
          "--build-arg",
          "BUILDKIT_SYNTAX=ghcr.io/railwayapp/railpack-frontend:v0.15.4",
          "--secret",
          "type=env,id=PORT",
          path.join(fixtureRoot, fixture),
        ]),
      });
      expect(cleanup).toMatchObject({
        command: "docker",
        args: ["buildx", "rm", "--force", expect.any(String)],
      });
    });
  }
});
