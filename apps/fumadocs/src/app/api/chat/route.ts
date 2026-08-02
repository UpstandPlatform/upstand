import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env } from "@upstand/env/server";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  toUIMessageStream,
} from "ai";
import { createEvlogIntegration } from "evlog/ai";
import { Document, type DocumentData } from "flexsearch";
import { z } from "zod";
import { useLogger, withEvlog } from "@/lib/evlog";
import { source } from "@/lib/source";
import type { ChatUIMessage, SearchTool } from "../../../components/ai/search";
import {
  CHAT_RATE_LIMIT_MAX_REQUESTS,
  type ChatRateLimitResult,
  enforceChatRateLimit,
} from "./rate-limit";
import {
  MAX_CHAT_REQUEST_BYTES,
  parseChatRequest,
  readBoundedRequestBody,
} from "./request";

interface CustomDocument extends DocumentData {
  url: string;
  title: string;
  description: string;
  content: string;
}
const searchServer = createSearchServer();

async function createSearchServer() {
  const search = new Document<CustomDocument>({
    document: {
      id: "url",
      index: ["title", "description", "content"],
      store: true,
    },
  });

  const docs = await chunkedAll(
    source.getPages().map(async (page) => {
      if (!("getText" in page.data)) return null;

      return {
        title: page.data.title,
        description: page.data.description,
        url: page.url,
        content: await page.data.getText("processed"),
      } as CustomDocument;
    }),
  );

  for (const doc of docs) {
    if (doc) search.add(doc);
  }

  return search;
}

async function chunkedAll<O>(promises: Promise<O>[]): Promise<O[]> {
  const SIZE = 50;
  const out: O[] = [];
  for (let i = 0; i < promises.length; i += SIZE) {
    out.push(...(await Promise.all(promises.slice(i, i + SIZE))));
  }
  return out;
}

const openrouter = createOpenRouter({
  apiKey: env.OPENROUTER_API_KEY,
});

/** System prompt, you can update it to provide more specific information */
const systemPrompt = [
  "You are an AI assistant for a documentation site.",
  "Use the `search` tool to retrieve relevant docs context before answering when needed.",
  "The `search` tool returns raw JSON results from documentation. Use those results to ground your answer and cite sources as markdown links using the document `url` field when available.",
  "If you cannot find the answer in search results, say you do not know and suggest a better search query.",
].join("\n");

export const POST = withEvlog(
  async (req: Request, _ctx: RouteContext<"/api/chat">) => {
    const requestLog = useLogger();
    let rateLimit: ChatRateLimitResult;
    try {
      rateLimit = await enforceChatRateLimit(req);
    } catch {
      requestLog.error("Documentation chat rate limiter unavailable", {
        message: "Failing closed to prevent unbounded AI spend",
      });
      return new Response("Chat is temporarily unavailable", { status: 503 });
    }
    const rateLimitHeaders = {
      "X-RateLimit-Limit": String(CHAT_RATE_LIMIT_MAX_REQUESTS),
      "X-RateLimit-Remaining": String(rateLimit.remaining),
      "X-RateLimit-Reset": String(
        Math.floor(Date.now() / 1000) + rateLimit.resetAfterSeconds,
      ),
    };
    if (!rateLimit.allowed) {
      return new Response("Chat rate limit exceeded", {
        status: 429,
        headers: {
          ...rateLimitHeaders,
          "Retry-After": String(rateLimit.resetAfterSeconds),
        },
      });
    }
    const requestBody = await readBoundedRequestBody(
      req,
      MAX_CHAT_REQUEST_BYTES,
    );
    if (requestBody.tooLarge) {
      return new Response("Chat request is too large", {
        status: 413,
        headers: rateLimitHeaders,
      });
    }

    const parsedRequest = parseChatRequest(requestBody.body);
    if ("error" in parsedRequest) {
      return new Response("Invalid chat request", {
        status: 400,
        headers: rateLimitHeaders,
      });
    }

    const result = streamText({
      model: openrouter.chat(
        env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet",
      ),
      stopWhen: stepCountIs(5),
      tools: {
        search: searchTool,
      },
      messages: [
        { role: "system", content: systemPrompt },
        ...(await convertToModelMessages<ChatUIMessage>(
          parsedRequest.messages as ChatUIMessage[],
          {
            convertDataPart(part) {
              if (part.type === "data-client")
                return {
                  type: "text",
                  text: `[Client Context: ${JSON.stringify(part.data)}]`,
                };
            },
          },
        )),
      ],
      toolChoice: "auto",
      telemetry: {
        integrations: [createEvlogIntegration(requestLog)],
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  },
);

const searchTool = tool({
  description: "Search the docs content and return raw JSON results.",
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().int().min(1).max(100).default(10),
  }),
  async execute({ query, limit }) {
    const search = await searchServer;
    return await search.searchAsync(query, {
      limit,
      merge: true,
      enrich: true,
    });
  },
}) satisfies SearchTool;
