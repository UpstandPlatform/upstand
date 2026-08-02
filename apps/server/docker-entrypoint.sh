#!/bin/sh
set -eu

read_secret() {
  file="$1"
  [ -r "$file" ] || { echo "missing Docker secret: $file" >&2; exit 1; }
  tr -d '\r\n' < "$file"
}

read_optional_secret() {
  file="$1"
  [ -r "$file" ] || return 0
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

if [ -z "${DATABASE_URL:-}" ] && [ -n "${DATABASE_URL_FILE:-}" ]; then
  export DATABASE_URL="$(read_optional_secret "$DATABASE_URL_FILE")"
fi
if [ -z "${REDIS_URL:-}" ] && [ -n "${REDIS_URL_FILE:-}" ]; then
  export REDIS_URL="$(read_optional_secret "$REDIS_URL_FILE")"
fi

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

if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="postgresql://${DATABASE_USER:-upstand}:$(url_encode "$POSTGRES_PASSWORD")@${DATABASE_HOST:-localhost}:5432/${DATABASE_NAME:-upstand}"
fi
if [ -z "${REDIS_URL:-}" ]; then
  export REDIS_URL="redis://:$(url_encode "$REDIS_PASSWORD")@${REDIS_HOST:-localhost}:${REDIS_PORT:-6379}"
fi

parse_connection_target() {
  python3 - "$1" "$2" <<'PY'
from urllib.parse import urlparse
import sys

parsed = urlparse(sys.argv[1])
if not parsed.hostname:
    raise SystemExit("connection URL has no hostname")
try:
    port = parsed.port or int(sys.argv[2])
except ValueError as error:
    raise SystemExit("connection URL has an invalid port") from error
print(f"{parsed.hostname}|{port}")
PY
}

database_target="$(parse_connection_target "${DATABASE_URL}" "${DATABASE_PORT:-5432}")"
database_wait_host="${database_target%%|*}"
database_wait_port="${database_target#*|}"
redis_target="$(parse_connection_target "${REDIS_URL}" "${REDIS_PORT:-6379}")"
redis_wait_host="${redis_target%%|*}"
redis_wait_port="${redis_target#*|}"

wait_for_tcp "$database_wait_host" "$database_wait_port"
wait_for_tcp "$redis_wait_host" "$redis_wait_port"

exec "$@"
