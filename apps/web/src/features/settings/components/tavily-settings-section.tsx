"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Field } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { Switch } from "@upstand/ui/components/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, SearchIcon } from "@/components/huge-icons";
import { trpc } from "@/utils/trpc";

type Props = {
  organizationId: string;
};

export function TavilySettingsSection({ organizationId }: Props) {
  const tavilyQuery = useQuery({
    ...trpc.ai.getTavilySettings.queryOptions({ organizationId }),
    enabled: Boolean(organizationId),
  });

  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [searchDepth, setSearchDepth] = useState<"basic" | "advanced">("basic");
  const [includeAnswer, setIncludeAnswer] = useState(false);
  const [maxResults, setMaxResults] = useState(5);
  const [enableSearch, setEnableSearch] = useState(true);
  const [enableExtract, setEnableExtract] = useState(false);
  const [enableCrawl, setEnableCrawl] = useState(false);
  const [enableMap, setEnableMap] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (tavilyQuery.data) {
      setEnabled(tavilyQuery.data.enabled);
      setSearchDepth(tavilyQuery.data.searchDepth);
      setIncludeAnswer(tavilyQuery.data.includeAnswer);
      setMaxResults(tavilyQuery.data.maxResults);
      setEnableSearch(tavilyQuery.data.enableSearch);
      setEnableExtract(tavilyQuery.data.enableExtract);
      setEnableCrawl(tavilyQuery.data.enableCrawl);
      setEnableMap(tavilyQuery.data.enableMap);
      setDirty(false);
    }
  }, [tavilyQuery.data]);

  const saveMutation = useMutation({
    ...trpc.ai.saveTavilySettings.mutationOptions(),
    onSuccess: () => {
      toast.success("Tavily search settings saved successfully");
      setApiKey("");
      setDirty(false);
      void tavilyQuery.refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to save Tavily settings");
    },
  });

  const isConfigured = tavilyQuery.data?.configured ?? false;

  function handleSave() {
    saveMutation.mutate({
      organizationId,
      enabled,
      apiKey: apiKey.trim() || undefined,
      searchDepth,
      includeAnswer,
      maxResults,
      enableSearch,
      enableExtract,
      enableCrawl,
      enableMap,
    });
  }

  function handleMainToggle(checked: boolean) {
    setEnabled(checked);
    setDirty(true);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <SearchIcon className="size-4 text-primary" />
            <CardTitle className="text-sm">Tavily Web Search</CardTitle>
            {enabled ? (
              <Badge variant="default" className="text-[10px]">
                {isConfigured ? "Active" : "Key Required"}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                Disabled
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs">
            Enable AI-powered web search, content extraction, website crawling,
            and site mapping tools for UpGal.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <Switch
            checked={enabled}
            onCheckedChange={handleMainToggle}
            disabled={tavilyQuery.isPending || saveMutation.isPending}
            id="tavily-main-toggle"
          />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {tavilyQuery.isPending ? (
          <div className="flex items-center justify-center py-4 text-muted-foreground text-xs">
            <Spinner data-icon="inline-start" />
            <span className="ml-2">Loading Tavily configuration…</span>
          </div>
        ) : !enabled ? (
          <p className="text-muted-foreground text-xs italic">
            Tavily web search is disabled. UpGal will use standard default web
            search when available.
          </p>
        ) : (
          <div className="flex flex-col gap-5 border-border border-t pt-4">
            {/* API Key Field */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="tavily-api-key"
                className="font-medium text-foreground text-xs"
              >
                Tavily API Key
              </label>
              <div className="relative flex items-center">
                <Input
                  id="tavily-api-key"
                  type={showApiKey ? "text" : "password"}
                  placeholder={
                    isConfigured
                      ? "•••••••••••••••• (API key set)"
                      : "tvly-xxxxxxxxxxxxxxxx"
                  }
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setDirty(true);
                  }}
                  className="pr-10 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 text-muted-foreground hover:text-foreground"
                  title={showApiKey ? "Hide key" : "Show key"}
                >
                  {showApiKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Get your key from{" "}
                <a
                  href="https://tavily.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  tavily.com
                </a>
                . Keys are encrypted server-side and never exposed.
              </p>
            </div>

            {/* Search Configuration Options */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* Search Depth */}
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground text-xs">
                  Search Depth
                </label>
                <Field>
                  <Select
                    items={[
                      { value: "basic", label: "Basic (Fast & Direct)" },
                      { value: "advanced", label: "Advanced (Deep Context)" },
                    ]}
                    value={searchDepth}
                    onValueChange={(val) => {
                      setSearchDepth(val as "basic" | "advanced");
                      setDirty(true);
                    }}
                  >
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue placeholder="Select depth" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">
                        Basic (Fast & Direct)
                      </SelectItem>
                      <SelectItem value="advanced">
                        Advanced (Deep Context)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {/* Max Results */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="tavily-max-results"
                  className="font-medium text-foreground text-xs"
                >
                  Max Results (1–20)
                </label>
                <Input
                  id="tavily-max-results"
                  type="number"
                  min={1}
                  max={20}
                  value={maxResults}
                  onChange={(e) => {
                    const val = Math.min(
                      20,
                      Math.max(1, Number.parseInt(e.target.value, 10) || 5),
                    );
                    setMaxResults(val);
                    setDirty(true);
                  }}
                  className="text-xs"
                />
              </div>

              {/* Include Answer */}
              <div className="flex flex-col justify-center gap-1.5 pt-4 md:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="tavily-include-answer"
                    className="cursor-pointer font-medium text-foreground text-xs"
                  >
                    Include Direct Answer
                  </label>
                  <Switch
                    id="tavily-include-answer"
                    checked={includeAnswer}
                    onCheckedChange={(val) => {
                      setIncludeAnswer(val);
                      setDirty(true);
                    }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Generate concise direct answers alongside search results.
                </p>
              </div>
            </div>

            {/* Sub-Tools Enabling / Disabling */}
            <div className="flex flex-col gap-2.5 border-border border-t pt-4">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground text-xs">
                  Available Tavily Tools
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Choose which Tavily tools are made available to UpGal for
                  agentic tasks:
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {/* tavilySearch */}
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium font-mono text-foreground text-xs">
                      tavilySearch
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Perform real-time contextual web searches.
                    </span>
                  </div>
                  <Switch
                    checked={enableSearch}
                    onCheckedChange={(val) => {
                      setEnableSearch(val);
                      setDirty(true);
                    }}
                  />
                </div>

                {/* tavilyExtract */}
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium font-mono text-foreground text-xs">
                      tavilyExtract
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Extract clean structured content from web page URLs.
                    </span>
                  </div>
                  <Switch
                    checked={enableExtract}
                    onCheckedChange={(val) => {
                      setEnableExtract(val);
                      setDirty(true);
                    }}
                  />
                </div>

                {/* tavilyCrawl */}
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium font-mono text-foreground text-xs">
                      tavilyCrawl
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Crawl multi-page website structures and content.
                    </span>
                  </div>
                  <Switch
                    checked={enableCrawl}
                    onCheckedChange={(val) => {
                      setEnableCrawl(val);
                      setDirty(true);
                    }}
                  />
                </div>

                {/* tavilyMap */}
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium font-mono text-foreground text-xs">
                      tavilyMap
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Discover website page hierarchies and site maps.
                    </span>
                  </div>
                  <Switch
                    checked={enableMap}
                    onCheckedChange={(val) => {
                      setEnableMap(val);
                      setDirty(true);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end border-border border-t pt-3">
              <Button
                onClick={handleSave}
                disabled={
                  saveMutation.isPending ||
                  (!dirty && (isConfigured || !apiKey.trim()))
                }
                size="sm"
              >
                {saveMutation.isPending ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <span>Save Tavily Settings</span>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
