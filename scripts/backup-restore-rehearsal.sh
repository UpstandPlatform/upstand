#!/usr/bin/env bash
set -euo pipefail

DOCKER_BIN="${DOCKER_BIN:-docker}"
docker() {
  command "$DOCKER_BIN" "$@"
}

run_id="${UPSTAND_BACKUP_REHEARSAL_RUN_ID:-$(date -u +%Y%m%d%H%M%S)-$$}"
prefix="upstand-backup-rehearsal-${run_id}"
network="${prefix}-network"
minio_name="${prefix}-minio"
source_name="${prefix}-pg-source"
restore_name="${prefix}-pg-restore"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/${prefix}.XXXXXX")"
docker_mount_root="$temporary_root"
if [[ "$DOCKER_BIN" == *.exe ]] && command -v wslpath >/dev/null 2>&1; then
  docker_mount_root="$(wslpath -w "$temporary_root")"
fi
bucket="upstand-acceptance"
access_key="acceptance-access"
secret_key="acceptance-secret"
server_image="${UPSTAND_BACKUP_REHEARSAL_IMAGE:-${UPSTAND_SERVER_IMAGE:-}}"
max_total_seconds="${UPSTAND_BACKUP_REHEARSAL_MAX_TOTAL_SECONDS:-0}"
max_restore_seconds="${UPSTAND_BACKUP_REHEARSAL_MAX_RESTORE_SECONDS:-0}"
evidence_file="${UPSTAND_BACKUP_REHEARSAL_EVIDENCE_FILE:-}"
minio_image="minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e"
postgres_image="postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15"
alpine_image="alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"
docker_dump_path="$docker_mount_root/readiness.dump.gz"
docker_download_path="$docker_mount_root/downloaded.dump.gz"

fail() {
  echo "backup-restore-rehearsal: $*" >&2
  exit 1
}

validate_budget() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^[0-9]+$ && "$value" -le 604800 ]] \
    || fail "$name must be an integer number of seconds between 0 and 604800"
}

assert_budget() {
  local name="$1"
  local elapsed="$2"
  local maximum="$3"
  if [[ "$maximum" -gt 0 && "$elapsed" -gt "$maximum" ]]; then
    fail "$name exceeded its budget: elapsed=${elapsed}s budget=${maximum}s"
  fi
}

write_evidence() {
  [[ -n "$evidence_file" ]] || return 0
  local parent
  parent="$(dirname -- "$evidence_file")"
  [[ -d "$parent" ]] || fail "DR rehearsal evidence directory does not exist: $parent"
  umask 077
  printf '%s\n' \
    '{' \
    '  "schema": "upstand.backup-restore-rehearsal.v1",' \
    "  \"run_id\": \"$run_id\"," \
    "  \"completed_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," \
    "  \"image\": \"$server_image\"," \
    "  \"minio_image\": \"$minio_image\"," \
    "  \"postgres_image\": \"$postgres_image\"," \
    '  "scope": "synthetic-disposable",' \
    '  "result": "passed",' \
    '  "data_assertion": true,' \
    "  \"readiness_seconds\": $readiness_seconds," \
    "  \"transfer_seconds\": $transfer_seconds," \
    "  \"restore_seconds\": $restore_seconds," \
    "  \"total_seconds\": $total_seconds," \
    "  \"max_restore_seconds\": $max_restore_seconds," \
    "  \"max_total_seconds\": $max_total_seconds" \
    '}' > "$evidence_file"
}

names=("$minio_name" "$source_name" "$restore_name")
cleanup() {
  for name in "${names[@]}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$temporary_root"
}
trap cleanup EXIT

[[ -n "$server_image" ]] || fail "set UPSTAND_BACKUP_REHEARSAL_IMAGE or UPSTAND_SERVER_IMAGE to the server image under test"
[[ "$server_image" =~ @sha256:[0-9a-fA-F]{64}$ ]] \
  || fail "backup rehearsal image must use an immutable digest: $server_image"
validate_budget UPSTAND_BACKUP_REHEARSAL_MAX_TOTAL_SECONDS "$max_total_seconds"
validate_budget UPSTAND_BACKUP_REHEARSAL_MAX_RESTORE_SECONDS "$max_restore_seconds"
rclone_user="$(id -u):$(id -g)"

for name in "${names[@]}"; do
  existing="$(docker ps -aq --filter "name=^${name}$")"
  [[ -z "$existing" ]] || fail "refusing to use an existing container named '$name'"
done
existing_network="$(docker network ls -q --filter "name=^${network}$")"
[[ -z "$existing_network" ]] || fail "refusing to use an existing network named '$network'"

