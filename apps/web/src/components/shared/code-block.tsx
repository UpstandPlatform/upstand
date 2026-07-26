"use client";

import { Button } from "@upstand/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@upstand/ui/components/tabs";
import { cn } from "@upstand/ui/lib/utils";
import { useState } from "react";
import type { BundledLanguage } from "shiki";
import { toast } from "sonner";
import { CodeBlock as ShikiCodeBlock } from "@/components/ai-elements/code-block";
import { Check, Copy, Download } from "@/components/huge-icons";
import { copyText, downloadText } from "@/lib/browser";

export interface CodeBlockTab {
  label: string;
  code: string;
  language: string;
  filename?: string;
}

interface PerfectCodeBlockProps {
  code?: string;
  language?: string;
  filename?: string;
  title?: string;
  tabs?: CodeBlockTab[];
  showLineNumbers?: boolean;
  showCopy?: boolean;
  showDownload?: boolean;
  className?: string;
}

function normalizeLanguage(language: string): BundledLanguage {
  switch (language.toLowerCase().trim()) {
    case "bash":
    case "sh":
    case "shell":
      return "shellscript";
    case "c#":
    case "csharp":
      return "csharp";
    case "docker":
      return "dockerfile";
    case "js":
      return "javascript";
    case "md":
      return "markdown";
    case "ps1":
    case "powershell":
      return "powershell";
    case "py":
      return "python";
    case "rb":
      return "ruby";
    case "ts":
      return "typescript";
    case "yml":
      return "yaml";
    case "css":
      return "css";
    case "cpp":
      return "cpp";
    case "go":
      return "go";
    case "html":
      return "html";
    case "java":
      return "java";
    case "json":
      return "json";
    case "kotlin":
    case "kt":
      return "kotlin";
    case "php":
      return "php";
    case "rust":
    case "rs":
      return "rust";
    case "scss":
      return "scss";
    case "sql":
      return "sql";
    case "swift":
      return "swift";
    case "tsx":
      return "tsx";
    case "xml":
      return "xml";
    case "zsh":
      return "shellscript";
    default:
      return "javascript";
  }
}

function getDownloadFilename(
  language?: string,
  filename?: string,
  title?: string,
): string {
  if (filename?.trim()) return filename.trim();
  if (title?.includes(".")) return title.trim();

  const lang = (language || "").toLowerCase().trim();
  const extMap: Record<string, string> = {
    javascript: "js",
    js: "js",
    typescript: "ts",
    ts: "ts",
    jsx: "jsx",
    tsx: "tsx",
    json: "json",
    jsonc: "jsonc",
    python: "py",
    py: "py",
    bash: "sh",
    sh: "sh",
    zsh: "sh",
    shell: "sh",
    powershell: "ps1",
    ps1: "ps1",
    html: "html",
    css: "css",
    scss: "scss",
    sql: "sql",
    yaml: "yaml",
    yml: "yml",
    xml: "xml",
    markdown: "md",
    md: "md",
    dockerfile: "dockerfile",
    docker: "dockerfile",
    rust: "rs",
    rs: "rs",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    csharp: "cs",
    cs: "cs",
    php: "php",
    ruby: "rb",
    rb: "rb",
    swift: "swift",
    kotlin: "kt",
    kt: "kt",
  };

  const ext = extMap[lang] || "txt";
  const baseTitle = title
    ? title.trim().replace(/\s+/g, "-").toLowerCase()
    : "code-snippet";
  return baseTitle.endsWith(`.${ext}`) ? baseTitle : `${baseTitle}.${ext}`;
}

