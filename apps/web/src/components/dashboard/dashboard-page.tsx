import { cn } from "@upstand/ui/lib/utils";
import type { ReactNode } from "react";

export function DashboardPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "mx-auto flex min-h-full w-full min-w-0 max-w-7xl flex-col gap-6 overflow-x-hidden px-4 py-6 sm:gap-8 sm:py-8 md:px-8",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function DashboardPageHeader({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex min-w-0 flex-col gap-4 border-border/40 border-b pb-5 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="flex min-w-0 items-center gap-2 text-balance font-bold text-2xl text-foreground tracking-tight">
          {icon}
          <span className="truncate">{title}</span>
        </h1>
        {description && (
          <p className="mt-1 max-w-3xl text-muted-foreground text-sm">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      )}
    </header>
  );
}