SECONDS=0
docker network create "$network" >/dev/null
docker run -d --rm --name "$minio_name" --network "$network" \
  --tmpfs /data \
  --env "MINIO_ROOT_USER=$access_key" \
  --env "MINIO_ROOT_PASSWORD=$secret_key" \
  "$minio_image" server /data --console-address :9001 >/dev/null
docker run -d --rm --name "$source_name" --network "$network" \
  --env POSTGRES_PASSWORD=acceptance-password \
  --env POSTGRES_DB=acceptance \
  --env PGDATA=/var/lib/postgresql/data/pgdata \
  --tmpfs /var/lib/postgresql/data \
  "$postgres_image" >/dev/null
docker run -d --rm --name "$restore_name" --network "$network" \
  --env POSTGRES_PASSWORD=acceptance-password \
  --env POSTGRES_DB=acceptance \
  --env PGDATA=/var/lib/postgresql/data/pgdata \
  --tmpfs /var/lib/postgresql/data \
  "$postgres_image" >/dev/null

ready=false
readiness_start_seconds="$SECONDS"
for _ in {1..60}; do
  if docker exec "$source_name" pg_isready -U postgres -d acceptance >/dev/null 2>&1 \
    && docker exec "$restore_name" pg_isready -U postgres -d acceptance >/dev/null 2>&1 \
    && docker run --rm --network "$network" --cap-drop ALL --user 10001:10001 --entrypoint /bin/sh "$alpine_image" \
      -c 'wget -qO- "http://$1:9000/minio/health/live" >/dev/null' sh "$minio_name"; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || fail "disposable backup rehearsal services did not become ready"
readiness_seconds=$((SECONDS - readiness_start_seconds))

docker exec "$source_name" psql -U postgres -d acceptance -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE readiness_probe (id integer primary key, marker text not null); INSERT INTO readiness_probe VALUES (1, 'backup-restore-ok');" >/dev/null
docker exec "$source_name" sh -ec \
  "pg_dump -U postgres -d acceptance -Fc --no-owner --no-acl | gzip > /tmp/readiness.dump.gz"
docker cp "$source_name:/tmp/readiness.dump.gz" "$docker_dump_path"

transfer_start_seconds="$SECONDS"
rclone_environment=(
  --env RCLONE_CONFIG=/dev/null
  --env RCLONE_CONFIG_UPSTAND_TYPE=s3
  --env RCLONE_CONFIG_UPSTAND_PROVIDER=Minio
  --env "RCLONE_CONFIG_UPSTAND_ACCESS_KEY_ID=$access_key"
  --env "RCLONE_CONFIG_UPSTAND_SECRET_ACCESS_KEY=$secret_key"
  --env "RCLONE_CONFIG_UPSTAND_ENDPOINT=http://$minio_name:9000"
  --env RCLONE_CONFIG_UPSTAND_NO_CHECK_BUCKET=true
  --env RCLONE_CONFIG_UPSTAND_FORCE_PATH_STYLE=true
)
rclone() {
  docker run --rm --network "$network" --user "$rclone_user" -v "$docker_mount_root:/work" \
    "${rclone_environment[@]}" --entrypoint rclone "$server_image" "$@"
}

rclone mkdir --s3-no-check-bucket=false "upstand:$bucket"
rclone copyto /work/readiness.dump.gz "upstand:$bucket/readiness.dump.gz"
rclone copyto "upstand:$bucket/readiness.dump.gz" /work/downloaded.dump.gz
transfer_seconds=$((SECONDS - transfer_start_seconds))
docker cp "$docker_download_path" "$restore_name:/tmp/readiness.dump.gz"

restore_start_seconds="$SECONDS"
docker exec "$restore_name" sh -ec \
  "gzip -dc /tmp/readiness.dump.gz | pg_restore -U postgres -d acceptance --clean --if-exists --no-owner"
restore_seconds=$((SECONDS - restore_start_seconds))
assert_budget restore "$restore_seconds" "$max_restore_seconds"

marker="$(docker exec "$restore_name" psql -U postgres -d acceptance -At -c \
  "SELECT marker FROM readiness_probe WHERE id = 1")"
[[ "$marker" == "backup-restore-ok" ]] || fail "restored marker mismatch"

total_seconds="$SECONDS"
assert_budget total "$total_seconds" "$max_total_seconds"
write_evidence
echo "backup-restore-rehearsal: metrics readiness_seconds=$readiness_seconds transfer_seconds=$transfer_seconds restore_seconds=$restore_seconds total_seconds=$total_seconds max_restore_seconds=$max_restore_seconds max_total_seconds=$max_total_seconds"
echo "backup-restore-rehearsal: passed (MinIO upload/download, PostgreSQL restore, data assertion)"
