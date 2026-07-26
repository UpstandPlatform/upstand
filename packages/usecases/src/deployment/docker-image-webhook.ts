function normalizeImageRepository(value: string): string {
  let image = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "");
  image = image.split("@", 1)[0] || image;
  const segments = image.split("/").filter(Boolean);
  if (segments.length > 1 && /[.:]/.test(segments[0] || "")) {
    segments.shift();
  }
  if (segments.length === 1) segments.unshift("library");
  return segments.join("/");
}

export function dockerImageRepositoryAndTag(value: string): {
  repository: string;
  tag: string;
} {
  const withoutDigest = value.trim().split("@", 1)[0] || value.trim();
  const slashIndex = withoutDigest.lastIndexOf("/");
  const colonIndex = withoutDigest.lastIndexOf(":");
  const hasTag = colonIndex > slashIndex;
  const repository = hasTag
    ? withoutDigest.slice(0, colonIndex)
    : withoutDigest;
  return {
    repository: normalizeImageRepository(repository),
    tag: hasTag ? withoutDigest.slice(colonIndex + 1) || "latest" : "latest",
  };
}

export function matchesDockerImageWebhook(
  configuredImage: string,
  webhookRepository: string,
  webhookTag?: string,
): boolean {
  const configured = dockerImageRepositoryAndTag(configuredImage);
  const receivedRepository = normalizeImageRepository(webhookRepository);
  if (!receivedRepository || configured.repository !== receivedRepository) {
    return false;
  }
  return !webhookTag || configured.tag === webhookTag.trim().toLowerCase();
}
