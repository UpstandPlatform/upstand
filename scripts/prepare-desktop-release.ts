import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const releaseRef = process.argv[2];
if (!releaseRef) {
  throw new Error("A release ref argument is required, for example v0.2.1");
}

const version = releaseRef.split("/").at(-1)?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    `Release ref must resolve to stable semver, received: ${releaseRef}`,
  );
}

const packagePath = join(process.cwd(), "apps", "desktop", "package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
  version?: string;
};
packageJson.version = version;
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(`Prepared Desktop package version ${version}.`);
