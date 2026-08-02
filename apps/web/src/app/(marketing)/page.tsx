"use client";

import {
  CodeIcon,
  Download01Icon,
  Folder01Icon,
  LockPasswordIcon,
  Rocket01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@upstand/ui/components/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSystemConfig } from "@/hooks/use-system-config";
import { getDocsUrl } from "@/lib/server-url";

const FEATURES = [
  {
    icon: Rocket01Icon,
    title: "Deploy",
    description:
      "Connect a server, choose a repository, get a production release with SSL and rollbacks handled.",
  },
  {
    icon: Folder01Icon,
    title: "Organize",
    description:
      "Workspaces, environments, and team roles keep things clear as your infrastructure grows.",
  },
  {
    icon: LockPasswordIcon,
    title: "Protect",
    description:
      "Self-hosted by default, with 2FA and secure sessions on services you control end to end.",
  },
];

const DEPLOY_LOG = [
  { text: "$ git push upstand main", tone: "muted" },
  { text: "→ building upstand-web", tone: "muted" },
  { text: "→ provisioning SSL", tone: "muted" },
  { text: "✓ deployed to app.yourdomain.com", tone: "primary" },
] as const;

export default function Home() {
  const router = useRouter();
  const { isCloud, isLoading } = useSystemConfig();

  useEffect(() => {
    if (!isLoading && !isCloud) {
      router.replace("/login");
    }
  }, [isLoading, isCloud, router]);

  if (!isCloud) {
    return null;
  }

  return (
    <div id="top">
      <div className="mx-auto w-full max-w-5xl px-6 pt-24 pb-20 md:px-8 md:pt-32 md:pb-28">
        {/* Hero */}
        <section className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-[0.18em]">
            Self-hosted deployments
          </p>
          <h1 className="mt-5 text-balance font-semibold text-5xl tracking-[-0.03em] sm:text-6xl">
            Deploy on servers you already own.
          </h1>
          <p className="mx-auto mt-6 max-w-md text-balance text-muted-foreground leading-7">
            Point Upstand at a server, connect a repo, and ship — with SSL,
            environments, and rollbacks handled for you.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              size="lg"
              render={<Link href="/dashboard" />}
              nativeButton={false}
            >
              Start deploying
            </Button>
            <Button
              size="lg"
              variant="outline"
              render={
                <a
                  href="https://github.com/UpstandPlatform/upstand/releases/latest"
                  target="_blank"
                  rel="noreferrer"
                />
              }
              nativeButton={false}
            >
              <HugeiconsIcon icon={Download01Icon} className="size-4" />
              Download desktop
            </Button>
          </div>
        </section>

        {/* Signature: a real deploy, shown plainly */}
        <section className="mx-auto mt-16 max-w-lg">
          <div className="rounded-lg border bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <HugeiconsIcon
                icon={CodeIcon}
                className="size-3.5 text-muted-foreground"
              />
              <span className="font-mono text-muted-foreground text-xs">
                upstand deploy
              </span>
            </div>
            <div className="space-y-1.5 px-4 py-4 font-mono text-xs leading-relaxed">
              {DEPLOY_LOG.map((line) => (
                <p
                  key={line.text}
                  className={
                    line.tone === "primary"
                      ? "text-primary"
                      : "text-muted-foreground"
                  }
                >
                  {line.text}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mt-28 md:mt-36">
          <div className="grid gap-10 sm:grid-cols-3 sm:gap-8">
            {FEATURES.map((feature) => (
              <div key={feature.title}>
                <HugeiconsIcon
                  icon={feature.icon}
                  className="size-5 text-primary"
                />
                <h3 className="mt-4 font-medium text-base">{feature.title}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-6">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-16 flex flex-col gap-3 border-t pt-6 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
          <span>Upstand — open-source infrastructure for teams that ship.</span>
          <div className="flex gap-4">
            <a
              className="hover:text-foreground"
              href={getDocsUrl()}
              suppressHydrationWarning
            >
              Docs
            </a>
            <a
              className="hover:text-foreground"
              href="https://github.com/UpstandPlatform/upstand"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
