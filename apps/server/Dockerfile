FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS pruner
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=upstand-turbo-cli,target=/root/.bun/install/cache \
    bunx turbo@2.10.7 prune server --docker --out-dir /out

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS builder
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1

COPY --from=pruner /out/json/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --ignore-scripts --frozen-lockfile
COPY --from=pruner /out/full/ ./

RUN cd apps/server && bun run build

FROM oven/bun:1.3.14-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04 AS runner
WORKDIR /app
ENV NODE_ENV=production

ARG UPSTAND_VERSION=development
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Upstand Server" \
      org.opencontainers.image.version="$UPSTAND_VERSION" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.source="https://github.com/UpstandPlatform/upstand"

ARG TARGETARCH
ARG UPSTAND_RCLONE_VERSION=1.74.4
ARG RCLONE_SHA256_AMD64=fe435e0c36228e7c2f116a8701f01127bb1f694005fc11d1f27186c8bca4115d
ARG RCLONE_SHA256_ARM64=97685285c9ad6a0cf17d5844115d2a67245af6444db672187074bd9c358de419
ARG DOCKER_COMPOSE_VERSION=5.3.1
ARG DOCKER_COMPOSE_SHA256_AMD64=f9ebc6ebdb19d769b793c245a736caaeb198c62587f13b25c660c13b4987f959
ARG DOCKER_COMPOSE_SHA256_ARM64=aa611e811d0ea25897839c404bfb5bf93ce706dc51c500a4457890f5d0606a86

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    docker-cli \
    ca-certificates \
    curl \
    tar \
    python3 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Compose mode invokes the Docker Compose CLI plugin. Keep the plugin pinned
# and verify the release checksum so the server image does not depend on an
# unpinned package mirror or a mutable latest download.
RUN case "$TARGETARCH" in \
      amd64) COMPOSE_ARCH="x86_64"; COMPOSE_SHA256="$DOCKER_COMPOSE_SHA256_AMD64" ;; \
      arm64) COMPOSE_ARCH="aarch64"; COMPOSE_SHA256="$DOCKER_COMPOSE_SHA256_ARM64" ;; \
      *) echo "Unsupported Docker Compose architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && mkdir -p /usr/libexec/docker/cli-plugins \
    && curl --fail --location --retry 3 --retry-all-errors \
      "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${COMPOSE_ARCH}" \
      --output /tmp/docker-compose \
    && echo "${COMPOSE_SHA256}  /tmp/docker-compose" | sha256sum --check --strict \
    && install -m 0755 /tmp/docker-compose /usr/libexec/docker/cli-plugins/docker-compose \
    && rm /tmp/docker-compose \
    && docker compose version

RUN case "$TARGETARCH" in \
      amd64) RCLONE_ARCH="amd64"; RCLONE_SHA256="$RCLONE_SHA256_AMD64" ;; \
      arm64) RCLONE_ARCH="arm64"; RCLONE_SHA256="$RCLONE_SHA256_ARM64" ;; \
      *) echo "Unsupported rclone architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl --fail --location --retry 3 --retry-all-errors \
      "https://downloads.rclone.org/v${UPSTAND_RCLONE_VERSION}/rclone-v${UPSTAND_RCLONE_VERSION}-linux-${RCLONE_ARCH}.zip" \
      --output /tmp/rclone.zip \
    && echo "${RCLONE_SHA256}  /tmp/rclone.zip" | sha256sum --check --strict \
    && python3 -c "import zipfile; zipfile.ZipFile('/tmp/rclone.zip').extractall('/tmp/rclone')" \
    && install "/tmp/rclone/rclone-v${UPSTAND_RCLONE_VERSION}-linux-${RCLONE_ARCH}/rclone" /usr/local/bin/rclone \
    && rm -rf /tmp/rclone /tmp/rclone.zip \
    && rclone version

# The pruned json tree contains only the server dependency closure.
COPY --from=pruner /out/json/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --production --ignore-scripts --frozen-lockfile

COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/packages/db/src/migrations ./packages/db/src/migrations
COPY --from=pruner /out/full/apps/server/docker-entrypoint.sh ./apps/server/docker-entrypoint.sh
RUN chmod 0755 ./apps/server/docker-entrypoint.sh \
    && groupadd --gid 10001 upstand \
    && useradd --uid 10001 --gid upstand --create-home --shell /usr/sbin/nologin upstand \
    && mkdir -p /home/upstand/.docker /tmp/upstand \
    && chown -R upstand:upstand /home/upstand /tmp/upstand

ENV PORT=3000
ENV HOME=/home/upstand
EXPOSE 3000

USER upstand
ENTRYPOINT ["/app/apps/server/docker-entrypoint.sh"]
CMD ["bun", "run", "apps/server/dist/index.mjs"]
