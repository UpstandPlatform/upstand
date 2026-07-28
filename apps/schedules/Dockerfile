FROM buildpacksio/pack:0.39.1@sha256:c54fdac6b8e65c272849bf549aea61122746d59b01e6e06db5da654c7e4f5acb AS buildpacks
FROM docker/buildx-bin:0.16.2@sha256:8ebd56fb294661fd083dd4f130f56232f04413c3b70d88f6276bfe87f0ebb5e2 AS buildx

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS pruner
WORKDIR /repo
COPY . .
RUN bunx turbo@2.10.5 prune schedules --docker --out-dir /out

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS builder
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1

COPY --from=pruner /out/json/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --ignore-scripts --frozen-lockfile
COPY --from=pruner /out/full/ ./

RUN cd apps/schedules && bun run build

FROM oven/bun:1.3.14-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04 AS runner
WORKDIR /app
ENV NODE_ENV=production

ARG TARGETARCH
ARG NIXPACKS_VERSION=1.41.0
ARG UPSTAND_RCLONE_VERSION=1.74.4

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    docker-cli \
    ca-certificates \
    curl \
    tar \
    python3 \
    make \
    g++ \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN case "$TARGETARCH" in \
      amd64) RCLONE_ARCH="amd64" ;; \
      arm64) RCLONE_ARCH="arm64" ;; \
      *) echo "Unsupported rclone architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl --fail --location --retry 3 --retry-all-errors \
      "https://downloads.rclone.org/v${UPSTAND_RCLONE_VERSION}/rclone-v${UPSTAND_RCLONE_VERSION}-linux-${RCLONE_ARCH}.zip" \
      --output /tmp/rclone.zip \
    && python3 -c "import zipfile; zipfile.ZipFile('/tmp/rclone.zip').extractall('/tmp/rclone')" \
    && install "/tmp/rclone/rclone-v${UPSTAND_RCLONE_VERSION}-linux-${RCLONE_ARCH}/rclone" /usr/local/bin/rclone \
    && rm -rf /tmp/rclone /tmp/rclone.zip \
    && rclone version

RUN case "$TARGETARCH" in \
      amd64) NIXPACKS_TARGET="x86_64-unknown-linux-musl" ;; \
      arm64) NIXPACKS_TARGET="aarch64-unknown-linux-musl" ;; \
      *) echo "Unsupported Nixpacks architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl --fail --location --retry 3 --retry-all-errors \
      "https://github.com/railwayapp/nixpacks/releases/download/v${NIXPACKS_VERSION}/nixpacks-v${NIXPACKS_VERSION}-${NIXPACKS_TARGET}.tar.gz" \
      --output /tmp/nixpacks.tar.gz \
    && tar -xzf /tmp/nixpacks.tar.gz -C /usr/local/bin \
    && chmod 0755 /usr/local/bin/nixpacks \
    && rm /tmp/nixpacks.tar.gz

COPY --from=buildpacks /usr/local/bin/pack /usr/local/bin/pack
COPY --from=buildx /buildx /usr/libexec/docker/cli-plugins/docker-buildx
RUN chmod 0755 /usr/libexec/docker/cli-plugins/docker-buildx && docker buildx version

COPY --from=pruner /out/json/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --production --ignore-scripts --frozen-lockfile

COPY --from=builder /app/apps/schedules/dist ./apps/schedules/dist
COPY --from=builder /app/packages/db/src/migrations ./packages/db/src/migrations
COPY --from=pruner /out/full/apps/schedules/docker-entrypoint.sh ./apps/schedules/docker-entrypoint.sh
RUN chmod 0755 ./apps/schedules/docker-entrypoint.sh

ENV PORT=3002
EXPOSE 3002

ENTRYPOINT ["/app/apps/schedules/docker-entrypoint.sh"]
CMD ["bun", "run", "apps/schedules/dist/index.mjs"]
