#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT_DIR/.github/workflows/release.yml"
RECOVERY_WORKFLOW="$ROOT_DIR/.github/workflows/release-recovery-rehearsal.yml"
COMPOSE="$ROOT_DIR/docker-compose.prod.yml"
WEB_DOCKERFILE="$ROOT_DIR/apps/web/Dockerfile"
FUMADOCS_DOCKERFILE="$ROOT_DIR/apps/fumadocs/Dockerfile"
SCHEDULES_ENTRYPOINT="$ROOT_DIR/apps/schedules/docker-entrypoint.sh"

require_workflow_text() {
  local text="$1"
  grep -Fq -- "$text" "$WORKFLOW" || {
    echo "release acceptance workflow is missing required contract: $text" >&2
    exit 1
  }
}

require_compose_text() {
  local text="$1"
  grep -Fq -- "$text" "$COMPOSE" || {
    echo "production Compose is missing required contract: $text" >&2
    exit 1
  }
}

require_file_text() {
  local file="$1"
  local text="$2"
  grep -Fq -- "$text" "$file" || {
    echo "production release artifact is missing required contract: $text" >&2
    exit 1
  }
}

require_compose_text "test: [\"CMD\", \"bun\", \"-e\", \"fetch('http://127.0.0.1:3000/health/live')"
require_compose_text "test: [\"CMD\", \"bun\", \"-e\", \"fetch('http://127.0.0.1:3002/health/ready')"
require_compose_text "test: [\"CMD\", \"node\", \"-e\", \"fetch('http://127.0.0.1:3001/')"
require_compose_text "test: [\"CMD\", \"node\", \"-e\", \"fetch('http://127.0.0.1:4000/')"
require_compose_text "type: tmpfs"
require_compose_text "target: /tmp"
require_compose_text "target: /app/.builds"
require_compose_text "target: /home/upstand/.docker"
require_compose_text "UPSTAND_ACCEPTANCE_ALLOW_UNENCRYPTED_NETWORK: \${UPSTAND_ACCEPTANCE_ALLOW_UNENCRYPTED_NETWORK:-false}"
require_compose_text "UPGAL_TOOL_APPROVAL_SECRET_FILE: /run/secrets/upgal_tool_approval_secret"
require_compose_text "- upgal_tool_approval_secret"
require_compose_text "UPSTAND_DR_READINESS_GATE: \${UPSTAND_DR_READINESS_GATE:-true}"
if grep -Eq '^    tmpfs:' "$COMPOSE"; then
  echo "production Compose must use explicit type: tmpfs mounts for Swarm deployments" >&2
  exit 1
fi
require_file_text "$WEB_DOCKERFILE" "FROM node:24-slim@"
require_file_text "$WEB_DOCKERFILE" 'CMD ["node", "apps/web/server.js"]'
require_file_text "$FUMADOCS_DOCKERFILE" "FROM node:24-slim@"
require_file_text "$FUMADOCS_DOCKERFILE" 'CMD ["node", "apps/fumadocs/server.js"]'
require_file_text "$SCHEDULES_ENTRYPOINT" '${UPSTAND_SERVER_INTERNAL_URL%/}/health/live'
require_file_text "$ROOT_DIR/apps/monitoring/Dockerfile" "mkdir -p /data && chown appuser:appgroup /data"
if grep -Fq -- '${UPSTAND_SERVER_INTERNAL_URL%/}/health/ready' "$SCHEDULES_ENTRYPOINT"; then
  echo "schedules entrypoint must not wait for server readiness (circular dependency)" >&2
  exit 1
fi

