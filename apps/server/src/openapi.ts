import { createRequire } from "node:module";
import { join } from "node:path";
import { createOpenApiDocument, openApiRouter } from "@upstand/api/openapi";
import { env } from "@upstand/env/server";

const require = createRequire(import.meta.url);
const swaggerUiDirectory =
  require("swagger-ui-dist").getAbsoluteFSPath() as string;
const apiBaseUrl = new URL("/api", env.BETTER_AUTH_URL)
  .toString()
  .replace(/\/$/, "");

export const openApiDocument = createOpenApiDocument(apiBaseUrl);
export { openApiRouter };

export const swaggerUiHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Upstand API</title>
    <link rel="stylesheet" href="/api/docs/assets/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/api/docs/assets/swagger-ui-bundle.js"></script>
    <script src="/api/docs/assets/swagger-ui-standalone-preset.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: "/api/openapi.json",
          dom_id: "#swagger-ui",
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: "StandaloneLayout"
        });
      };
    </script>
  </body>
</html>`;

const swaggerUiAssets: Record<string, [string, string]> = {
  "swagger-ui.css": ["text/css; charset=UTF-8", "public, max-age=3600"],
  "swagger-ui-bundle.js": [
    "application/javascript; charset=UTF-8",
    "public, max-age=3600",
  ],
  "swagger-ui-standalone-preset.js": [
    "application/javascript; charset=UTF-8",
    "public, max-age=3600",
  ],
  "favicon-16x16.png": ["image/png", "public, max-age=86400"],
  "favicon-32x32.png": ["image/png", "public, max-age=86400"],
};

export async function serveSwaggerUiAsset(
  asset: string,
): Promise<Response | undefined> {
  const metadata = swaggerUiAssets[asset];
  if (!metadata) return undefined;

  const file = Bun.file(join(swaggerUiDirectory, asset));
  if (!(await file.exists())) return undefined;

  return new Response(file, {
    headers: {
      "Cache-Control": metadata[1],
      "Content-Type": metadata[0],
    },
  });
}
