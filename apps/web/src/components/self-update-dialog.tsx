"use client";

import {
  CheckmarkCircle02Icon,
  CloudUploadIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import { Progress } from "@upstand/ui/components/progress";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/utils/trpc";

type SelfUpdateDialogProps = {
  open: boolean;
  version: string;
};

function sameVersion(current: string, target: string) {
  return current.trim().replace(/^v/i, "") === target.trim().replace(/^v/i, "");
}

const POLL_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Update status request timed out")),
        timeoutMs,
      );
    }),
  ]);
}

export function SelfUpdateDialog({ open, version }: SelfUpdateDialogProps) {
  const [progress, setProgress] = useState(12);
  const [message, setMessage] = useState("Preparing a rolling update…");
  const [complete, setComplete] = useState(false);
  const checking = useRef(false);
  const completed = useRef(false);
  const mounted = useRef(false);
  const reloadStarted = useRef(false);
  const reloadTimer = useRef<{ timer?: ReturnType<typeof setTimeout> }>({});
  const check = useMutation(trpc.webServer.checkForUpdates.mutationOptions());

  useEffect(() => {
    if (!open) return;
    setProgress(12);
    setMessage("Preparing a rolling update…");
    setComplete(false);
    checking.current = false;
    completed.current = false;
    mounted.current = true;
    reloadStarted.current = false;

    const poll = async () => {
      if (checking.current || completed.current) return;
      checking.current = true;
      try {
        // The API briefly disappears while Swarm replaces the web service. A
        // request made just before that happens can otherwise stay pending
        // forever and permanently lock the polling loop.
        const status = await withTimeout(check.mutateAsync(), POLL_TIMEOUT_MS);
        if (!mounted.current) return;
        if (sameVersion(status.currentVersion, version)) {
          setProgress(100);
          setMessage("Update complete. Reloading this page…");
          setComplete(true);
          completed.current = true;
          if (!reloadStarted.current) {
            reloadStarted.current = true;
            reloadTimer.current.timer = setTimeout(() => {
              window.location.reload();
              // Some browsers keep the old document alive when a reload is
              // requested during a failed connection recovery. Ensure the
              // healthy page is loaded even in that case.
              window.setTimeout(
                () => window.location.assign(window.location.href),
                2000,
              );
            }, 700);
          }
        } else {
          setProgress((value) => Math.min(90, value + 12));
          setMessage(
            status.currentVersion
              ? `Swarm is rolling out ${version}. The API is still on ${status.currentVersion}.`
              : "Waiting for the API to return after the rollout…",
          );
        }
      } catch {
        setProgress((value) => Math.min(90, value + 8));
        setMessage("Waiting for the API to return after the rollout…");
      } finally {
        checking.current = false;
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 4000);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      if (reloadTimer.current.timer) clearTimeout(reloadTimer.current.timer);
    };
  }, [open, version, check.mutateAsync]);

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100vw-2rem)] max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={complete ? CheckmarkCircle02Icon : CloudUploadIcon}
              className={
                complete ? "size-5 text-success" : "size-5 text-primary"
              }
            />
            {complete ? "Upstand updated" : `Updating Upstand to ${version}`}
          </DialogTitle>
          <DialogDescription aria-live="polite">{message}</DialogDescription>
        </DialogHeader>
        <Progress value={progress} aria-label="Update progress" />
        <p className="text-muted-foreground text-xs">
          Keep this window open. When the rollout is healthy, this page reloads
          automatically.
        </p>
      </DialogContent>
    </Dialog>
  );
}