require_workflow_text "bundled_accepted=false"
require_workflow_text "runs-on: ubuntu-24.04"
require_workflow_text "Bundled single-node production acceptance did not converge"
require_workflow_text "capture_bundled_readiness_diagnostics"
require_workflow_text 'service-logs-${service}.txt'
require_workflow_text 'container-state-${service}.txt'
require_workflow_text 'health-ready-${service}.txt'
require_workflow_text 'curl --silent --show-error --max-time 5'
require_workflow_text '--node-local'
node_local_count="$(grep -Fc -- '--node-local' "$WORKFLOW")"
[[ "$node_local_count" -ge 2 ]] || {
  echo "release acceptance workflow must exercise node-local acceptance in both phases" >&2
  exit 1
}
require_workflow_text "production rootfs is writable"
require_workflow_text "/app/.builds:rw,nosuid,nodev,size=128m,uid=10001,gid=0,mode=0700"
require_workflow_text "/home/upstand/.docker:rw,nosuid,nodev,noexec,size=16m,uid=10001,gid=0,mode=0700"
require_workflow_text 'UPSTAND_BACKUP_REHEARSAL_IMAGE="$UPSTAND_SERVER_IMAGE"'
require_workflow_text 'UPSTAND_BACKUP_REHEARSAL_MAX_TOTAL_SECONDS=900'
require_workflow_text 'UPSTAND_BACKUP_REHEARSAL_MAX_RESTORE_SECONDS=300'
require_workflow_text 'BACKUP_REHEARSAL_LOG: ${{ runner.temp }}/upstand-backup-rehearsal.txt'
require_workflow_text 'BACKUP_REHEARSAL_EVIDENCE: ${{ runner.temp }}/upstand-acceptance-evidence/backup-restore-rehearsal.json'
require_workflow_text 'production-recovery-evidence'
require_workflow_text 'ACCEPTANCE_EVIDENCE_DIR: ${{ runner.temp }}/upstand-acceptance-evidence'
require_workflow_text 'production-evidence-collect.sh'
require_workflow_text 'production_evidence_collect_sha256'
require_workflow_text 'productionEvidenceCollectSha256'
require_workflow_text 'verify_installation_recovery_evidence_sha256'
require_workflow_text 'verifyInstallationRecoveryEvidenceSha256'
require_workflow_text 'production-acceptance-evidence'
require_workflow_text 'collect_acceptance_evidence'
require_workflow_text 'node-local-bundled.txt'
require_workflow_text 'node-local-external-ha.txt'
require_workflow_text 'dependency-failure.txt'
require_workflow_text 'docker service update --replicas 0 "${STACK_NAME}_external_redis"'
require_workflow_text 'docker service update --replicas 0 "${STACK_NAME}_external_postgres"'
require_workflow_text 'probe_server_readiness 503 redis-unavailable'
require_workflow_text 'probe_server_readiness 503 postgres-unavailable'
require_workflow_text 'restore_dependency_service'
require_workflow_text 'started_at=%s'
require_workflow_text "bash scripts/backup-restore-rehearsal.sh"
require_workflow_text "bash scripts/backup-restore-rehearsal-contract.test.sh"
require_workflow_text "bash scripts/secret-key-recovery-rehearsal.sh"
require_workflow_text "secret-key-recovery.json"
require_workflow_text "bash scripts/verify-recovery-evidence.sh"
require_workflow_text "verify-recovery-evidence-contract.test.sh"
require_workflow_text "ENCRYPTED_NETWORK_NAME: upstand-release-acceptance-encrypted-network"
require_workflow_text "OTEL_COLLECTOR_SERVICE: upstand-release-acceptance-otel-collector"
require_workflow_text "OTEL_COLLECTOR_CONFIG: upstand-release-acceptance-otel-config"
require_workflow_text "otel/opentelemetry-collector-contrib:0.128.0@sha256:1ab0baba0ee3695d823c46653d8a6e8894896e668ce8bd7ebe002e948d827bc7"
require_workflow_text 'docker config create "$OTEL_COLLECTOR_CONFIG" scripts/otel-collector-acceptance.yaml'
require_workflow_text 'export OTLP_ENDPOINT="http://${OTEL_COLLECTOR_SERVICE}:4318"'
require_workflow_text "upstand acceptance OTLP probe"
require_workflow_text "OTLP collector did not record the acceptance probe"
require_workflow_text "Production encrypted-network configuration is enforced by installer/contract tests"
require_workflow_text "hosted Swarm runtime probe is skipped"
require_workflow_text "UPSTAND_ACCEPTANCE_REQUIRE_ENCRYPTED_NETWORK=false"
require_workflow_text "UPSTAND_ACCEPTANCE_ALLOW_UNENCRYPTED_NETWORK=true"
require_workflow_text 'docker pull "$UPSTAND_MONITORING_IMAGE"'
require_workflow_text 'docker pull "$UPSTAND_DOCKER_BROKER_IMAGE"'
require_workflow_text 'docker pull "$UPSTAND_DEPLOYMENT_WORKER_IMAGE"'
require_workflow_text '--user 70:70'
require_workflow_text '--user 999:1000'
require_workflow_text 'logs="$(docker service logs --raw "$OTEL_COLLECTOR_SERVICE" 2>&1 || true)"'
require_workflow_text '--tmpfs /home/upstand:rw,nosuid,nodev,size=16m,uid=10001,gid=0,mode=0700'
require_workflow_text 'BUN_RUNTIME_TRANSPILER_CACHE_PATH=0'
require_workflow_text 'HOME=/tmp'
require_workflow_text 'docker node update'
require_workflow_text '--label-add upstand.control-plane=true'
require_workflow_text 'docker service ps "${STACK_NAME}_${service}" --no-trunc'
require_workflow_text 'release_version="${RELEASE_REF##*/}"'
require_workflow_text 'ACCEPTANCE_PROFILE: ${{ github.event_name == '\''push'\'' && '\''full'\'' || inputs.acceptance_profile || '\''full'\'' }}'
require_workflow_text 'default: full'
require_workflow_text 'full is required for tag pushes; smoke is for manual diagnostics'
require_workflow_text "inputs.publish_release && inputs.acceptance_profile == 'full'"
require_workflow_text 'Release acceptance profile: smoke (backup/recovery/load rehearsals run only in the full profile)'
require_workflow_text 'if [[ "$ACCEPTANCE_PROFILE" == "full" ]]; then'
require_workflow_text 'Unsupported release acceptance profile: $ACCEPTANCE_PROFILE'
require_workflow_text "ATTESTATION_SOURCE_REF: \${{ inputs.attestation_source_ref || github.ref }}"
require_workflow_text 'if [[ "$source_ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then'
require_workflow_text 'source_ref="refs/tags/${source_ref}"'
require_file_text "$RECOVERY_WORKFLOW" "build_images: false"
require_workflow_text "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=' > \"\$UPSTAND_SECRETS_DIR/encryption_key\""
require_workflow_text "docker_broker_server_token"
require_workflow_text "docker_broker_schedules_token"
require_workflow_text "docker_broker_deployment_worker_token"
require_workflow_text "docker_broker_scope_secret"
require_workflow_text "upgal_tool_approval_secret"
require_workflow_text "metrics_token"
require_workflow_text "matrix.name == 'web' && format('NEXT_PUBLIC_UPSTAND_VERSION={0}', steps.meta.outputs.tag)"
require_workflow_text "startsWith(inputs.release_ref || github.ref_name, 'refs/tags/v')"
require_workflow_text "platforms: linux/amd64,linux/arm64"
require_workflow_text 'docker_compose_sha256="$(sha256sum docker-compose.prod.yml'
require_workflow_text 'production_acceptance_sha256="$(sha256sum scripts/production-acceptance.sh'
require_workflow_text 'production_acceptance_cluster_sha256="$(sha256sum scripts/production-acceptance-cluster.sh'
require_workflow_text 'production-acceptance-cluster.sh'
require_workflow_text "dockerComposeProdSha256"
require_workflow_text "productionAcceptanceSha256"
require_workflow_text "productionAcceptanceClusterSha256"
require_workflow_text "id-token: write"
require_workflow_text "attestations: write"
require_workflow_text "artifact-metadata: write"
require_workflow_text "attestations: read"
require_workflow_text "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6"
require_workflow_text "Generate signed image provenance attestation"
require_workflow_text "Verify signed image provenance attestations"
require_workflow_text "gh attestation verify"
require_workflow_text 'GH_TOKEN: ${{ github.token }}'
require_workflow_text '--signer-workflow'
require_workflow_text '--source-ref'

