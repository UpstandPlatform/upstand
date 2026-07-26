import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { foldAll, StreamLanguage, unfoldAll } from "@codemirror/language";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { SearchQuery, search, setSearchQuery } from "@codemirror/search";
import { EditorView, keymap } from "@codemirror/view";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import CodeMirror, { type ReactCodeMirrorProps } from "@uiw/react-codemirror";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import { Input } from "@upstand/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@upstand/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { cn } from "@upstand/ui/lib/utils";
import { useTheme } from "next-themes";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDownIcon as ChevronDown,
  ChevronRight,
  Code,
  Copy,
  FileText,
  Search,
  X,
} from "@/components/huge-icons";
import { copyText } from "@/lib/browser";

// Docker Compose completion options
const dockerComposeServices = [
  { label: "services", type: "keyword", info: "Define services" },
  { label: "version", type: "keyword", info: "Specify compose file version" },
  { label: "volumes", type: "keyword", info: "Define volumes" },
  { label: "networks", type: "keyword", info: "Define networks" },
  { label: "configs", type: "keyword", info: "Define configuration files" },
  { label: "secrets", type: "keyword", info: "Define secrets" },
].map((opt) => ({
  ...opt,
  apply: (
    view: EditorView,
    completion: Completion,
    from: number,
    to: number,
  ) => {
    const insert = `${completion.label}:`;
    view.dispatch({
      changes: {
        from,
        to,
        insert,
      },
      selection: { anchor: from + insert.length },
    });
  },
}));

const dockerComposeServiceOptions = [
  {
    label: "image",
    type: "keyword",
    info: "Specify the image to start the container from",
  },
  { label: "build", type: "keyword", info: "Build configuration" },
  { label: "command", type: "keyword", info: "Override the default command" },
  { label: "container_name", type: "keyword", info: "Custom container name" },
  {
    label: "depends_on",
    type: "keyword",
    info: "Express dependency between services",
  },
  { label: "environment", type: "keyword", info: "Add environment variables" },
  {
    label: "env_file",
    type: "keyword",
    info: "Add environment variables from a file",
  },
  {
    label: "expose",
    type: "keyword",
    info: "Expose ports without publishing them",
  },
  { label: "ports", type: "keyword", info: "Expose ports" },
  {
    label: "volumes",
    type: "keyword",
    info: "Mount host paths or named volumes",
  },
  { label: "restart", type: "keyword", info: "Restart policy" },
  { label: "networks", type: "keyword", info: "Networks to join" },
].map((opt) => ({
  ...opt,
  apply: (
    view: EditorView,
    completion: Completion,
    from: number,
    to: number,
  ) => {
    const insert = `${completion.label}: `;
    view.dispatch({
      changes: {
        from,
        to,
        insert,
      },
      selection: { anchor: from + insert.length },
    });
  },
}));

function dockerComposeComplete(
  context: CompletionContext,
): CompletionResult | null {
  const word = context.matchBefore(/\w*/);
  if (!word || (!word.text && !context.explicit)) return null;

  const line = context.state.doc.lineAt(context.pos);
  const indentation = /^\s*/.exec(line.text)?.[0].length || 0;

  if (indentation === 0) {
    return {
      from: word.from,
      options: dockerComposeServices,
      validFor: /^\w*$/,
    };
  }

  if (indentation === 4) {
    return {
      from: word.from,
      options: dockerComposeServiceOptions,
      validFor: /^\w*$/,
    };
  }

  return null;
}

export type SupportedLanguage =
  | "yaml"
  | "json"
  | "javascript"
  | "typescript"
  | "html"
  | "markdown"
  | "sql"
  | "properties"
  | "shell"
  | "css"
  | "caddy";

interface Props extends ReactCodeMirrorProps {
  wrapperClassName?: string;
  disabled?: boolean;
  language?: SupportedLanguage;
  allowLanguageChange?: boolean;
  lineWrapping?: boolean;
  lineNumbers?: boolean;
  showToolbar?: boolean;
  showStatusBar?: boolean;
  mode?: "editor" | "view";
}

