import {
  Activity01Icon,
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  InformationCircleIcon,
  MultiplicationSignCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Badge } from "@upstand/ui/components/badge";

export type StatusTone =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

const STATUS_ICONS: Record<StatusTone, IconSvgElement> = {
  default: CheckmarkCircle02Icon,
  secondary: InformationCircleIcon,
  destructive: MultiplicationSignCircleIcon,
  outline: InformationCircleIcon,
  success: CheckmarkCircle02Icon,
  warning: Alert02Icon,
  info: Activity01Icon,
};

export function StatusBadge({
  label,
  tone = "secondary",
  showIcon = true,
}: {
  label: string;
  tone?: StatusTone;
  showIcon?: boolean;
}) {
  return (
    <Badge variant={tone}>
      {showIcon ? (
        <HugeiconsIcon
          icon={tone === "warning" ? Clock01Icon : STATUS_ICONS[tone]}
          aria-hidden="true"
          data-icon="inline-start"
        />
      ) : null}
      <span>{label}</span>
    </Badge>
  );
}
