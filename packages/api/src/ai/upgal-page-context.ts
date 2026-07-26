import { z } from "zod";
import { internalPathSchema, uiTargetIdSchema } from "./tools/ui-schemas";

export const upGalUiTargetSchema = z.object({
  id: uiTargetIdSchema,
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(400).optional(),
  kind: z.enum(["button", "field", "dialog", "navigation", "other"]),
  path: internalPathSchema.optional(),
  action: z.enum(["spotlight", "focus", "open_dialog", "submit"]).optional(),
});

export type UpGalPageUiTarget = z.infer<typeof upGalUiTargetSchema>;

export const UpGalPageContextSchema = z.object({
  path: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(200).optional(),
  uiTargets: z.array(upGalUiTargetSchema).max(100).optional(),
});

export type UpGalPageContext = z.infer<typeof UpGalPageContextSchema>;

export type DescribedUpGalPageContext = UpGalPageContext & {
  description: string;
  routeParameters: Record<string, string>;
};

type PageRoute = {
  pattern: RegExp;
  description: string;
  parameterNames?: readonly string[];
};

const PAGE_ROUTES: readonly PageRoute[] = [
  {
    pattern: /^\/projects\/([^/]+)\/([^/]+)\/([^/]+)\/?$/,
    description:
      "Resource details, configuration, deployments, logs, and runtime controls.",
    parameterNames: ["projectId", "environmentId", "resourceId"],
  },
  {
    pattern: /^\/projects\/([^/]+)\/([^/]+)\/?$/,
    description: "Environment details and the resources deployed within it.",
    parameterNames: ["projectId", "environmentId"],
  },
  {
    pattern: /^\/projects\/([^/]+)\/?$/,
    description: "Project details and its environments.",
    parameterNames: ["projectId"],
  },
  {
    pattern: /^\/projects\/?$/,
    description: "Projects in the active organization.",
  },
  {
    pattern: /^\/ssh-keys\/?$/,
    description: "Organization SSH keys and the SSH key creation dialog.",
  },
  {
    pattern: /^\/tags\/?$/,
    description: "Reusable organization tags and tag management.",
  },
  {
    pattern: /^\/deployments\/?$/,
    description: "Deployment history, queue, and concurrency controls.",
  },
  {
    pattern: /^\/requests\/?$/,
    description: "Recent HTTP request activity and diagnostics.",
  },
  {
    pattern: /^\/remote-servers\/?$/,
    description: "Remote deploy, build, and database servers.",
  },
  {
    pattern: /^\/docker\/?$/,
    description: "Docker containers, images, volumes, and networks.",
  },
  {
    pattern: /^\/docker-swarm\/?$/,
    description: "Docker Swarm cluster status, nodes, and tasks.",
  },
  {
    pattern: /^\/docker-registry\/?$/,
    description: "Configured Docker registries and credentials metadata.",
  },
  {
    pattern: /^\/web-server\/?$/,
    description: "Caddy web server configuration, routes, and logs.",
  },
  {
    pattern: /^\/certificates\/?$/,
    description: "TLS certificates and certificate management.",
  },
  {
    pattern: /^\/git-providers\/?$/,
    description: "Configured Git providers and repository integrations.",
  },
  {
    pattern: /^\/s3-destinations\/?$/,
    description: "S3-compatible backup and storage destinations.",
  },
  {
    pattern: /^\/monitoring\/?$/,
    description: "Server monitoring metrics and alert thresholds.",
  },
  {
    pattern: /^\/notifications\/?$/,
    description: "Notification channels, subscriptions, and deliveries.",
  },
  {
    pattern: /^\/audit-logs\/?$/,
    description: "Organization audit events and actor activity.",
  },
  {
    pattern: /^\/templates\/?$/,
    description: "Reusable application and Docker Compose templates.",
  },
  {
    pattern: /^\/settings\/(sso|scim)\/?$/,
    description: "Organization identity-provider integration settings.",
    parameterNames: ["identityProtocol"],
  },
  {
    pattern: /^\/dashboard\/?$/,
    description: "Organization overview and operational account status.",
  },
  {
    pattern: /^\/settings\/ai\/?$/,
    description: "UpGal provider, model, and API credential settings.",
  },
];

function decodeRouteValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function describeUpGalPage(
  page: UpGalPageContext,
): DescribedUpGalPageContext {
  for (const route of PAGE_ROUTES) {
    const match = page.path.match(route.pattern);
    if (!match) continue;

    const routeParameters = Object.fromEntries(
      (route.parameterNames ?? []).flatMap((name, index) => {
        const value = match[index + 1];
        return value ? [[name, decodeRouteValue(value)]] : [];
      }),
    );

    return { ...page, description: route.description, routeParameters };
  }

  return {
    ...page,
    description: page.title
      ? `The ${page.title} dashboard page.`
      : "An Upstand dashboard page.",
    routeParameters: {},
  };
}
