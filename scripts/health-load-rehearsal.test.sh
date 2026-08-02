#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/upstand-health-load-test.XXXXXX")"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

PORT_FILE="$TEMP_DIR/port"
python3 - "$PORT_FILE" <<'PY' &
import http.server
import pathlib
import socketserver
import sys

port_file = pathlib.Path(sys.argv[1])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"ok"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass

with socketserver.TCPServer(("127.0.0.1", 0), Handler) as server:
    port_file.write_text(str(server.server_address[1]), encoding="ascii")
    server.serve_forever()
PY
SERVER_PID=$!

for _ in {1..50}; do
  [[ -s "$PORT_FILE" ]] && break
  sleep 0.1
done
[[ -s "$PORT_FILE" ]] || {
  echo "health-load-rehearsal integration server did not start" >&2
  exit 1
}
PORT="$(cat "$PORT_FILE")"
TARGET="http://127.0.0.1:$PORT"

HEALTH_LOAD_REQUESTS=12 \
HEALTH_LOAD_CONCURRENCY=3 \
HEALTH_LOAD_REQUEST_PATH=/health/ready \
HEALTH_LOAD_MAX_P95_MS=5000 \
HEALTH_LOAD_MAX_P99_MS=5000 \
  bash "$ROOT_DIR/scripts/health-load-rehearsal.sh" "$TARGET"

if HEALTH_LOAD_REQUESTS=1 HEALTH_LOAD_REQUEST_PATH=/ bash \
  "$ROOT_DIR/scripts/health-load-rehearsal.sh" "http://user:pass@127.0.0.1:$PORT"; then
  echo "health-load-rehearsal accepted embedded URL credentials" >&2
  exit 1
fi

set +e
HEALTH_LOAD_REQUESTS=12 \
HEALTH_LOAD_CONCURRENCY=3 \
HEALTH_LOAD_REQUEST_PATH=/health/ready \
HEALTH_LOAD_MAX_P95_MS=1 \
  bash "$ROOT_DIR/scripts/health-load-rehearsal.sh" "$TARGET"
latency_status=$?
set -e
[[ "$latency_status" -eq 1 ]] || {
  echo "health-load-rehearsal did not fail its latency budget" >&2
  exit 1
}

echo "health-load-rehearsal-integration: passed"