if grep -Fq -- 'NEXT_PUBLIC_UPSTAND_VERSION=${{ steps.meta.outputs.tag }}' "$WORKFLOW"; then
  echo "release workflow must not reference step outputs from the build matrix" >&2
  exit 1
fi

if grep -Fq -- '--allow-unobserved' "$WORKFLOW"; then
  echo "release acceptance must exercise the disposable OTLP collector instead of waiving observability" >&2
  exit 1
fi

for release_ref in v1.2.3 refs/tags/v1.2.3; do
  release_version="${release_ref##*/}"
  [[ "$release_version" == v1.2.3 ]] || {
    echo "release ref normalization failed for $release_ref" >&2
    exit 1
  }
done
require_workflow_text "UPSTAND_BUNDLED_POSTGRES_REPLICAS=0"
require_workflow_text "UPSTAND_BUNDLED_REDIS_REPLICAS=0"
require_workflow_text "--require-ha"
require_workflow_text '"${STACK_NAME}_external_postgres"'
require_workflow_text '"${STACK_NAME}_external_redis"'
require_workflow_text "--external-postgres-service"
require_workflow_text "--external-redis-service"
require_workflow_text "not claim PostgreSQL or Redis HA/failover evidence"
require_workflow_text "External-data integration and stateless-HA acceptance did not converge"
require_workflow_text 'grep -Fq "\"service\":\"upstand-schedules\""'
require_workflow_text 'http://$1:3002/metrics'
require_workflow_text 'upstand_schedules_collection_success 1'
require_workflow_text 'schedules-metrics.txt'
require_workflow_text 'scripts/health-soak-rehearsal.sh:/tmp/health-soak-rehearsal.sh:ro'
require_workflow_text 'HEALTH_SOAK_DURATION_SECONDS=60'
require_workflow_text 'health-soak.txt'
require_workflow_text 'printf "%s" "$status" | grep -Fq'
require_workflow_text 'grep -Fq "\"queues\""'
require_workflow_text 'grep -Fq "\"outbox\""'
require_workflow_text 'grep -Fq "\"backup\""'
require_workflow_text 'grep -vq "\"outbox\":null"'
require_workflow_text 'grep -vq "\"backup\":null"'
require_workflow_text 'schedules_status_recovered=false'
require_workflow_text 'for attempt in {1..180}; do'
require_workflow_text 'docker service update --replicas 0 "${STACK_NAME}_migrate"'
require_workflow_text 'docker service update --replicas 1 "${STACK_NAME}_migrate"'
require_workflow_text 'Migration task did not complete after external Postgres restoration'
require_workflow_text '--force --update-parallelism 2 --detach=false'
require_workflow_text 'for service in server schedules deployment-worker; do'
require_workflow_text 'curl --fail --silent --show-error --max-time 2'
require_workflow_text 'scripts/operational-status-rehearsal.ts'
require_workflow_text 'BUN_RUNTIME_TRANSPILER_CACHE_PATH=0'
require_workflow_text '--cap-drop ALL --read-only --tmpfs /tmp:rw,nosuid,nodev'
require_workflow_text 'OPERATIONAL_STATUS_MAX_FAILED_COUNT=0'
require_workflow_text '--entrypoint /usr/local/bin/bun'
require_workflow_text '--health-cmd "pg_isready -U upstand -d upstand"'
require_workflow_text '--health-cmd "redis-cli --no-auth-warning -a upstand-ci-password ping"'
require_workflow_text '--user 70:70'
require_workflow_text '--user 999:1000'
require_workflow_text '--cap-drop ALL'
require_workflow_text '--cap-add CHOWN'
require_workflow_text '--cap-add DAC_OVERRIDE'
require_workflow_text '--cap-add SETGID'
require_workflow_text '--cap-add SETUID'
require_workflow_text 'docker secret rm "${STACK_NAME}_${secret}"'
require_workflow_text 'bash scripts/health-load-rehearsal.test.sh'
require_workflow_text 'for profile in "100 10" "1000 25" "10000 50"'
require_workflow_text 'health-load-${requests}.txt'

for option in '--cap-drop ALL' '--health-cmd' '--health-interval' '--health-timeout' '--health-retries'; do
  count="$(grep -Fc -- "$option" "$WORKFLOW")"
  [[ "$count" -ge 2 ]] || {
    echo "release acceptance workflow must configure $option for both external data services" >&2
    exit 1
  }
done

stack_deploy_count="$(grep -Fc 'docker stack deploy --with-registry-auth' "$WORKFLOW")"
[[ "$stack_deploy_count" -ge 2 ]] || {
  echo "release acceptance workflow must deploy both bundled and external-data stacks" >&2
  exit 1
}

echo "release-acceptance-contract: passed"
