FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS pruner
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=upstand-turbo-cli,target=/root/.bun/install/cache \
    bunx turbo@2.10.7 prune schedules --docker --out-dir /out
RUN mkdir -p /out/json/patches && cp /repo/patches/samlify@2.13.1.patch /out/json/patches/

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

ARG UPSTAND_VERSION=development
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Upstand Schedules" \
      org.opencontainers.image.version="$UPSTAND_VERSION" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.source="https://github.com/UpstandPlatform/upstand"

ARG TARGETARCH
ARG UPSTAND_RCLONE_VERSION=1.74.4
ARG RCLONE_SHA256_AMD64=fe435e0c36228e7c2f116a8701f01127bb1f694005fc11d1f27186c8bca4115d
ARG RCLONE_SHA256_ARM64=97685285c9ad6a0cf17d5844115d2a67245af6444db672187074bd9c358de419

RUN apt-get update && apt-get install -y --no-install-recommends \
    docker-cli \
    ca-certificates \
    curl \
    python3 \
    tar \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN case "$TARGETARCH" in \
      amd64) RCLONE_ARCH="amd64"; RCLONE_SHA256="$RCLONE_SHA256_AMD64" ;; \
      arm64) RCLONE_ARCH="arm64"; RCLONE_SHA256="$RCLONE_SHA256_ARM64" ;; \
      *) echo "Unsupported rclone architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      --connect-timeout 20 --max-time 600 --retry 5 --retry-delay 5 --retry-max-time 1800 \
      --retry-all-errors \
      "https://github.com/rclone/rclone/releases/download/v${UPSTAND_RCLONE_VERSION}/rclone-v${UPSTAND_RCLONE_VERSION}-linux-${RCLONE_ARCH}.zip" \
      --output /tmp/rclone.zip \
    && echo "${RCLONE_SHA256}  /tmp/rclone.zip" | sha256sum --check --strict \
    && python3 -c "import zipfile; zipfile.ZipFile('/tmp/rclone.zip').extractall('/tmp/rclone')" \
    && install "/tmp/rclone/rclone-v${UPSTAND_RCLONE_VERSION}-linux-${RCLONE_ARCH}/rclone" /usr/local/bin/rclone \
    && rm -rf /tmp/rclone /tmp/rclone.zip \
    && rclone version

COPY --from=pruner /out/json/ ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --production --ignore-scripts --frozen-lockfile

COPY --from=builder /app/apps/schedules/dist ./apps/schedules/dist
COPY --from=builder /app/packages/db/src/migrations ./packages/db/src/migrations
COPY --from=pruner /out/full/apps/schedules/docker-entrypoint.sh ./apps/schedules/docker-entrypoint.sh
RUN chmod 0755 ./apps/schedules/docker-entrypoint.sh \
    && groupadd --gid 10001 upstand \
    && useradd --uid 10001 --gid upstand --create-home --shell /usr/sbin/nologin upstand \
    && mkdir -p /home/upstand/.docker /tmp/upstand \
    && chown -R upstand:upstand /home/upstand /tmp/upstand

ENV PORT=3002
ENV HOME=/home/upstand
EXPOSE 3002

USER upstand
ENTRYPOINT ["/app/apps/schedules/docker-entrypoint.sh"]
CMD ["bun", "run", "apps/schedules/dist/index.mjs"]
