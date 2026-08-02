import { env } from "@upstand/env/web";
import { RootProvider } from "fumadocs-ui/provider/next";

import "./global.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL(
    env.NEXT_PUBLIC_FUMADOCS_URL || "https://docs.upstand.dev",
  ),
  title: {
    default: "Upstand Docs",
    template: "%s | Upstand Docs",
  },
  description:
    "Documentation for deploying and operating Upstand on Docker Swarm.",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/brand/icon.svg", type: "image/svg+xml" },
    ],
  },
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
