import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@upstand/ui/components/empty";
import { cn } from "@upstand/ui/lib/utils";
import type { ReactNode } from "react";
import type { HugeIcon } from "@/components/huge-icons";

type PageEmptyComponent = HugeIcon;
type PageEmptyIcon = IconSvgElement | PageEmptyComponent;

function isHugeIcon(value: PageEmptyIcon): value is PageEmptyComponent {
  return (
    typeof value === "function" ||
    (typeof value === "object" && value !== null && "$$typeof" in value)
  );
}

export function PageEmpty({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: PageEmptyIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn(className)}>
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon">
            {isHugeIcon(Icon) ? (
              <Icon className="size-6" aria-hidden="true" />
            ) : (
              <HugeiconsIcon icon={Icon} aria-hidden="true" />
            )}
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
