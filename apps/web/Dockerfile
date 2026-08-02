FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS pruner
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=upstand-turbo-cli,target=/root/.bun/install/cache \
    bunx turbo@2.10.7 prune web --docker --out-dir /out

FROM node:24-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS builder
COPY --from=oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=pruner /out/json/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --ignore-scripts --frozen-lockfile
COPY --from=pruner /out/full/ ./

ARG NEXT_PUBLIC_SERVER_URL
ENV NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL}
ARG NEXT_PUBLIC_UPSTAND_VERSION=development
ENV NEXT_PUBLIC_UPSTAND_VERSION=${NEXT_PUBLIC_UPSTAND_VERSION}
ENV NODE_ENV=production
RUN --mount=type=cache,id=upstand-web-next-cache,target=/app/apps/web/.next/cache \
    cd apps/web && node node_modules/next/dist/bin/next build
RUN mkdir -p apps/web/public

FROM node:24-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

ENV HOSTNAME=0.0.0.0
ENV PORT=3001
EXPOSE 3001

USER node

CMD ["node", "apps/web/server.js"]
