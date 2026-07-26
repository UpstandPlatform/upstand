import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Image from "next/image";

import { appName, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2">
          <Image src="/brand/logo.svg" alt="" width={28} height={28} priority />
          <span>{appName}</span>
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
