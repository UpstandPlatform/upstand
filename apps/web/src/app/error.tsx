"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 text-center">
      <div className="mx-auto max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="font-semibold text-foreground text-xl">
          Something went wrong
        </h2>
        <p className="mt-2 text-muted-foreground text-sm">
          An unexpected error occurred while rendering this page.
        </p>
        {error.message && (
          <pre className="mt-4 max-h-32 overflow-auto rounded bg-muted p-3 text-left font-mono text-destructive text-xs">
            {error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 focus:outline-none"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
