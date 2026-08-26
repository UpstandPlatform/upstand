FROM golang:1.25.13-alpine@sha256:1e0126852075c9c60731c8ba49088448b91f63e2aed97ca9d1a9791622a05946 AS builder

RUN apk add --no-cache ca-certificates gcc git musl-dev sqlite-dev

WORKDIR /app

COPY go.mod go.sum ./
ARG GOPROXY=https://proxy.golang.org|direct
RUN GOPROXY="$GOPROXY" go mod download

COPY . .

RUN CGO_ENABLED=1 GOOS=linux go build -o main main.go

FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc

ARG UPSTAND_VERSION=development
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Upstand Monitoring" \
      org.opencontainers.image.version="$UPSTAND_VERSION" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.source="https://github.com/UpstandPlatform/upstand"

RUN apk add --no-cache sqlite-libs docker-cli wget && \
    addgroup -S appgroup && adduser -S appuser -G appgroup && \
    mkdir -p /data && chown appuser:appgroup /data

WORKDIR /app

COPY --from=builder /app/main ./main
RUN chown -R appuser:appgroup /app

ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --output-document=- http://127.0.0.1:3001/health >/dev/null || exit 1

USER appuser

CMD ["./main"]
