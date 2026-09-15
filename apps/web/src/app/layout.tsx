import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";

import "../index.css";
import { TooltipProvider } from "@upstand/ui/components/tooltip";
import { cn } from "@upstand/ui/lib/utils";
import Providers from "@/components/providers";

export const metadata: Metadata = {
  title: {
    default: "Upstand",
    template: "%s | Upstand",
  },
  description:
    "Self-hostable infrastructure control plane for deploying and operating workloads on Docker Swarm.",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/brand/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/favicon/apple-touch-icon.png",
  },
};

import { DesktopChrome } from "@/components/workspace/desktop-chrome";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans", "no-scrollbar")}
    >
      <body className="antialiased">
        <Providers nonce={nonce}>
          <DesktopChrome />
          <TooltipProvider>{children}</TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
