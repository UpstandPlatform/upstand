import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const [sourceDirectory, destinationDirectory] = Bun.argv.slice(2);

if (!sourceDirectory || !destinationDirectory) {
  throw new Error(
    "Usage: bun scripts/prepare-cli-publish.ts <source-directory> <destination-directory>",
  );
}

const source = path.resolve(sourceDirectory);
const destination = path.resolve(destinationDirectory);
if (source === destination || destination.startsWith(`${source}${path.sep}`)) {
  throw new Error(
    "The CLI publish directory must be outside the source package.",
  );
}

const packageJsonPath = path.join(source, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
};

const dependencies = { ...(packageJson.dependencies ?? {}) };
delete dependencies["@upstand/domain"];

const publishPackage = {
  ...packageJson,
  bin: { upstand: "./dist/index.js" },
  dependencies,
};
delete publishPackage.devDependencies;

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(path.join(source, "dist"), path.join(destination, "dist"), {
  recursive: true,
});
cpSync(path.join(source, "README.md"), path.join(destination, "README.md"));
writeFileSync(
  path.join(destination, "package.json"),
  `${JSON.stringify(publishPackage, null, 2)}\n`,
);

console.log(`Prepared publishable CLI package at ${destination}`);
