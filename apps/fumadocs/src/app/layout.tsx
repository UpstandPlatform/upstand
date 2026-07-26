import { RootProvider } from "fumadocs-ui/provider/next";

import "./global.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_FUMADOCS_URL ?? "http://localhost:3000",
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

const inter = Inter({
  subsets: ["latin"],
});

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
