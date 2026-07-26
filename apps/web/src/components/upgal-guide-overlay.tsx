"use client";

import type { UpGalUIAction } from "@upstand/api/ai/upgal";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { UpGalTargetRect } from "@/lib/upgal-ui-actions";
import {
  findUpGalTarget,
  getUpGalTargetRect,
  getUpGalUiTarget,
  readUpGalPlan,
  removeUpGalPlan,
  spotlightUpGalTarget,
  upGalPlanUrl,
} from "@/lib/upgal-ui-actions";

type Plan = UpGalUIAction;

function normalizedPath(path: string) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function cleanPlanQuery(pathname: string, planId: string) {
  const params = new URLSearchParams(window.location.search);
  params.delete("upgal_plan");
  params.delete("upgal_action");
  const query = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${pathname}${query ? `?${query}` : ""}`,
  );
  try {
    removeUpGalPlan(planId);
  } catch {
    // Best-effort cleanup only.
  }
}

export function UpGalGuideOverlay() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = searchParams.get("upgal_plan");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetAvailable, setTargetAvailable] = useState(false);
  const [targetLabel, setTargetLabel] = useState<string | null>(null);
  const [targetRect, setTargetRect] = useState<UpGalTargetRect | null>(null);

  useEffect(() => {
    if (!planId) {
      setPlan(null);
      return;
    }
    const candidate = readUpGalPlan(planId);
    if (candidate?.kind !== "ui_action_plan") {
      setPlan(null);
      return;
    }
    setPlan(candidate);
    setStepIndex(0);
  }, [planId]);

  const step = plan?.steps[stepIndex];
  const targetDefinition =
    step && step.type !== "navigate" ? getUpGalUiTarget(step.target) : null;
  const targetRoute =
    targetDefinition &&
    "path" in targetDefinition &&
    targetDefinition.kind !== "navigation"
      ? targetDefinition.path
      : undefined;
  const targetRouteMismatch = Boolean(
    targetRoute && normalizedPath(pathname) !== normalizedPath(targetRoute),
  );

  useEffect(() => {
    if (!planId || !targetRoute || !targetRouteMismatch) return;
    router.replace(upGalPlanUrl(targetRoute, planId) as Route, {
      scroll: false,
    });
  }, [planId, router, targetRoute, targetRouteMismatch]);

  useEffect(() => {
    if (!step) {
      setTargetAvailable(false);
      setTargetLabel(null);
      setTargetRect(null);
      return;
    }
    if (step.type === "navigate") {
      setTargetAvailable(true);
      setTargetLabel(null);
      setTargetRect(null);
      return;
    }
    setTargetAvailable(false);
    setTargetLabel(targetDefinition?.label ?? null);
    setTargetRect(null);
    let attempts = 0;
    let timer: number | undefined;
    let highlighted = false;
    const locate = () => {
      const found = findUpGalTarget(step.target);
      const rect = found ? getUpGalTargetRect(step.target) : null;
      setTargetAvailable(Boolean(rect));
      setTargetLabel(
        found?.dataset.upgalLabel ?? targetDefinition?.label ?? null,
      );
      setTargetRect(rect);
      if (found && rect && !highlighted) {
        highlighted = true;
        if (step.type === "focus") found.focus({ preventScroll: true });
        spotlightUpGalTarget(step.target);
      }
      if (attempts < (found ? 15 : 50)) {
        attempts += 1;
        timer = window.setTimeout(locate, 100);
      }
    };
    locate();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [step, targetDefinition?.label]);

  const finish = useCallback(() => {
    if (planId) cleanPlanQuery(pathname, planId);
    setPlan(null);
    router.replace(pathname as Route, { scroll: false });
  }, [pathname, planId, router]);

  if (!plan || !step) return null;

  const isLast = stepIndex === plan.steps.length - 1;
  const advance = () => {
    if (!targetAvailable) return;
    if (step.type === "navigate") {
      if (normalizedPath(pathname) !== normalizedPath(step.path) && planId) {
        router.push(upGalPlanUrl(step.path, planId) as Route, {
          scroll: false,
        });
        return;
      }
      if (isLast) finish();
      else setStepIndex((current) => current + 1);
      return;
    }
    if (step.type === "open_dialog") {
      const element = findUpGalTarget(step.target);
      if (element?.dataset.upgalAction !== "open_dialog") return;
      element.click();
    }
    if (isLast) finish();
    else setStepIndex((current) => current + 1);
  };

  return (
    <>
      {targetRect ? (
        <div
          aria-hidden="true"
          className="upgal-spotlight-frame"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
          }}
        />
      ) : null}
      <Card
        aria-label="UpGal walkthrough"
        className="fixed bottom-5 left-5 z-[60] w-[min(380px,calc(100vw-40px))] border-primary/30 shadow-2xl"
        role="region"
      >
        <CardHeader className="gap-3 pb-3">
          <div className="flex items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span className="font-semibold text-sm">{stepIndex + 1}</span>
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm">UpGal guide</CardTitle>
              <p className="text-muted-foreground text-xs">
                Step {stepIndex + 1} of {plan.steps.length}
              </p>
            </div>
          </div>
          <div
            aria-label={`Walkthrough progress: step ${stepIndex + 1} of ${plan.steps.length}`}
            aria-valuemax={plan.steps.length}
            aria-valuemin={1}
            aria-valuenow={stepIndex + 1}
            className="h-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{
                width: `${((stepIndex + 1) / plan.steps.length) * 100}%`,
              }}
            />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          {targetLabel ? (
            <p className="font-medium text-sm" translate="no">
              {targetLabel}
            </p>
          ) : null}
          <p className="text-sm leading-relaxed">{step.description}</p>
          {!targetAvailable ? (
            <p aria-live="polite" className="text-muted-foreground text-xs">
              {targetRouteMismatch
                ? `Opening ${targetRoute}…`
                : `Waiting for ${targetDefinition?.label ?? "the relevant control"} to become available…`}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <Button onClick={finish} size="sm" variant="ghost">
              Exit guide
            </Button>
            <div className="flex gap-2">
              <Button
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((current) => current - 1)}
                size="sm"
                variant="outline"
              >
                Back
              </Button>
              <Button disabled={!targetAvailable} onClick={advance} size="sm">
                {!targetAvailable
                  ? "Waiting…"
                  : step.type === "open_dialog"
                    ? "Open dialog"
                    : isLast
                      ? "Done"
                      : "Next"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
