import { memo, useCallback } from "react";

export interface InspectButtonProps {
  label: string;
  title?: string;
  className?: string;
  onClick: () => void;
}

export const InspectButton = memo(function InspectButton({
  label,
  title,
  onClick,
}: InspectButtonProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick();
    },
    [onClick],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={title ?? label}
      className="flex size-3.5 shrink-0 cursor-pointer flex-col items-end justify-center gap-0.5 rounded-xs border-0 bg-transparent p-0 transition-opacity hover:opacity-80"
    >
      <span className="block h-0.5 w-2.5 rounded-xs bg-muted-foreground/70" />
      <span className="block h-0.5 w-2.5 rounded-xs bg-muted-foreground/70" />
      <span className="block h-0.5 w-1.5 rounded-xs bg-muted-foreground/70" />
    </button>
  );
});
