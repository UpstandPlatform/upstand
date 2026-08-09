import { flag } from "./args";
import { UpstandClient } from "./client";
import {
  clearToken,
  readProjectLink,
  removeProjectLink,
  saveToken,
  writeProjectLink,
} from "./config";
import { Output } from "./output";
import { promptConfirm, promptSelect, promptText } from "./prompt";
import type { CommandContext } from "./types";
import { isInteractiveTerminal } from "./ui";
import { cliVersion } from "./version";

export async function runCommand(context: CommandContext): Promise<number> {
  const [group = "help", action = ""] = context.positionals;
  const output = new Output(context.options.output);
  const client = new UpstandClient(context.options);

  try {
    if (
      group === "version" ||
      group === "--version" ||
      context.flags.has("version")
    ) {
      await output.message(`@upstand/cli ${await cliVersion()}`);
      return 0;
    }
    if (group === "help" || group === "--help") {
      await output.message(helpText());
      return 0;
    }
    if (group === "login") return await login(context, output);
    if (group === "logout") {
      await clearToken();
      await output.message("Logged out.", "success");
      return 0;
    }
    if (group === "link") return await link(context, output, client);
    if (group === "unlink") {
      await removeProjectLink();
      await output.message("Project unlinked.", "success");
      return 0;
    }
    if (group === "api")
      return await procedure(context, output, client, action);
    if (group === "whoami") return await whoami(output, client);
    if (group === "deploy") return await deploy(context, output, client);
    if (group === "status") return await status(context, output, client);
    if (group === "logs") return await logs(context, output, client);
    if (group === "inspect") return await inspect(context, output, client);
    if (group === "rollback") return await rollback(context, output, client);
    if (group === "project" || group === "projects")
      return await projectCommand(context, output, client, action);
    if (group === "environment" || group === "environments")
      return await environmentCommand(context, output, client, action);
    if (group === "resource" || group === "resources")
      return await resourceCommand(context, output, client, action);
    if (group === "deployment" || group === "deployments")
      return await deploymentCommand(context, output, client, action);
    if (group === "server" || group === "servers")
      return await serverCommand(context, output, client, action);
    if (group === "control-plane")
      return await controlPlaneCommand(context, output, client, action);
    throw new Error(
      `Unknown command '${context.positionals.join(" ")}'. Run 'upstand help'.`,
    );
  } catch (error) {
    await output.error(error instanceof Error ? error.message : String(error));
    return error instanceof Error && "status" in error && error.status === 401
      ? 2
      : 1;
  }
}

async function login(context: CommandContext, output: Output): Promise<number> {
  const token = (flag(context, "token") || process.env.UPSTAND_TOKEN)?.trim();
  if (!token) return await loginWithBrowser(context, output);
  await saveToken(token, context.options.apiUrl);
  await output.message(
    "Token saved securely in the Upstand user configuration.",
    "success",
  );
  return 0;
}

async function loginWithBrowser(
  context: CommandContext,
  output: Output,
): Promise<number> {
  const authorization = await new UpstandClient(
    context.options,
  ).deviceAuthorize();
  if (context.options.output === "json") {
    await output.value({
      verificationUri: authorization.data.verificationUri,
      userCode: authorization.data.userCode,
      expiresIn: authorization.data.expiresIn,
      interval: authorization.data.interval,
    });
    return 2;
  }
  if (!isInteractiveTerminal()) {
    await output.message(
      `Open ${authorization.data.verificationUri} and approve code ${authorization.data.userCode}, then rerun login with --token or from an interactive terminal.`,
    );
    return 2;
  }
  await output.message(
    `Open ${authorization.data.verificationUri}\n\nYour one-time code is ${authorization.data.userCode}. Waiting for browser approval…`,
  );
  await openBrowser(authorization.data.verificationUri);

  const deadline = Date.now() + authorization.data.expiresIn * 1_000;
  while (Date.now() < deadline) {
    const result = await new UpstandClient(context.options).deviceToken(
      authorization.data.deviceCode,
    );
    if (result.response.status === 200 && result.data.status === "approved") {
      if (!result.data.accessToken)
        throw new Error("CLI authorization returned no access token.");
      await saveToken(result.data.accessToken, context.options.apiUrl);
      await output.message(
        "Signed in successfully. Token saved securely.",
        "success",
      );
      return 0;
    }
    if (result.data.status === "access_denied")
      throw new Error("CLI authorization was denied.");
    if (result.data.status === "expired_token")
      throw new Error("CLI authorization expired. Run upstand login again.");
    await Bun.sleep(Math.max(1, authorization.data.interval) * 1_000);
  }
  throw new Error("CLI authorization expired. Run upstand login again.");
}

