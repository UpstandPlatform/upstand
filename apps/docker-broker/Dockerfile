FROM golang:1.25.13-alpine@sha256:1e0126852075c9c60731c8ba49088448b91f63e2aed97ca9d1a9791622a05946 AS builder

WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /docker-broker .

FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc

ARG UPSTAND_VERSION=development
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Upstand Docker Broker" \
      org.opencontainers.image.version="$UPSTAND_VERSION" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.source="https://github.com/UpstandPlatform/upstand"

RUN addgroup -S upstand && adduser -S -G upstand upstand
COPY --from=builder /docker-broker /usr/local/bin/docker-broker
RUN chmod 0555 /usr/local/bin/docker-broker

USER upstand
EXPOSE 2375
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD wget --quiet --spider http://127.0.0.1:2376/health || exit 1
ENTRYPOINT ["/usr/local/bin/docker-broker"]
