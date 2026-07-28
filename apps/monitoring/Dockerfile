FROM golang:1.22-alpine@sha256:1699c10032ca2582ec89a24a1312d986a3f094aed3d5c1147b19880afe40e052 AS builder

RUN apk add --no-cache ca-certificates gcc git musl-dev sqlite-dev

WORKDIR /app

COPY go.mod go.sum ./
ARG GOPROXY=https://proxy.golang.org|direct
RUN GOPROXY="$GOPROXY" go mod download

COPY . .

RUN CGO_ENABLED=1 GOOS=linux go build -o main main.go

FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc

RUN apk add --no-cache sqlite-libs docker-cli

WORKDIR /app

COPY --from=builder /app/main ./main

ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --output-document=- http://127.0.0.1:3001/health >/dev/null || exit 1

CMD ["./main"]