async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : process.platform === "darwin"
        ? ["open", url]
        : ["xdg-open", url];
  try {
    const child = Bun.spawn(command, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    void child.exited;
  } catch {
    // The URL and code are already displayed, so a missing desktop opener does
    // not prevent users from completing the flow manually.
  }
}

async function whoami(output: Output, client: UpstandClient): Promise<number> {
  const result = await client.query("platform.getCapabilities");
  await output.value(result.data, "Authenticated Upstand capabilities");
  return 0;
}

async function link(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
): Promise<number> {
  const organizationId =
    context.options.organizationId ||
    (context.options.output === "human"
      ? await promptText("Organization ID")
      : undefined);
  if (!organizationId) throw new Error("link requires --organization.");

  let projectId = context.options.projectId;
  if (!projectId) {
    const projects = await client.query<Array<{ id: string; name: string }>>(
      "project.list",
      { organizationId },
    );
    projectId = await selectOrPrompt(
      context,
      "Project",
      projects.data.map((project) => ({
        label: project.name,
        value: project.id,
      })),
    );
  }

  let environmentId = context.options.environmentId;
  if (!environmentId) {
    const environments = await client.query<
      Array<{ id: string; name: string }>
    >("environment.list", { projectId });
    environmentId = await selectOrPrompt(
      context,
      "Environment",
      environments.data.map((environment) => ({
        label: environment.name,
        value: environment.id,
      })),
    );
  }
  if (!projectId || !environmentId) {
    throw new Error("link requires a project and environment.");
  }
  const result = await client.query("environment.get", { id: environmentId });
  await writeProjectLink({
    apiUrl: context.options.apiUrl,
    organizationId,
    projectId,
    environmentId,
    createdAt: new Date().toISOString(),
  });
  await output.value(result.data, `Linked ${projectId} / ${environmentId}`);
  return 0;
}

async function deploy(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
): Promise<number> {
  const link = await readProjectLink();
  let resourceId = flag(context, "resource") || context.positionals[1];
  if (!link)
    throw new Error(
      "No linked project. Run 'upstand link --organization ... --project ... --environment ...'.",
    );
  if (!resourceId) {
    const resources = await client.query<
      Array<{ id: string; name: string; type?: string }>
    >("resource.list", { environmentId: link.environmentId });
    resourceId = await selectOrPrompt(
      context,
      "Resource to deploy",
      resources.data.map((resource) => ({
        label: resource.name,
        value: resource.id,
        description: resource.type ?? "resource",
      })),
    );
  }
  if (!resourceId) throw new Error("deploy requires a resource ID.");
  const result = await client.mutate("resource.deploy", {
    id: resourceId,
    title: flag(context, "title") || "CLI deployment",
  });
  await output.value(result.data, "Deployment queued");
  return 0;
}

async function logs(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
): Promise<number> {
  const id =
    context.positionals[1] ||
    flag(context, "id") ||
    (context.options.output === "human"
      ? await promptText("Deployment ID")
      : undefined);
  if (!id) throw new Error("logs requires a deployment ID.");
  const result = await client.query("deployment.getLogs", { id });
  await output.value(result.data);
  return 0;
}

async function inspect(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
): Promise<number> {
  const id =
    context.positionals[1] ||
    flag(context, "id") ||
    (context.options.output === "human"
      ? await promptText("Resource or project ID")
      : undefined);
  if (!id) throw new Error("inspect requires a resource or project ID.");
  const type = flag(context, "type") || "resource";
  const result = await client.query(
    type === "project" ? "project.get" : "resource.get",
    { id },
  );
  await output.value(result.data);
  return 0;
}

