FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS pruner
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=upstand-turbo-cli,target=/root/.bun/install/cache \
    bunx turbo@2.10.7 prune fumadocs --docker --out-dir /out
RUN mkdir -p /out/json/patches && cp /repo/patches/samlify@2.13.1.patch /out/json/patches/

FROM node:24-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS builder
COPY --from=oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=pruner /out/json/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --ignore-scripts --frozen-lockfile
COPY --from=pruner /out/full/ ./

ENV NODE_ENV=production
RUN cd apps/fumadocs && bun run generate
RUN --mount=type=cache,id=upstand-fumadocs-next-cache,target=/app/apps/fumadocs/.next/cache \
    cd apps/fumadocs && node node_modules/next/dist/bin/next build
RUN mkdir -p apps/fumadocs/public

FROM node:24-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1

ARG UPSTAND_VERSION=development
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Upstand Documentation" \
      org.opencontainers.image.version="$UPSTAND_VERSION" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.source="https://github.com/UpstandPlatform/upstand"

COPY --from=builder /app/apps/fumadocs/.next/standalone ./
COPY --from=builder /app/apps/fumadocs/.next/static ./apps/fumadocs/.next/static
COPY --from=builder /app/apps/fumadocs/public ./apps/fumadocs/public

ENV HOSTNAME=0.0.0.0
ENV PORT=4000
EXPOSE 4000

USER node

CMD ["node", "apps/fumadocs/server.js"]
