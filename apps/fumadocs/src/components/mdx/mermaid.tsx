"use client";

import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";

export function Mermaid({ chart }: { chart: string }) {
  const rawId = useId();
  const cleanId = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function renderChart() {
      try {
        const { default: mermaid } = await import("mermaid");

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          fontFamily: "inherit",
          themeCSS: "margin: 1.5rem auto 0;",
          theme: resolvedTheme === "dark" ? "dark" : "default",
        });

        // Clean up any previously generated temporary elements with cleanId
        const existingEl = document.getElementById(cleanId);
        if (existingEl) {
          existingEl.remove();
        }

        const formattedChart = chart.replaceAll("\\n", "\n");
        const { svg: renderedSvg } = await mermaid.render(
          cleanId,
          formattedChart,
        );

        if (isMounted) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          console.warn("Mermaid rendering fallback:", err);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart, resolvedTheme, cleanId]);

  if (error) {
    return (
      <div className="my-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 font-mono text-amber-700 text-xs dark:text-amber-300">
        <div className="mb-2 font-sans font-semibold text-amber-800 dark:text-amber-200">
          Diagram Code Preview
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-amber-500/10 p-3">
          {chart}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-6 flex h-32 items-center justify-center rounded-lg border border-zinc-200 border-dashed bg-zinc-50/50 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/50">
        Loading diagram...
      </div>
    );
  }

  return (
    <div
      className="my-6 flex justify-center overflow-x-auto rounded-lg border border-zinc-200/60 bg-white/50 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/50"
      // Mermaid returns a sanitized SVG element
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Sanitized SVG output from Mermaid
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