async function status(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
): Promise<number> {
  const resourceId =
    context.positionals[1] ||
    flag(context, "resource") ||
    (context.options.output === "human"
      ? await promptText("Resource ID")
      : undefined);
  if (!resourceId) throw new Error("status requires a resource ID.");
  const result = await client.query("resource.get", { id: resourceId });
  await output.value(result.data, "Resource status");
  return 0;
}

async function rollback(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
): Promise<number> {
  const id =
    context.positionals[1] ||
    flag(context, "id") ||
    (context.options.output === "human"
      ? await promptText("Resource ID to roll back")
      : undefined);
  if (!id) throw new Error("rollback requires a resource ID.");
  if (
    !context.options.yes &&
    (context.options.output !== "human" ||
      !(await promptConfirm("Roll back this resource?")))
  ) {
    throw new Error("rollback cancelled; rerun with --yes in automation.");
  }
  const deploymentId = flag(context, "deployment");
  const result = await client.mutate("resource.rollback", {
    id,
    ...(deploymentId ? { deploymentId } : {}),
  });
  await output.value(result.data, "Rollback queued");
  return 0;
}

async function projectCommand(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
  action: string,
): Promise<number> {
  if (action === "list" || action === "ls") {
    const organizationId =
      context.options.organizationId ||
      (context.options.output === "human"
        ? await promptText("Organization ID")
        : undefined);
    if (!organizationId)
      throw new Error("project list requires --organization.");
    const result = await client.query("project.list", {
      organizationId,
      includeArchived: context.flags.has("include-archived"),
    });
    await output.value(result.data);
    return 0;
  }
  if (action === "get" || action === "inspect") {
    return inspect(
      { ...context, positionals: ["inspect", context.positionals[2] ?? ""] },
      output,
      client,
    );
  }
  throw new Error("Supported project commands: list, inspect.");
}

async function environmentCommand(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
  action: string,
): Promise<number> {
  if (action === "list" || action === "ls") {
    const projectId =
      context.options.projectId ||
      flag(context, "project") ||
      (context.options.output === "human"
        ? await promptText("Project ID")
        : undefined);
    if (!projectId) throw new Error("environment list requires --project.");
    const result = await client.query("environment.list", { projectId });
    await output.value(result.data);
    return 0;
  }
  throw new Error("Supported environment commands: list.");
}

async function resourceCommand(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
  action: string,
): Promise<number> {
  if (action === "list" || action === "ls") {
    const link = await readProjectLink();
    const environmentId =
      context.options.environmentId ||
      flag(context, "environment") ||
      link?.environmentId ||
      (context.options.output === "human"
        ? await promptText("Environment ID")
        : undefined);
    if (!environmentId)
      throw new Error("resource list requires --environment.");
    const result = await client.query("resource.list", { environmentId });
    await output.value(result.data);
    return 0;
  }
  if (action === "deploy")
    return deploy(
      { ...context, positionals: ["deploy", context.positionals[2] ?? ""] },
      output,
      client,
    );
  if (action === "logs")
    return logs(
      { ...context, positionals: ["logs", context.positionals[2] ?? ""] },
      output,
      client,
    );
  throw new Error("Supported resource commands: list, deploy, logs.");
}

