import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@upstand/api/context";
import { appRouter } from "@upstand/api/router";
import type { Hono } from "hono";
import { createOpenApiFetchHandler } from "trpc-to-openapi";
import {
  openApiDocument,
  openApiRouter,
  serveSwaggerUiAsset,
  swaggerUiHtml,
} from "../../openapi";
import type { AppEnv } from "../types";

/** Mounts tRPC and the generated REST compatibility transport. */
export function registerApiTransports(app: Hono<AppEnv>): void {
  app.get("/api/openapi.json", (c) => c.json(openApiDocument));
  app.get("/api/docs", (c) => c.redirect("/api/docs/", 308));
  app.get("/api/docs/", (c) => c.html(swaggerUiHtml));
  app.get("/api/docs/assets/:asset", async (c) => {
    const asset = c.req.param("asset");
    return (await serveSwaggerUiAsset(asset)) ?? c.notFound();
  });

  // Dedicated Hono routes are registered before this compatibility fallback.
  app.all("/api/*", async (c) => {
    const openApiUrl = new URL(c.req.url);
    openApiUrl.hostname = "openapi.invalid";
    openApiUrl.port = "";
    return createOpenApiFetchHandler({
      endpoint: "/api",
      req: new Request(openApiUrl.toString(), c.req.raw),
      router: openApiRouter,
      createContext: () => createContext({ context: c }),
    });
  });

  app.use(
    "/trpc/*",
    trpcServer({
      router: appRouter,
      createContext: (_opts, context) => createContext({ context }),
    }),
  );
}
