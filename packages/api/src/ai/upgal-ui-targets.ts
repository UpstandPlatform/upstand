export type UpGalUiTargetKind =
  | "button"
  | "field"
  | "dialog"
  | "navigation"
  | "other";

export type UpGalUiTargetAction =
  | "spotlight"
  | "focus"
  | "open_dialog"
  | "submit";

export type UpGalUiTargetDefinition<Id extends string = string> = {
  id: Id;
  label: string;
  description?: string;
  kind: UpGalUiTargetKind;
  action?: UpGalUiTargetAction;
  path?: `/${string}`;
};

/**
 * The complete, route-aware catalog of controls that UpGal can explain or
 * guide users through. Live DOM metadata is merged into this catalog on the
 * client so dialog-only controls remain discoverable before they are mounted.
 */
export const UPGAL_UI_TARGETS = [
  {
    id: "navigation-projects",
    label: "Projects navigation",
    description: "Open the Projects page.",
    kind: "navigation",
    action: "spotlight",
    path: "/projects",
  },
  {
    id: "navigation-deployments",
    label: "Deployments navigation",
    description: "Open the Deployments page.",
    kind: "navigation",
    action: "spotlight",
    path: "/deployments",
  },
  {
    id: "navigation-templates",
    label: "Templates navigation",
    description: "Open the Templates page.",
    kind: "navigation",
    action: "spotlight",
    path: "/templates",
  },
  {
    id: "navigation-requests",
    label: "Requests navigation",
    description: "Open the Requests page.",
    kind: "navigation",
    action: "spotlight",
    path: "/requests",
  },
  {
    id: "navigation-remote-servers",
    label: "Remote Servers navigation",
    description: "Open the Remote Servers page.",
    kind: "navigation",
    action: "spotlight",
    path: "/remote-servers",
  },
  {
    id: "navigation-ssh-keys",
    label: "SSH Keys navigation",
    description: "Open the SSH Keys page.",
    kind: "navigation",
    action: "spotlight",
    path: "/ssh-keys",
  },
  {
    id: "navigation-docker-swarm",
    label: "Docker Swarm navigation",
    description: "Open the Docker Swarm page.",
    kind: "navigation",
    action: "spotlight",
    path: "/docker-swarm",
  },
  {
    id: "navigation-topology",
    label: "Infrastructure topology navigation",
    description: "Open the live infrastructure topology map.",
    kind: "navigation",
    action: "spotlight",
    path: "/topology",
  },
  {
    id: "navigation-docker",
    label: "Docker Inventory navigation",
    description: "Open the Docker Inventory page.",
    kind: "navigation",
    action: "spotlight",
    path: "/docker",
  },
  {
    id: "navigation-docker-registry",
    label: "Docker Registry navigation",
    description: "Open the Docker Registry page.",
    kind: "navigation",
    action: "spotlight",
    path: "/docker-registry",
  },
  {
    id: "navigation-web-server",
    label: "Web Server navigation",
    description: "Open the Web Server page.",
    kind: "navigation",
    action: "spotlight",
    path: "/web-server",
  },
  {
    id: "navigation-certificates",
    label: "Certificates navigation",
    description: "Open the Certificates page.",
    kind: "navigation",
    action: "spotlight",
    path: "/certificates",
  },
  {
    id: "navigation-git-providers",
    label: "Git Providers navigation",
    description: "Open the Git Providers page.",
    kind: "navigation",
    action: "spotlight",
    path: "/git-providers",
  },
  {
    id: "navigation-s3-destinations",
    label: "S3 Storage navigation",
    description: "Open the S3 Storage page.",
    kind: "navigation",
    action: "spotlight",
    path: "/s3-destinations",
  },
  {
    id: "navigation-secret-providers",
    label: "Secret Providers navigation",
    description: "Open the Secret Providers page.",
    kind: "navigation",
    action: "spotlight",
    path: "/secret-providers",
  },
  {
    id: "navigation-settings-scim",
    label: "SCIM navigation",
    description: "Open the SCIM settings page.",
    kind: "navigation",
    action: "spotlight",
    path: "/settings/scim",
  },
  {
    id: "navigation-settings-sso",
    label: "Single Sign-On navigation",
    description: "Open the Single Sign-On settings page.",
    kind: "navigation",
    action: "spotlight",
    path: "/settings/sso",
  },
  {
    id: "navigation-monitoring",
    label: "Monitoring navigation",
    description: "Open the Monitoring page.",
    kind: "navigation",
    action: "spotlight",
    path: "/monitoring",
  },
  {
    id: "navigation-notifications",
    label: "Notifications navigation",
    description: "Open the Notifications page.",
    kind: "navigation",
    action: "spotlight",
    path: "/notifications",
  },
  {
    id: "navigation-observation",
    label: "Observation navigation",
    description: "Open the Observation page.",
    kind: "navigation",
    action: "spotlight",
    path: "/observation",
  },
  {
    id: "navigation-audit-logs",
    label: "Audit Logs navigation",
    description: "Open the Audit Logs page.",
    kind: "navigation",
    action: "spotlight",
    path: "/observation?tab=audits",
  },
  {
    id: "navigation-tags",
    label: "Tags navigation",
    description: "Open the Tags page.",
    kind: "navigation",
    action: "spotlight",
    path: "/tags",
  },
  {
    id: "navigation-settings-ai",
    label: "UpGal Settings navigation",
    description: "Open the UpGal Settings dialog panel.",
    kind: "navigation",
    action: "open_dialog",
  },
  {
    id: "create-project",
    label: "New Project button",
    description: "Opens the form for creating a new project.",
    kind: "button",
    action: "open_dialog",
    path: "/projects",
  },
  {
    id: "project-name",
    label: "Project name field",
    description: "Enter the human-readable name for the new project.",
    kind: "field",
    path: "/projects",
  },
  {
    id: "create-project-submit",
    label: "Create Project button",
    description: "Submits the project form after you review the name.",
    kind: "button",
    action: "submit",
    path: "/projects",
  },
  {
    id: "create-ssh-key",
    label: "Add SSH Key button",
    description: "Opens the SSH key creation dialog.",
    kind: "button",
    action: "open_dialog",
    path: "/ssh-keys",
  },
  {
    id: "generate-new-ssh-key",
    label: "Generate new key button",
    description: "Switches the SSH key dialog to key-pair generation.",
    kind: "button",
    action: "spotlight",
    path: "/ssh-keys",
  },
  {
    id: "use-existing-ssh-key",
    label: "Use existing key button",
    description: "Switches the SSH key dialog to the import form.",
    kind: "button",
    action: "spotlight",
    path: "/ssh-keys",
  },
  {
    id: "ssh-key-name",
    label: "SSH key name field",
    description: "Enter a recognizable name for this key.",
    kind: "field",
    action: "focus",
    path: "/ssh-keys",
  },
  {
    id: "ssh-key-description",
    label: "SSH key description field",
    description: "Optionally describe where or why this key is used.",
    kind: "field",
    action: "focus",
    path: "/ssh-keys",
  },
  {
    id: "ssh-key-private-key",
    label: "SSH private key field",
    description: "Paste the private half of an existing SSH key pair.",
    kind: "field",
    action: "focus",
    path: "/ssh-keys",
  },
  {
    id: "ssh-key-public-key",
    label: "SSH public key field",
    description: "Paste the public half that matches the private key.",
    kind: "field",
    action: "focus",
    path: "/ssh-keys",
  },
  {
    id: "generate-ssh-key-submit",
    label: "Generate Key button",
    description:
      "Generates and stores the SSH key pair after reviewing the name.",
    kind: "button",
    action: "submit",
    path: "/ssh-keys",
  },
  {
    id: "import-ssh-key-submit",
    label: "Add Key button",
    description: "Stores the imported SSH key pair after reviewing its fields.",
    kind: "button",
    action: "submit",
    path: "/ssh-keys",
  },
  {
    id: "create-tag",
    label: "New tag button",
    description: "Opens the form for creating an organization tag.",
    kind: "button",
    action: "open_dialog",
    path: "/tags",
  },
  {
    id: "tag-name",
    label: "Tag name field",
    description: "Enter the shared label name.",
    kind: "field",
    action: "focus",
    path: "/tags",
  },
  {
    id: "create-tag-submit",
    label: "Create tag button",
    description: "Saves the tag after reviewing its name and color.",
    kind: "button",
    action: "submit",
    path: "/tags",
  },
  {
    id: "create-template",
    label: "New template button",
    description: "Opens the template editor for creating a reusable blueprint.",
    kind: "button",
    action: "open_dialog",
    path: "/templates",
  },
  {
    id: "create-docker-registry",
    label: "Add External Registry button",
    description: "Opens the form for configuring an external Docker registry.",
    kind: "button",
    action: "open_dialog",
    path: "/docker-registry",
  },
  {
    id: "create-server",
    label: "Create Server button",
    description: "Opens the form for adding a remote server.",
    kind: "button",
    action: "open_dialog",
    path: "/remote-servers",
  },
  {
    id: "add-notification-channel",
    label: "Add notification button",
    description: "Opens the form for adding a notification channel.",
    kind: "button",
    action: "open_dialog",
    path: "/notifications",
  },
  {
    id: "add-git-provider",
    label: "Add Git Provider button",
    description: "Opens the form for configuring a Git provider.",
    kind: "button",
    action: "open_dialog",
    path: "/git-providers",
  },
  {
    id: "upgal-add-provider",
    label: "Add provider button",
    description: "Opens the form for configuring an AI provider.",
    kind: "button",
    action: "open_dialog",
  },
] as const satisfies readonly UpGalUiTargetDefinition[];