async function deploymentCommand(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
  action: string,
): Promise<number> {
  if (action === "list" || action === "ls") {
    const organizationId =
      context.options.organizationId ||
      (context.options.output === "human"
        ? await promptText("Organization ID")
        : undefined);
    if (!organizationId)
      throw new Error("deployment list requires --organization.");
    const result = await client.query("deployment.getDeployments", {
      organizationId,
    });
    await output.value(result.data);
    return 0;
  }
  if (action === "logs")
    return logs(
      { ...context, positionals: ["logs", context.positionals[2] ?? ""] },
      output,
      client,
    );
  if (action === "cancel") {
    const deploymentId =
      context.positionals[2] ||
      flag(context, "id") ||
      (context.options.output === "human"
        ? await promptText("Deployment ID to cancel")
        : undefined);
    if (!deploymentId)
      throw new Error("deployment cancel requires a deployment ID.");
    if (
      !context.options.yes &&
      (context.options.output !== "human" ||
        !(await promptConfirm("Cancel this deployment?")))
    ) {
      throw new Error(
        "deployment cancellation aborted; rerun with --yes in automation.",
      );
    }
    const result = await client.mutate("deployment.cancelDeploymentJob", {
      deploymentId,
    });
    await output.value(result.data, "Cancellation requested");
    return 0;
  }
  if (action === "retry") {
    const deploymentId =
      context.positionals[2] ||
      flag(context, "id") ||
      (context.options.output === "human"
        ? await promptText("Deployment ID to retry")
        : undefined);
    if (!deploymentId)
      throw new Error("deployment retry requires a deployment ID.");
    const result = await client.mutate("deployment.retryDeployment", {
      deploymentId,
    });
    await output.value(result.data, "Retry queued");
    return 0;
  }
  throw new Error("Supported deployment commands: list, logs, cancel, retry.");
}

async function procedure(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
  procedureName: string,
): Promise<number> {
  if (!procedureName)
    throw new Error("api requires a procedure, e.g. 'project.list'.");
  const raw =
    flag(context, "input") ||
    (context.options.output === "human" && isInteractiveTerminal()
      ? await promptText("JSON input (press Enter for {})", "{}")
      : "{}");
  const input = JSON.parse(raw) as Record<string, unknown>;
  const method =
    flag(context, "method")?.toUpperCase() === "GET" ? "GET" : "POST";
  const result =
    method === "GET"
      ? await client.query(procedureName, input)
      : await client.mutate(procedureName, input);
  await output.value(result.data);
  return 0;
}

async function serverCommand(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
  action: string,
): Promise<number> {
  const organizationId = context.options.organizationId;
  if (!organizationId) {
    throw new Error("server migration commands require --organization.");
  }

  if (action === "migrate") {
    const resourceId = context.positionals[2] || flag(context, "resource");
    const targetServerId = flag(context, "target");
    if (!resourceId || !targetServerId) {
      throw new Error(
        "server migrate requires a resource ID and --target <server-id>.",
      );
    }
    const result = await client.mutate("server.migrateResource", {
      organizationId,
      resourceId,
      targetServerId,
    });
    await output.value(result.data, "Workload migration queued");
    return 0;
  }

  if (action === "migration-status") {
    const migrationId = context.positionals[2] || flag(context, "id");
    const resourceId = flag(context, "resource");
    if (!migrationId && !resourceId) {
      throw new Error(
        "server migration-status requires a migration ID or --resource <resource-id>.",
      );
    }
    const result = migrationId
      ? await client.query("server.getWorkloadMigration", {
          organizationId,
          migrationId,
        })
      : await client.query("server.getResourceWorkloadMigration", {
          organizationId,
          resourceId,
        });
    await output.value(result.data, "Workload migration status");
    return 0;
  }

  if (
    action === "migration-cancel" ||
    action === "migration-rollback" ||
    action === "migration-confirm"
  ) {
    const migrationId = context.positionals[2] || flag(context, "id");
    if (!migrationId) throw new Error(`${action} requires a migration ID.`);
    if (
      action === "migration-confirm" &&
      !context.options.yes &&
      (context.options.output !== "human" ||
        !(await promptConfirm(
          "Permanently clean up the retained source workload?",
        )))
    ) {
      throw new Error(
        "source cleanup cancelled; rerun with --yes in automation.",
      );
    }
    const procedure =
      action === "migration-cancel"
        ? "server.cancelWorkloadMigration"
        : action === "migration-rollback"
          ? "server.rollbackWorkloadMigration"
          : "server.confirmWorkloadMigration";
    const result = await client.mutate(procedure, {
      organizationId,
      migrationId,
      ...(action === "migration-confirm" ? { confirmCleanup: true } : {}),
    });
    await output.value(result.data, "Workload migration updated");
    return 0;
  }

  throw new Error(
    "Supported server commands: migrate, migration-status, migration-cancel, migration-rollback, migration-confirm.",
  );
}

