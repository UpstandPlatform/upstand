"use client";

import { ArrowRight01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";

const settings = [
  {
    title: "General",
    description: "Profile, workspace, and security preferences.",
    event: "open-settings-dialog",
  },
  {
    title: "Tokens and MCP",
    description: "Manage API access and agent connections.",
    event: "open-settings-dialog",
  },
  {
    title: "Team and notifications",
    description: "Manage members and notification preferences.",
    event: "open-settings-dialog",
  },
  {
    title: "Backup and migration",
    description: "Open the existing backup, export, and restore workflows.",
    href: "/workspace/backups",
  },
];

export default function WorkspaceSettingsPage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div>
        <h1 className="font-semibold text-3xl tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your preferences, workspace, and control-plane configuration.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {settings.map((item) => (
          <Card className="rounded-2xl border-border/70" key={item.title}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-muted p-2">
                  <HugeiconsIcon icon={Settings01Icon} />
                </div>
                <CardTitle className="text-base">{item.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                {item.description}
              </p>
              {item.href ? (
                <a
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border px-3 font-medium text-sm"
                  href={item.href}
                >
                  Open <HugeiconsIcon icon={ArrowRight01Icon} />
                </a>
              ) : (
                <Button
                  className="mt-4"
                  onClick={() => {
                    if (item.event)
                      window.dispatchEvent(new CustomEvent(item.event));
                  }}
                  variant="outline"
                >
                  Open <HugeiconsIcon icon={ArrowRight01Icon} />
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