export function CodeSurface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-border/40 bg-muted/20 shadow-sm",
        "[&_.cm-editor]:min-h-36 [&_.cm-editor]:bg-transparent [&_.cm-editor]:py-2",
        "[&_.cm-scroller]:font-mono [&_.cm-scroller]:text-xs",
        className,
      )}
    >
      {children}
    </div>
  );
}

export const CodeEditor = ({
  className,
  wrapperClassName,
  language = "yaml",
  allowLanguageChange = true,
  lineWrapping = false,
  lineNumbers = true,
  showToolbar = true,
  showStatusBar = true,
  mode = "editor",
  ...props
}: Props) => {
  const { resolvedTheme } = useTheme();
  const editorViewRef = useRef<EditorView | null>(null);

  const [activeLanguage, setActiveLanguage] =
    useState<SupportedLanguage>(language);
  const [activeLineWrapping, setActiveLineWrapping] = useState(lineWrapping);
  const [copied, setCopied] = useState(false);

  // VS Code style search state
  const [showSearch, setShowSearch] = useState(false);
  const [showReplaceInput, setShowReplaceInput] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [replaceTextVal, setReplaceTextVal] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [isRegexp, setIsRegexp] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [activeMatchIndex, setActiveMatchIndex] = useState<number | null>(null);

  // Status bar state
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [selectedChars, setSelectedChars] = useState(0);

  // Sync props to state
  useEffect(() => {
    setActiveLanguage(language);
  }, [language]);

  useEffect(() => {
    setActiveLineWrapping(lineWrapping);
  }, [lineWrapping]);

  // Dispatch search query changes to CodeMirror
  const updateSearchQuery = useCallback(
    (
      searchStr: string,
      caseSens: boolean,
      word: boolean,
      reg: boolean,
      replaceStr = "",
    ) => {
      if (!editorViewRef.current) return;
      const view = editorViewRef.current;
      const query = new SearchQuery({
        search: searchStr,
        caseSensitive: caseSens,
        wholeWord: word,
        regexp: reg,
        replace: replaceStr,
      });
      view.dispatch({
        effects: setSearchQuery.of(query),
      });

      // Calculate match count
      if (!searchStr) {
        setMatchCount(null);
        setActiveMatchIndex(null);
        return;
      }

      try {
        const docText = view.state.doc.toString();
        let matches = 0;
        let activeIdx = 0;
        const mainSel = view.state.selection.main;

        let flags = "g";
        if (!caseSens) flags += "i";
        let regex: RegExp;

        if (reg) {
          regex = new RegExp(searchStr, flags);
        } else {
          let escaped = searchStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (word) escaped = `\\b${escaped}\\b`;
          regex = new RegExp(escaped, flags);
        }

        let match = regex.exec(docText);
        while (match !== null) {
          matches++;
          if (
            mainSel.from >= match.index &&
            mainSel.from <= match.index + match[0].length
          ) {
            activeIdx = matches;
          }
          if (match.index === regex.lastIndex) {
            regex.lastIndex++;
          }
          match = regex.exec(docText);
        }

        setMatchCount(matches);
        setActiveMatchIndex(matches > 0 ? activeIdx || 1 : null);
      } catch {
        setMatchCount(null);
        setActiveMatchIndex(null);
      }
    },
    [],
  );

  const handleSearchInputChange = (val: string) => {
    setSearchText(val);
    updateSearchQuery(val, caseSensitive, wholeWord, isRegexp, replaceTextVal);
  };

  const getMatches = useCallback(
    (searchStr: string, caseSens: boolean, word: boolean, reg: boolean) => {
      if (!editorViewRef.current || !searchStr) return [];
      const view = editorViewRef.current;
      const docText = view.state.doc.toString();
      let flags = "g";
      if (!caseSens) flags += "i";
      let regex: RegExp;
      try {
        if (reg) {
          regex = new RegExp(searchStr, flags);
        } else {
          let escaped = searchStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (word) escaped = `\\b${escaped}\\b`;
          regex = new RegExp(escaped, flags);
        }
      } catch {
        return [];
      }

      const matches: { from: number; to: number }[] = [];
      let match = regex.exec(docText);
      while (match !== null) {
        matches.push({ from: match.index, to: match.index + match[0].length });
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
        match = regex.exec(docText);
      }
      return matches;
    },
    [],
  );

  const handleNextMatch = () => {
    if (!editorViewRef.current || !searchText) return;
    const view = editorViewRef.current;
    const matches = getMatches(searchText, caseSensitive, wholeWord, isRegexp);
    if (matches.length === 0) return;

    const currentPos = view.state.selection.main.head;
    const nextMatch = matches.find((m) => m.from > currentPos) || matches[0];

    view.dispatch({
      selection: { anchor: nextMatch.from, head: nextMatch.to },
      scrollIntoView: true,
    });
    updateSearchQuery(
      searchText,
      caseSensitive,
      wholeWord,
      isRegexp,
      replaceTextVal,
    );
  };

  const handlePrevMatch = () => {
    if (!editorViewRef.current || !searchText) return;
    const view = editorViewRef.current;
    const matches = getMatches(searchText, caseSensitive, wholeWord, isRegexp);
    if (matches.length === 0) return;

    const currentPos = view.state.selection.main.from;
    const prevMatches = matches.filter((m) => m.from < currentPos);
    const prevMatch =
      prevMatches.length > 0
        ? prevMatches[prevMatches.length - 1]
        : matches[matches.length - 1];

    view.dispatch({
      selection: { anchor: prevMatch.from, head: prevMatch.to },
      scrollIntoView: true,
    });
    updateSearchQuery(
      searchText,
      caseSensitive,
      wholeWord,
      isRegexp,
      replaceTextVal,
    );
  };

  const handleReplaceOne = () => {
    if (!editorViewRef.current || !searchText) return;
    const view = editorViewRef.current;
    const matches = getMatches(searchText, caseSensitive, wholeWord, isRegexp);
    if (matches.length === 0) return;

    const currentSel = view.state.selection.main;
    const activeMatch =
      matches.find(
        (m) => m.from === currentSel.from && m.to === currentSel.to,
      ) || matches[0];

    view.dispatch({
      changes: {
        from: activeMatch.from,
        to: activeMatch.to,
        insert: replaceTextVal,
      },
      selection: { anchor: activeMatch.from + replaceTextVal.length },
      scrollIntoView: true,
    });

    setTimeout(() => {
      handleNextMatch();
    }, 10);
  };

  const handleReplaceAll = () => {
    if (!editorViewRef.current || !searchText) return;
    const view = editorViewRef.current;
    const matches = getMatches(searchText, caseSensitive, wholeWord, isRegexp);
    if (matches.length === 0) return;

    const changes = matches.map((m) => ({
      from: m.from,
      to: m.to,
      insert: replaceTextVal,
    }));

    view.dispatch({ changes });
    toast.success(`Replaced ${matches.length} matches`);
    updateSearchQuery(
      searchText,
      caseSensitive,
      wholeWord,
      isRegexp,
      replaceTextVal,
    );
  };

  const toggleSearch = (withReplace = false) => {
    setShowSearch((prev) => {
      const next = !prev || withReplace !== showReplaceInput;
      setShowReplaceInput(withReplace);
      if (!next && editorViewRef.current) {
        updateSearchQuery("", false, false, false, "");
      }
      return next;
    });
  };

  const handleCopy = () => {
    const codeVal =
      editorViewRef.current?.state.doc.toString() ||
      (props.value as string) ||
      "";
    if (!codeVal.trim()) {
      toast.error("No code to copy");
      return;
    }
    void copyText(codeVal)
      .then(() => {
        setCopied(true);
        toast.success("Code copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Could not copy code");
      });
  };

  const handleFoldAll = () => {
    if (editorViewRef.current) {
      foldAll(editorViewRef.current);
    }
  };

  const handleUnfoldAll = () => {
    if (editorViewRef.current) {
      unfoldAll(editorViewRef.current);
    }
  };

  // Selection & position listener
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.selectionSet || update.docChanged) {
      const state = update.state;
      const mainSel = state.selection.main;
      const line = state.doc.lineAt(mainSel.head);
      setCursorLine(line.number);
      setCursorCol(mainSel.head - line.from + 1);
      setSelectedChars(mainSel.to - mainSel.from);
    }
  });

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-border/40 bg-card/10 shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary/20",
        wrapperClassName,
      )}
    >
      {showToolbar && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-border/40 border-b bg-card/60 px-3 py-1.5 text-xs">
          {/* Left panel: Language selection or Fixed Badge */}
          <div className="flex items-center gap-1.5">
            <Code className="size-3.5 text-muted-foreground" />
            {allowLanguageChange ? (
              <Select
                value={activeLanguage}
                onValueChange={(val) =>
                  setActiveLanguage(val as SupportedLanguage)
                }
                disabled={props.disabled}
              >
                <SelectTrigger className="h-6.5 border-none bg-transparent px-1 py-0 font-medium shadow-none hover:bg-muted/30">
                  <SelectValue placeholder="Language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yaml" className="text-xs">
                    YAML
                  </SelectItem>
                  <SelectItem value="json" className="text-xs">
                    JSON
                  </SelectItem>
                  <SelectItem value="javascript" className="text-xs">
                    JavaScript
                  </SelectItem>
                  <SelectItem value="typescript" className="text-xs">
                    TypeScript
                  </SelectItem>
                  <SelectItem value="html" className="text-xs">
                    HTML
                  </SelectItem>
                  <SelectItem value="markdown" className="text-xs">
                    Markdown
                  </SelectItem>
                  <SelectItem value="sql" className="text-xs">
                    SQL
                  </SelectItem>
                  <SelectItem value="css" className="text-xs">
                    CSS
                  </SelectItem>
                  <SelectItem value="shell" className="text-xs">
                    Shell / Bash
                  </SelectItem>
                  <SelectItem value="caddy" className="text-xs">
                    Caddy / Caddyfile
                  </SelectItem>
                  <SelectItem value="properties" className="text-xs">
                    Properties
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge
                variant="secondary"
                className="h-5 rounded border-none bg-muted/60 px-1.5 font-mono font-semibold text-[10px] text-muted-foreground uppercase tracking-wider"
              >
                {activeLanguage}
              </Badge>
            )}
          </div>

          {/* Right panel: Editor Actions */}
          <div className="flex items-center gap-1">
            <Button
              variant={showSearch ? "secondary" : "ghost"}
              size="sm"
              onClick={() => toggleSearch(false)}
              className="h-6.5 px-2 font-medium text-muted-foreground text-xs hover:text-foreground"
              aria-label="Find & Replace"
              title="Search (Ctrl+F)"
            >
              <Search className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleFoldAll}
              className="h-6.5 px-2 font-medium text-muted-foreground text-xs hover:text-foreground"
              aria-label="Fold all blocks"
            >
              Fold
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleUnfoldAll}
              className="h-6.5 px-2 font-medium text-muted-foreground text-xs hover:text-foreground"
              aria-label="Unfold all blocks"
            >
              Unfold
            </Button>
            <Button
              variant={activeLineWrapping ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveLineWrapping(!activeLineWrapping)}
              className="h-6.5 px-2 font-medium text-muted-foreground text-xs hover:text-foreground"
              aria-label="Toggle line wrapping"
            >
              <FileText className="mr-1 size-3.5" />
              Wrap
            </Button>
            <div className="mx-1 h-4 w-px bg-border/40" />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-6.5 px-2 font-medium text-muted-foreground text-xs hover:text-foreground"
              aria-label="Copy code to clipboard"
            >
              {copied ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Editor Body with VS Code floating search overlay */}
      <div className="custom-logs-scrollbar relative min-h-0 flex-1 overflow-auto">
        {/* VS Code Floating Search & Replace Overlay */}
        {showSearch && (
          <div className="fade-in slide-in-from-top-1 absolute top-2 right-3 z-30 flex min-w-[280px] max-w-[360px] animate-in flex-col gap-1.5 rounded-lg border border-border/60 bg-card/95 p-2 shadow-xl backdrop-blur-md duration-150">
            {/* Search Row */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setShowReplaceInput(!showReplaceInput)}
                title="Toggle Replace"
              >
                {showReplaceInput ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </Button>

              <InputGroup className="h-7 flex-1 border border-border/40 bg-background/80">
                <InputGroupInput
                  value={searchText}
                  onChange={(e) => handleSearchInputChange(e.target.value)}
                  placeholder="Find"
                  className="font-mono text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (e.shiftKey) handlePrevMatch();
                      else handleNextMatch();
                    } else if (e.key === "Escape") {
                      setShowSearch(false);
                      updateSearchQuery("", false, false, false, "");
                    }
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !caseSensitive;
                      setCaseSensitive(next);
                      updateSearchQuery(
                        searchText,
                        next,
                        wholeWord,
                        isRegexp,
                        replaceTextVal,
                      );
                    }}
                    className={cn(
                      "h-5 rounded px-1 font-bold font-mono text-[10px] transition-colors hover:bg-muted/60",
                      caseSensitive
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground",
                    )}
                    title="Match Case (Aa)"
                  >
                    Aa
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !wholeWord;
                      setWholeWord(next);
                      updateSearchQuery(
                        searchText,
                        caseSensitive,
                        next,
                        isRegexp,
                        replaceTextVal,
                      );
                    }}
                    className={cn(
                      "h-5 rounded px-1 font-bold font-mono text-[10px] transition-colors hover:bg-muted/60",
                      wholeWord
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground",
                    )}
                    title="Match Whole Word (\b)"
                  >
                    \b
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isRegexp;
                      setIsRegexp(next);
                      updateSearchQuery(
                        searchText,
                        caseSensitive,
                        wholeWord,
                        next,
                        replaceTextVal,
                      );
                    }}
                    className={cn(
                      "h-5 rounded px-1 font-bold font-mono text-[10px] transition-colors hover:bg-muted/60",
                      isRegexp
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground",
                    )}
                    title="Use Regular Expression (.*)"
                  >
                    .*
                  </button>
                </InputGroupAddon>
              </InputGroup>

              {/* Match counter */}
              <span className="min-w-10 shrink-0 select-none px-1 text-center font-mono text-[10px] text-muted-foreground">
                {matchCount !== null
                  ? matchCount > 0
                    ? `${activeMatchIndex ?? 1}/${matchCount}`
                    : "No results"
                  : ""}
              </span>

              {/* Navigation buttons */}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                onClick={handlePrevMatch}
                title="Previous Match (Shift+Enter)"
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                onClick={handleNextMatch}
                title="Next Match (Enter)"
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowSearch(false);
                  updateSearchQuery("", false, false, false, "");
                }}
                title="Close (Escape)"
              >
                <X className="size-3.5" />
              </Button>
            </div>

            {/* Replace Row */}
            {showReplaceInput && (
              <div className="fade-in flex animate-in items-center gap-1 pl-7 duration-100">
                <Input
                  value={replaceTextVal}
                  onChange={(e) => {
                    setReplaceTextVal(e.target.value);
                    updateSearchQuery(
                      searchText,
                      caseSensitive,
                      wholeWord,
                      isRegexp,
                      e.target.value,
                    );
                  }}
                  placeholder="Replace"
                  className="h-7 flex-1 bg-background/80 font-mono text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleReplaceOne();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReplaceOne}
                  className="h-7 shrink-0 px-2 font-medium font-mono text-[10px]"
                  title="Replace"
                >
                  Replace
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReplaceAll}
                  className="h-7 shrink-0 px-2 font-medium font-mono text-[10px]"
                  title="Replace All"
                >
                  All
                </Button>
              </div>
            )}
          </div>
        )}

        <CodeMirror
          basicSetup={{
            lineNumbers,
            foldGutter: true,
            searchKeymap: false,
            highlightSelectionMatches: true,
            highlightActiveLine: !props.disabled && mode === "editor",
            allowMultipleSelections: true,
          }}
          theme={resolvedTheme === "dark" ? githubDark : githubLight}
          extensions={[
            search(),
            keymap.of([
              {
                key: "Mod-f",
                run: () => {
                  toggleSearch(false);
                  return true;
                },
              },
              {
                key: "Mod-h",
                run: () => {
                  toggleSearch(true);
                  return true;
                },
              },
              {
                key: "Escape",
                run: () => {
                  setShowSearch(false);
                  updateSearchQuery("", false, false, false, "");
                  return true;
                },
              },
            ]),
            updateListener,
            activeLanguage === "yaml"
              ? yaml()
              : activeLanguage === "json"
                ? json()
                : activeLanguage === "javascript"
                  ? javascript({ typescript: false })
                  : activeLanguage === "typescript"
                    ? javascript({ typescript: true })
                    : activeLanguage === "html"
                      ? html()
                      : activeLanguage === "markdown"
                        ? markdown()
                        : activeLanguage === "sql"
                          ? sql()
                          : activeLanguage === "css"
                            ? css()
                            : activeLanguage === "shell"
                              ? StreamLanguage.define(shell)
                              : StreamLanguage.define({
                                  ...properties,
                                  languageData: {
                                    commentTokens: { line: "#" },
                                  },
                                }),
            activeLineWrapping ? EditorView.lineWrapping : [],
            activeLanguage === "yaml"
              ? autocompletion({
                  override: [dockerComposeComplete],
                })
              : [],
          ]}
          onCreateEditor={(view) => {
            editorViewRef.current = view;
          }}
          {...props}
          editable={!props.disabled && mode === "editor"}
          readOnly={props.readOnly || mode === "view"}
          className={cn(
            "relative h-full w-full text-sm leading-relaxed",
            "[&_.cm-scroller]:custom-logs-scrollbar focus-visible:outline-none [&_.cm-editor]:bg-transparent [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-xs",
            "&_.cm-gutters { background-color: transparent; 1px solid var(--border-color, rgba(128,128,128,0.15)); } border-right:",
            "&_.cm-panel.cm-search { display: none !important; }", // Hide default unstyled CM search panel in favor of our VS Code overlay
            `cm-theme-${resolvedTheme}`,
            className,
          )}
        >
          {props.disabled && (
            <div className="absolute top-0 left-0 z-10 flex h-full w-full items-center justify-center rounded-md bg-background/50 backdrop-blur-[0.5px]" />
          )}
        </CodeMirror>
      </div>

      {/* VS Code Style Status Bar */}
      {showStatusBar && (
        <div className="flex h-6 shrink-0 select-none items-center justify-between border-border/30 border-t bg-muted/30 px-3 font-mono text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              Ln {cursorLine}, Col {cursorCol}
            </span>
            {selectedChars > 0 && (
              <span className="font-medium text-primary">
                ({selectedChars} selected)
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span>Spaces: 2</span>
            <span>UTF-8</span>
            <span className="font-semibold text-foreground/75 uppercase">
              {activeLanguage}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
