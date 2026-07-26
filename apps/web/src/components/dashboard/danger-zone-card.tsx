"use client";

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@upstand/ui/components/button";
import { Card, CardContent } from "@upstand/ui/components/card";
import { Spinner } from "@upstand/ui/components/spinner";
import { cn } from "@upstand/ui/lib/utils";
import type { ReactNode } from "react";
import { Trash2 } from "@/components/huge-icons";

export interface DangerZoneCardProps {
  title: string;
  description: ReactNode;
  actionLabel: string;
  onAction?: () => void;
  disabled?: boolean;
  pending?: boolean;
  warningText?: ReactNode;
  infoText?: ReactNode;
  className?: string;
}

export function DangerZoneCard({
  title,
  description,
  actionLabel,
  onAction,
  disabled = false,
  pending = false,
  warningText,
  infoText,
  className,
}: DangerZoneCardProps) {
  return (
    <Card
      className={cn(
        "border border-destructive/25 bg-destructive/5 p-4 shadow-2xs dark:bg-destructive/10",
        className,
      )}
    >
      <CardContent className="space-y-3 p-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <h4 className="font-semibold text-destructive text-sm tracking-tight">
              {title}
            </h4>
            <div className="text-muted-foreground text-xs leading-relaxed">
              {description}
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={disabled || pending}
            onClick={onAction}
            className="h-8 shrink-0 gap-1.5 self-start px-3 font-medium text-xs sm:self-auto"
          >
            {pending ? (
              <Spinner className="size-3.5" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            <span>{actionLabel}</span>
          </Button>
        </div>

        {warningText && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-amber-600 text-xs dark:text-amber-400">
            <HugeiconsIcon
              icon={Alert02Icon}
              className="mt-0.5 size-4 shrink-0"
            />
            <div className="min-w-0 leading-normal">{warningText}</div>
          </div>
        )}

        {infoText && (
          <p className="text-muted-foreground text-xs">{infoText}</p>
        )}
      </CardContent>
    </Card>
  );
}
