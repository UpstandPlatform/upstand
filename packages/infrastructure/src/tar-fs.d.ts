declare module "tar-fs" {
  import type { Readable } from "node:stream";

  export function pack(
    cwd: string,
    options?: {
      ignore?: (absolutePath: string) => boolean;
    },
  ): Readable;
}
