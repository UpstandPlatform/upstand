import { env } from "@upstand/env/server";
import { log } from "evlog";
import { UpGalError } from "./upgal-errors";

const SEARCH_TIMEOUT_MS = 15_000;
const MAX_RESULT_TEXT_LENGTH = 600;

export type WebSearchResult = {
  title: string;
  url: string;
  description: string;
  age?: string;
};

export type WebSearchResponse = {
  query: string;
  results: WebSearchResult[];
  searchedAt: string;
};

function searchEndpoint(): URL {
  const configured = env.UPGAL_WEB_SEARCH_BASE_URL;
  const endpoint = new URL(configured);
  if (endpoint.protocol !== "https:") {
    throw new UpGalError(
      "configuration",
      "UPGAL_WEB_SEARCH_BASE_URL must use HTTPS.",
      "web_search",
    );
  }
  return endpoint;
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_RESULT_TEXT_LENGTH);
}

function parseResult(value: unknown): WebSearchResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = cleanText(record.title);
  const description = cleanText(record.description);
  const rawUrl = typeof record.url === "string" ? record.url : "";
  if (!title || !description || !rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return {
      title,
      url: url.toString(),
      description,
      ...(typeof record.age === "string" && record.age.trim()
        ? { age: cleanText(record.age) }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Search the public web through the operator-configured Brave Search API.
 * Search content and result pages are untrusted data and must never be
 * treated as UpGal instructions.
 */
export async function searchWeb(input: {
  query: string;
  limit: number;
}): Promise<WebSearchResponse> {
  const apiKey = env.UPGAL_WEB_SEARCH_API_KEY?.trim();
  if (!apiKey) {
    throw new UpGalError(
      "configuration",
      "Web search is not configured. Set UPGAL_WEB_SEARCH_API_KEY in the server environment.",
      "web_search",
    );
  }

  const endpoint = searchEndpoint();
  endpoint.searchParams.set("q", input.query);
  endpoint.searchParams.set("count", String(input.limit));
  endpoint.searchParams.set("safesearch", "moderate");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      log.warn({
        message: "UpGal web search provider returned an error",
        status: response.status,
      });
      const code =
        response.status === 401
          ? "authentication"
          : response.status === 403
            ? "permission"
            : response.status === 429
              ? "rate_limit"
              : "provider";
      throw new UpGalError(
        code,
        `Web search provider returned HTTP ${response.status}.`,
        "web_search",
      );
    }

    const payload = (await response.json()) as {
      web?: { results?: unknown };
    };
    const rawResults = Array.isArray(payload.web?.results)
      ? payload.web.results
      : [];
    const results = rawResults
      .map(parseResult)
      .filter((result): result is WebSearchResult => result !== null)
      .slice(0, input.limit);

    return {
      query: input.query,
      results,
      searchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new UpGalError(
        "timeout",
        "Web search timed out. Please try again.",
        "web_search",
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
