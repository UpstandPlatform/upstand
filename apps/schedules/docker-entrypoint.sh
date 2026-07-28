#!/bin/sh
set -eu

read_secret() {
  file="$1"
  [ -r "$file" ] || { echo "missing Docker secret: $file" >&2; exit 1; }
  tr -d '\r\n' < "$file"
}

url_encode() {
  UPSTAND_SECRET_VALUE="$1" bun -e \
    'process.stdout.write(encodeURIComponent(process.env.UPSTAND_SECRET_VALUE ?? ""))'
}

export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(read_secret "${POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}")}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-$(read_secret "${REDIS_PASSWORD_FILE:-/run/secrets/redis_password}")}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(read_secret "${BETTER_AUTH_SECRET_FILE:-/run/secrets/better_auth_secret}")}"
export ENCRYPTION_KEY_V1="${ENCRYPTION_KEY_V1:-${SSH_KEY_ENCRYPTION_KEY_V1:-$(read_secret "${ENCRYPTION_KEY_V1_FILE:-${SSH_KEY_ENCRYPTION_KEY_V1_FILE:-/run/secrets/encryption_key}}")}}"
export SSH_KEY_ENCRYPTION_KEY_V1="$ENCRYPTION_KEY_V1"

wait_for_tcp() {
  host="$1"
  port="$2"
  attempts=60
  attempt=1

  while ! python3 - "$host" "$port" <<'PY'
import socket
import sys

try:
    with socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=1):
        pass
except OSError:
    raise SystemExit(1)
PY
  do
    if [ "$attempt" -ge "$attempts" ]; then
      echo "timed out waiting for $host:$port" >&2
      exit 1
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
}

wait_for_http_ready() {
  url="$1"
  attempts=120
  attempt=1

  while ! curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1
  do
    if [ "$attempt" -ge "$attempts" ]; then
      echo "timed out waiting for HTTP readiness: $url" >&2
      exit 1
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
}

if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="postgresql://${DATABASE_USER:-upstand}:$(url_encode "$POSTGRES_PASSWORD")@${DATABASE_HOST:-localhost}:5432/${DATABASE_NAME:-upstand}"
fi
if [ -z "${REDIS_URL:-}" ]; then
  export REDIS_URL="redis://:$(url_encode "$REDIS_PASSWORD")@${REDIS_HOST:-localhost}:6379"
fi

wait_for_tcp "${DATABASE_HOST:-localhost}" 5432
wait_for_tcp "${REDIS_HOST:-localhost}" 6379

# The server owns the migration lifecycle. In Swarm there is no dependable
# depends_on ordering, so do not start workers until the migration-backed
# readiness endpoint is healthy. This prevents schedulers from querying a
# partially upgraded database during rolling installs.
if [ -n "${UPSTAND_SERVER_INTERNAL_URL:-}" ]; then
  wait_for_http_ready "${UPSTAND_SERVER_INTERNAL_URL%/}/health/ready"
fi

exec "$@"