export type UpGalTargetId = (typeof UPGAL_UI_TARGETS)[number]["id"];

export const UPGAL_UI_TARGET_ALIASES = {
  "key-name-input": "ssh-key-name",
  "public-key-input": "ssh-key-public-key",
} as const;

export type UpGalTargetReference =
  | UpGalTargetId
  | keyof typeof UPGAL_UI_TARGET_ALIASES;

const targetById = new Map(
  UPGAL_UI_TARGETS.map((target) => [target.id, target]),
);

export function resolveUpGalTargetId(id: string): UpGalTargetId | string {
  return (
    UPGAL_UI_TARGET_ALIASES[id as keyof typeof UPGAL_UI_TARGET_ALIASES] ?? id
  );
}

export function getUpGalTargetDefinition(
  id: UpGalTargetReference,
): UpGalUiTargetDefinition<UpGalTargetId> {
  const canonicalId = resolveUpGalTargetId(id);
  const target = targetById.get(canonicalId as UpGalTargetId);
  if (!target) {
    throw new Error(`Unknown UpGal UI target: ${id}`);
  }
  return target;
}

export function getUpGalNavigationTarget(path: `/${string}`) {
  const id =
    `navigation-${path.slice(1).replaceAll("/", "-")}` as UpGalTargetId;
  return getUpGalTargetDefinition(id);
}
