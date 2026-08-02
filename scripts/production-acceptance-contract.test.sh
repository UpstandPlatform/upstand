#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_FIXTURE="$ROOT_DIR/scripts/production-acceptance-fixture-docker.sh"
GATE="$ROOT_DIR/scripts/production-acceptance.sh"

run_gate() {
  local mode="$1"
  shift
  ACCEPTANCE_FIXTURE_MODE="$mode" DOCKER_BIN="$DOCKER_FIXTURE" bash "$GATE" "$@"
}

run_gate valid --allow-unobserved
run_gate observed
run_gate bundled --allow-unobserved
run_gate ha --require-ha --allow-unobserved --external-postgres-service upstand_external_postgres --external-redis-service upstand_external_redis
run_gate remote-tasks --allow-remote-tasks --allow-unobserved
run_gate node-local --node-local --allow-unobserved

if output="$(run_gate missing-monitoring-agent --allow-unobserved 2>&1)"; then
  echo "expected the acceptance gate to reject a missing monitoring agent" >&2
  exit 1
fi
[[ "$output" == *"no inspectable monitoring agent"* ]] || {
  echo "acceptance gate rejected a missing monitoring agent for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate valid 2>&1)"; then
  echo "expected the acceptance gate to require telemetry configuration" >&2
  exit 1
fi
[[ "$output" == *"has no valid OTLP_ENDPOINT"* ]] || {
  echo "acceptance gate rejected missing telemetry for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate remote-tasks 2>&1)"; then
  echo "expected strict acceptance to reject tasks outside the local Docker daemon" >&2
  exit 1
fi
[[ "$output" == *"use --allow-remote-tasks for service-level validation"* ]] || {
  echo "strict acceptance rejected remote tasks for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate mismatch 2>&1)"; then
  echo "expected the acceptance gate to reject a migration/server image mismatch" >&2
  exit 1
fi
[[ "$output" == *"migration image does not match"* ]] || {
  echo "acceptance gate rejected the mismatch for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate weak 2>&1)"; then
  echo "expected the acceptance gate to reject missing capability dropping" >&2
  exit 1
fi
[[ "$output" == *"does not drop all Linux capabilities"* ]] || {
  echo "acceptance gate rejected missing capability dropping for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate root 2>&1)"; then
  echo "expected the acceptance gate to reject a root migration service" >&2
  exit 1
fi
[[ "$output" == *"non-root runtime identity"* ]] || {
  echo "acceptance gate rejected a root migration service for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate stateful-root 2>&1)"; then
  echo "expected the acceptance gate to reject a stateful service with a root process" >&2
  exit 1
fi
[[ "$output" == *"root runtime process"* ]] || {
  echo "acceptance gate rejected a stateful root process for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate missing-container 2>&1)"; then
  echo "expected the acceptance gate to reject missing task containers" >&2
  exit 1
fi
[[ "$output" == *"inspectable containers"* ]] || {
  echo "acceptance gate rejected missing task containers for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate wrong-network 2>&1)"; then
  echo "expected the acceptance gate to reject services attached to another network" >&2
  exit 1
fi
[[ "$output" == *"not attached to network"* ]] || {
  echo "acceptance gate rejected an incorrect service network for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate missing-monitoring-image 2>&1)"; then
  echo "expected the acceptance gate to reject an unpinned monitoring image" >&2
  exit 1
fi
[[ "$output" == *"server monitoring image is not pinned"* ]] || {
  echo "acceptance gate rejected an unpinned monitoring image for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate writable-app --allow-unobserved 2>&1)"; then
  echo "expected the acceptance gate to reject writable control-plane roots" >&2
  exit 1
fi
[[ "$output" == *"does not use a read-only root filesystem"* ]] || {
  echo "acceptance gate rejected writable control-plane roots for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate node-local-root --node-local --allow-unobserved 2>&1)"; then
  echo "expected node-local acceptance to reject a root task container" >&2
  exit 1
fi
[[ "$output" == *"root runtime process"* ]] || {
  echo "node-local acceptance rejected a root task container for an unexpected reason: $output" >&2
  exit 1
}

if output="$(run_gate unencrypted 2>&1)"; then
  echo "expected the acceptance gate to reject an unencrypted network" >&2
  exit 1
fi
[[ "$output" == *"is not encrypted"* ]] || {
  echo "acceptance gate rejected an unencrypted network for an unexpected reason: $output" >&2
  exit 1
}

echo "production-acceptance-contract: passed"