async function selectOrPrompt(
  context: CommandContext,
  title: string,
  options: Array<{ label: string; value: string; description?: string }>,
): Promise<string> {
  if (context.options.output === "human" && options.length > 0) {
    return promptSelect(`Select ${title}`, options);
  }
  return promptText(`${title} ID`);
}

async function controlPlaneCommand(
  context: CommandContext,
  output: Output,
  client: UpstandClient,
  action: string,
): Promise<number> {
  const filePath = flag(context, "file");
  if (!filePath) throw new Error(`control-plane ${action} requires --file.`);
  const passphrase = process.env.UPSTAND_TRANSFER_PASSPHRASE?.trim();

  if (action === "export") {
    const target = Bun.file(filePath);
    if ((await target.exists()) && !context.flags.has("force")) {
      throw new Error(
        "Export target already exists; use --force to replace it.",
      );
    }
    const includeSecrets = context.flags.has("include-secrets");
    if (includeSecrets && !passphrase) {
      throw new Error(
        "Secret export requires UPSTAND_TRANSFER_PASSPHRASE in the process environment.",
      );
    }
    const response = await client.exportControlPlane({
      includeSecrets,
      passphrase,
    });
    if (!response.body) throw new Error("Transfer export returned no body.");
    const sink = target.writer();
    const reader = response.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        sink.write(chunk.value);
      }
      await sink.end();
    } catch (error) {
      try {
        await sink.end();
      } catch {
        // Preserve the transfer failure.
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
    await output.value({ file: filePath, includeSecrets }, "Export completed");
    return 0;
  }

  if (action === "import") {
    const source = Bun.file(filePath);
    if (!(await source.exists())) throw new Error("Import file was not found.");
    const rawMode = flag(context, "mode") ?? "merge";
    if (rawMode !== "merge" && rawMode !== "replace") {
      throw new Error("Import mode must be merge or replace.");
    }
    if (
      rawMode === "replace" &&
      !context.options.yes &&
      (context.options.output !== "human" ||
        !(await promptConfirm(
          "Replace the destination control-plane data atomically?",
        )))
    ) {
      throw new Error(
        "replace import cancelled; rerun with --yes in automation.",
      );
    }
    const result = await client.importControlPlane({
      content: source,
      mode: rawMode,
      passphrase,
      resumeSessionId: flag(context, "resume"),
    });
    await output.value(result.data, "Import completed");
    return result.data.conflicts.length > 0 ? 3 : 0;
  }

  throw new Error("Supported control-plane commands: export, import.");
}

function helpText(): string {
  return `Upstand CLI

Usage:
  upstand <command> [options]

Commands:
  login                         Save an API key for local or CI use
  logout                        Remove the saved token
  whoami                        Verify authentication and capabilities
  link                          Link the current directory to an environment
  unlink                        Remove the current project link
  deploy <resource-id>          Queue a resource deployment
  status <resource-id>          Show resource status and placement
  logs <deployment-id>          Show deployment logs
  inspect <id>                  Inspect a resource or project
  rollback <resource>           Roll back a resource with --yes
  project list                  List organization projects
  environment list              List project environments
  resource list                 List environment resources
  deployment list               List organization deployments
  deployment cancel             Cancel a deployment with --yes
  deployment retry              Retry a failed deployment
  server migrate                Queue a migration with --target
  server migration-status       Show migration progress by ID or --resource
  server migration-cancel       Request cancellation before cutover
  server migration-rollback     Roll back to the retained source
  server migration-confirm      Confirm source cleanup with --yes
  control-plane export          Stream an installation export to --file
  control-plane import          Import --file in merge or replace mode
  api <procedure>                Call any supported API procedure

Global options:
  --url <url>                    Control-plane URL (or UPSTAND_URL)
  --token <token>                API key/token (or UPSTAND_TOKEN)
  --json                         Emit stable JSON
  --silent                       Suppress human output
  --yes                          Confirm destructive operations
  --organization <id>            Organization context
  --project <id>                 Project context
  --environment <id>             Environment context`;
}
