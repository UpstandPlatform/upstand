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

function helpText(): string {
  return "Upstand CLI\n\nUsage:\n  upstand <command> [options]\n\nCommands:\n  login                  Save an API key for local or CI use\n  logout                 Remove the saved token\n  whoami                 Verify authentication and capabilities\n  link                   Link the current directory to a project environment\n  unlink                 Remove the current project link\n  deploy <resource-id>   Queue a resource deployment\n  logs <deployment-id>   Show deployment logs\n  inspect <id>           Inspect a resource (use --type project for projects)\n  rollback <resource>    Roll back a resource with --yes\n  project list           List organization projects\n  environment list       List project environments\n  resource list           List environment resources\n  deployment list         List organization deployments\n  deployment cancel       Cancel a deployment with --yes\n  deployment retry        Retry a failed deployment\n  api <procedure>         Call any supported API procedure\n\nGlobal options:\n  --url <url>             Control-plane URL (or UPSTAND_URL)\n  --token <token>         API key/token (or UPSTAND_TOKEN)\n  --json                  Emit stable JSON\n  --silent                Suppress human output\n  --yes                   Confirm destructive operations\n  --organization <id>     Organization context\n  --project <id>          Project context\n  --environment <id>      Environment context";
}
