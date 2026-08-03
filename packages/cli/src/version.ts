type PackageManifest = { version?: unknown };

export async function cliVersion(): Promise<string> {
  const manifest = (await Bun.file(
    new URL("../package.json", import.meta.url),
  ).json()) as PackageManifest;
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("The CLI package version is not configured.");
  }
  return manifest.version;
}
