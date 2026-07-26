"use client";

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@upstand/ui/components/alert-dialog";
import { Input } from "@upstand/ui/components/input";
import { Spinner } from "@upstand/ui/components/spinner";
import { type ReactNode, useEffect, useState } from "react";

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel,
  pending = false,
  onConfirm,
  children,
  requireConfirmText = false,
  confirmText = "DELETE",
  variant = "destructive",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  actionLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
  requireConfirmText?: boolean;
  confirmText?: string;
  variant?: "destructive" | "default";
}) {
  const [confirmInput, setConfirmInput] = useState("");

  useEffect(() => {
    if (!open) {
      setConfirmInput("");
    }
  }, [open]);

  const shouldRequireText = requireConfirmText && variant === "destructive";
  const isInputValid = !shouldRequireText || confirmInput === confirmText;

  const handleAction = () => {
    if (!isInputValid || pending) return;
    onConfirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <HugeiconsIcon
            icon={Alert02Icon}
            aria-hidden="true"
            className={
              variant === "destructive" ? "text-destructive" : "text-primary"
            }
          />
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {children}

        {shouldRequireText && (
          <div className="space-y-2 py-1">
            <label
              htmlFor="confirm-action-input"
              className="font-medium text-muted-foreground text-xs"
            >
              To confirm this action, type{" "}
              <strong className="select-none font-bold font-mono text-foreground">
                {confirmText}
              </strong>{" "}
              below:
            </label>
            <Input
              id="confirm-action-input"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={`Type "${confirmText}"`}
              className="h-9 font-mono text-xs"
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter" && isInputValid && !pending) {
                  e.preventDefault();
                  handleAction();
                }
              }}
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={variant}
            disabled={pending || !isInputValid}
            onClick={handleAction}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? `${actionLabel}…` : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