export function CodeBlock({
  code,
  language = "javascript",
  filename,
  title,
  tabs,
  showLineNumbers = false,
  showCopy = true,
  showDownload = true,
  className,
}: PerfectCodeBlockProps) {
  const [activeTabIdx, setActiveTabIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  // Multi-tab mode
  if (tabs && tabs.length > 0) {
    const currentTab = tabs[activeTabIdx] || tabs[0];
    const handleCopy = () => {
      void copyText(currentTab.code)
        .then(() => {
          setCopied(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          toast.error("Failed to copy code snippet");
        });
    };

    const handleDownload = () => {
      try {
        const downloadName = getDownloadFilename(
          currentTab.language,
          currentTab.filename,
          currentTab.label,
        );
        downloadText(currentTab.code, downloadName);
        toast.success(`Downloaded ${downloadName}`);
      } catch {
        toast.error("Failed to download code snippet");
      }
    };

    return (
      <div
        className={cn(
          "group relative w-full overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm dark:bg-zinc-950/80",
          className,
        )}
      >
        {/* Tabs and Actions Header */}
        <div className="flex h-11 items-center justify-between border-border/40 border-b bg-muted/40 px-4 py-1.5 text-muted-foreground">
          <Tabs
            value={String(activeTabIdx)}
            onValueChange={(val) => {
              setActiveTabIdx(Number(val));
              setCopied(false);
            }}
            className="w-auto"
          >
            <TabsList className="h-8 border border-border/20 bg-muted p-0.5">
              {tabs.map((tab, idx) => (
                <TabsTrigger
                  key={`${tab.label}-${idx}`}
                  value={String(idx)}
                  className="h-6.5 px-2.5 font-medium text-[11px] data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-1.5">
            {currentTab.filename && (
              <span className="mr-1 hidden select-none font-mono text-[10px] text-muted-foreground/60 sm:inline">
                {currentTab.filename}
              </span>
            )}
            {showDownload && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDownload}
                className="h-7 w-7 text-muted-foreground hover:bg-muted/80 hover:text-foreground dark:hover:bg-zinc-850"
                aria-label={`Download ${currentTab.label} code snippet`}
                title="Download code snippet"
              >
                <Download className="size-3.5" />
              </Button>
            )}
            {showCopy && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                className="h-7 w-7 text-muted-foreground hover:bg-muted/80 hover:text-foreground dark:hover:bg-zinc-850"
                aria-label={`Copy ${currentTab.label} code snippet`}
                title="Copy code snippet"
              >
                {copied ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Shiki highlighted body */}
        <ShikiCodeBlock
          code={currentTab.code}
          language={normalizeLanguage(currentTab.language)}
          showLineNumbers={showLineNumbers}
          className="m-0 rounded-none border-none bg-transparent shadow-none [&_pre]:p-4"
        />
      </div>
    );
  }

  // Single code snippet mode
  const displayCode = code ?? "";
  const displayLang = language;
  const displayFilename = filename || title;

  const handleCopySingle = () => {
    void copyText(displayCode)
      .then(() => {
        setCopied(true);
        toast.success("Copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        toast.error("Failed to copy code snippet");
      });
  };

  const handleDownloadSingle = () => {
    try {
      const downloadName = getDownloadFilename(displayLang, filename, title);
      downloadText(displayCode, downloadName);
      toast.success(`Downloaded ${downloadName}`);
    } catch {
      toast.error("Failed to download code snippet");
    }
  };

  const showHeader = showCopy || showDownload || Boolean(displayFilename);

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm dark:bg-zinc-950/80",
        className,
      )}
    >
      {showHeader && (
        <div className="flex h-10 items-center justify-between border-border/40 border-b bg-muted/40 px-4 py-2 text-muted-foreground">
          <span className="select-none font-mono text-[11px] text-muted-foreground/80">
            {displayFilename || displayLang.toUpperCase()}
          </span>
          <div className="flex items-center gap-1.5">
            {showDownload && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDownloadSingle}
                className="h-7 w-7 text-muted-foreground hover:bg-muted/80 hover:text-foreground dark:hover:bg-zinc-850"
                aria-label="Download code snippet"
                title="Download code snippet"
              >
                <Download className="size-3.5" />
              </Button>
            )}
            {showCopy && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopySingle}
                className="h-7 w-7 text-muted-foreground hover:bg-muted/80 hover:text-foreground dark:hover:bg-zinc-850"
                aria-label="Copy code snippet"
                title="Copy code snippet"
              >
                {copied ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      <ShikiCodeBlock
        code={displayCode}
        language={normalizeLanguage(displayLang)}
        showLineNumbers={showLineNumbers}
        className="m-0 rounded-none border-none bg-transparent shadow-none [&_pre]:p-4"
      />
    </div>
  );
}
