#!/usr/bin/env bash
set -euo pipefail

mode="${ACCEPTANCE_FIXTURE_MODE:-valid}"
digest="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
server_image="ghcr.io/upstandplatform/upstand-server:v1.2.3@sha256:${digest}"
schedules_image="ghcr.io/upstandplatform/upstand-schedules:v1.2.3@sha256:${digest}"
deployment_worker_image="ghcr.io/upstandplatform/upstand-deployment-worker:v1.2.3@sha256:${digest}"
migration_image="$server_image"
postgres_image="postgres:18-alpine@sha256:${digest}"
redis_image="redis:8.8-alpine@sha256:${digest}"
monitoring_image="ghcr.io/upstandplatform/upstand-monitoring:v1.2.3@sha256:${digest}"
if [[ "$mode" == "mismatch" ]]; then
  migration_image="ghcr.io/upstandplatform/upstand-server:v1.2.2@sha256:${digest}"
fi

if [[ "${1:-}" == "info" ]]; then
  if [[ "${3:-}" == *Swarm.NodeID* ]]; then
    printf 'node-id\n'
  elif [[ "${3:-}" == *Name* ]]; then
    printf 'fixture-node\n'
  else
    printf 'active\n'
  fi
  exit 0
fi

if [[ "${1:-}" == "network" && "${2:-}" == "inspect" ]]; then
  case "${3:-}" in
    -f|--format)
      case "${4:-}" in
        *Driver*) printf 'overlay\n' ;;
        *Scope*) printf 'swarm\n' ;;
        *Attachable*) printf 'true\n' ;;
        *Internal*) [[ "${5:-}" == upstand-docker-control ]] && printf 'true\n' || printf 'false\n' ;;
        *Id*) printf 'network-id\n' ;;
        *Options*)
          [[ "$mode" == unencrypted ]] && printf '{"com.docker.network.driver.overlay.vxlanid_list":"4101"}\n' || printf '{"encrypted":""}\n'
          ;;
        *) exit 1 ;;
      esac
      exit 0
      ;;
    *) exit 1 ;;
  esac
fi

  if [[ "${1:-}" == "service" && "${2:-}" == "inspect" ]]; then
  if [[ "${3:-}" != "--format" ]]; then
    # The fixture models external PostgreSQL and Redis services.
    if [[ ("$mode" == bundled || "$mode" == stateful-root || "$mode" == proc-fallback || "$mode" == proc-fallback-root || "$mode" == proc-fallback-runtime-user) && ("${3:-}" == upstand_postgres || "${3:-}" == upstand_redis) ]]; then
      exit 0
    fi
    if [[ "$mode" == ha && ("${3:-}" == upstand_external_postgres || "${3:-}" == upstand_external_redis) ]]; then
      exit 0
    fi
    exit 1
  fi
  format="${4:-}"
  service="${5:-}"
  if [[ "$format" == *"range .Spec.TaskTemplate.ContainerSpec.Env"* ]]; then
    if [[ "$service" == upstand_docker-broker ]]; then
      printf 'UPSTAND_DOCKER_BROKER_SERVER_TOKEN_FILE=/run/secrets/docker_broker_server_token\nUPSTAND_DOCKER_BROKER_SCHEDULES_TOKEN_FILE=/run/secrets/docker_broker_schedules_token\nUPSTAND_DOCKER_BROKER_DEPLOYMENT_WORKER_TOKEN_FILE=/run/secrets/docker_broker_deployment_worker_token\nUPSTAND_DOCKER_BROKER_ALLOWED_CALLERS=server,schedules,deployment-worker\nUPSTAND_DOCKER_BROKER_MAX_INFLIGHT=64\nUPSTAND_DOCKER_BROKER_TLS_REQUIRED=true\nUPSTAND_DOCKER_BROKER_CA_FILE=/run/secrets/docker_broker_ca\nUPSTAND_DOCKER_BROKER_CERT_FILE=/run/secrets/docker_broker_server_cert\nUPSTAND_DOCKER_BROKER_KEY_FILE=/run/secrets/docker_broker_server_key\n'
    elif [[ "$service" == upstand_server ]]; then
      if [[ "$mode" == observed ]]; then
        printf 'UPSTAND_MONITORING_IMAGE=%s\nDOCKER_HOST=https://docker-broker:2375\nDOCKER_TLS_VERIFY=1\nDOCKER_CERT_PATH=/run/secrets\nUPSTAND_DOCKER_BROKER_TOKEN_FILE=/run/secrets/docker_broker_server_token\nUPSTAND_DOCKER_BROKER_CALLER=server\nUPSTAND_DOCKER_BROKER_CA_FILE=/run/secrets/docker_broker_ca\nUPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE=/run/secrets/docker_broker_server_client_cert\nUPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE=/run/secrets/docker_broker_server_client_key\nUPSTAND_METRICS_TOKEN_FILE=/run/secrets/metrics_token\nOTLP_ENDPOINT=http://otel-collector:4318\n' "$monitoring_image"
      elif [[ "$mode" == node-local || "$mode" == node-local-root ]]; then
        printf 'UPSTAND_MONITORING_IMAGE=%s\nDOCKER_HOST=https://docker-broker:2375\nDOCKER_TLS_VERIFY=1\nDOCKER_CERT_PATH=/run/secrets\nUPSTAND_DOCKER_BROKER_TOKEN_FILE=/run/secrets/docker_broker_server_token\nUPSTAND_DOCKER_BROKER_CALLER=server\nUPSTAND_DOCKER_BROKER_CA_FILE=/run/secrets/docker_broker_ca\nUPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE=/run/secrets/docker_broker_server_client_cert\nUPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE=/run/secrets/docker_broker_server_client_key\nUPSTAND_METRICS_TOKEN_FILE=/run/secrets/metrics_token\n' "$monitoring_image"
      else
        printf 'DOCKER_HOST=https://docker-broker:2375\nDOCKER_TLS_VERIFY=1\nDOCKER_CERT_PATH=/run/secrets\nUPSTAND_DOCKER_BROKER_TOKEN_FILE=/run/secrets/docker_broker_server_token\nUPSTAND_DOCKER_BROKER_CALLER=server\nUPSTAND_DOCKER_BROKER_CA_FILE=/run/secrets/docker_broker_ca\nUPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE=/run/secrets/docker_broker_server_client_cert\nUPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE=/run/secrets/docker_broker_server_client_key\nUPSTAND_METRICS_TOKEN_FILE=/run/secrets/metrics_token\n'
      fi
    elif [[ "$service" == upstand_schedules ]]; then
      printf 'DOCKER_HOST=https://docker-broker:2375\nDOCKER_TLS_VERIFY=1\nDOCKER_CERT_PATH=/run/secrets\nUPSTAND_DOCKER_BROKER_TOKEN_FILE=/run/secrets/docker_broker_schedules_token\nUPSTAND_DOCKER_BROKER_CALLER=schedules\nUPSTAND_DOCKER_BROKER_CA_FILE=/run/secrets/docker_broker_ca\nUPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE=/run/secrets/docker_broker_schedules_client_cert\nUPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE=/run/secrets/docker_broker_schedules_client_key\nUPSTAND_BACKUP_ALERT_REQUIRE_SUCCESS=true\nUPSTAND_BACKUP_ALERT_REQUIRE_RESTORE_VERIFICATION=true\nUPSTAND_BACKUP_ALERT_MAX_AGE_MS=172800000\n'
      [[ "$mode" == observed ]] && printf 'OTLP_ENDPOINT=http://otel-collector:4318\n'
    elif [[ "$service" == upstand_deployment-worker ]]; then
      printf 'DOCKER_HOST=https://docker-broker:2375\nDOCKER_TLS_VERIFY=1\nDOCKER_CERT_PATH=/run/secrets\nUPSTAND_DOCKER_BROKER_TOKEN_FILE=/run/secrets/docker_broker_deployment_worker_token\nUPSTAND_DOCKER_BROKER_CALLER=deployment-worker\nUPSTAND_DOCKER_BROKER_CA_FILE=/run/secrets/docker_broker_ca\nUPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE=/run/secrets/docker_broker_deployment_worker_client_cert\nUPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE=/run/secrets/docker_broker_deployment_worker_client_key\nUPSTAND_SCHEDULES_ROLE=deployment-worker\n'
      [[ "$mode" == observed ]] && printf 'OTLP_ENDPOINT=http://otel-collector:4318\n'
    elif [[ "$mode" == observed && ("$service" == upstand_web || "$service" == upstand_fumadocs) ]]; then
      printf 'OTLP_ENDPOINT=http://otel-collector:4318\n'
    fi
    exit 0
  fi
  if [[ "$format" == *TaskTemplate.Networks* ]]; then
    if [[ "$mode" == wrong-network ]]; then
      printf '[{"Target":"wrong-network"}]\n'
    else
      printf '[{"Target":"network-id"}]\n'
    fi
    exit 0
  fi
  if [[ "$service" == "upstand_migrate" ]]; then
    [[ "$format" == *ContainerSpec.Image* ]] && printf '%s\n' "$migration_image" && exit 0
    [[ "$format" == *ContainerSpec.ReadOnly* ]] && printf 'true\n' && exit 0
    if [[ "$format" == *CapabilityDrop* ]]; then
      [[ "$mode" == weak ]] && printf '[]\n' || printf '["ALL"]\n'
      exit 0
    fi
    if [[ "$format" == *ContainerSpec.User* ]]; then
      [[ "$mode" == root ]] && printf '0\n' || printf '10001:123\n'
      exit 0
    fi
  fi
  if [[ "$service" == "upstand_server" ]]; then
    [[ "$format" == *ContainerSpec.Image* ]] && printf '%s\n' "$server_image" && exit 0
    [[ "$format" == *ContainerSpec.ReadOnly* ]] && printf 'true\n' && exit 0
    if [[ "$format" == *ContainerSpec.Env* ]]; then
      if [[ "$mode" == missing-monitoring-image ]]; then
        printf '["NODE_ENV=production"]\n'
      elif [[ "$mode" == observed ]]; then
        printf '["UPSTAND_MONITORING_IMAGE=%s","OTLP_ENDPOINT=http://otel-collector:4318"]\n' "$monitoring_image"
      else
        printf '["UPSTAND_MONITORING_IMAGE=%s"]\n' "$monitoring_image"
      fi
      exit 0
    fi
  fi
  if [[ ("$mode" == bundled || "$mode" == stateful-root || "$mode" == proc-fallback || "$mode" == proc-fallback-root || "$mode" == proc-fallback-runtime-user) && "$service" == "upstand_postgres" ]]; then
    [[ "$format" == *Replicated.Replicas* ]] && printf '1\n' && exit 0
    [[ "$format" == *ContainerSpec.Image* ]] && printf '%s\n' "$postgres_image" && exit 0
    [[ "$format" == *ContainerSpec.Healthcheck* ]] && printf '{"Test":["CMD","true"]}\n' && exit 0
    [[ "$format" == *ContainerSpec.User* ]] && printf '70:70\n' && exit 0
    if [[ "$format" == *CapabilityDrop* ]]; then
      printf '["ALL"]\n'
      exit 0
    fi
    if [[ "$format" == *CapabilityAdd* ]]; then
      printf '["CAP_CHOWN","CAP_DAC_OVERRIDE","CAP_SETGID","CAP_SETUID"]\n'
      exit 0
    fi
  fi
  if [[ ("$mode" == bundled || "$mode" == stateful-root || "$mode" == proc-fallback || "$mode" == proc-fallback-root || "$mode" == proc-fallback-runtime-user) && "$service" == "upstand_redis" ]]; then
    [[ "$format" == *Replicated.Replicas* ]] && printf '1\n' && exit 0
    [[ "$format" == *ContainerSpec.Image* ]] && printf '%s\n' "$redis_image" && exit 0
    [[ "$format" == *ContainerSpec.Healthcheck* ]] && printf '{"Test":["CMD","true"]}\n' && exit 0
    [[ "$format" == *ContainerSpec.User* ]] && printf '999:1000\n' && exit 0
    if [[ "$format" == *CapabilityDrop* ]]; then
      printf '["ALL"]\n'
      exit 0
    fi
    if [[ "$format" == *CapabilityAdd* ]]; then
      printf '["CAP_CHOWN","CAP_DAC_OVERRIDE","CAP_SETGID","CAP_SETUID"]\n'
      exit 0
    fi
  fi
  if [[ "$mode" == ha && "$service" == "upstand_external_postgres" ]]; then
    [[ "$format" == *Replicated.Replicas* ]] && printf '1\n' && exit 0
    [[ "$format" == *ContainerSpec.Image* ]] && printf '%s\n' "$postgres_image" && exit 0
    [[ "$format" == *ContainerSpec.Healthcheck* ]] && printf '{"Test":["CMD","true"]}\n' && exit 0
    if [[ "$format" == *CapabilityDrop* ]]; then
      printf '["ALL"]\n'
      exit 0
    fi
    if [[ "$format" == *CapabilityAdd* ]]; then
      printf '["CAP_CHOWN","CAP_DAC_OVERRIDE","CAP_SETGID","CAP_SETUID"]\n'
      exit 0
    fi
  fi
  if [[ "$mode" == ha && "$service" == "upstand_external_redis" ]]; then
    [[ "$format" == *Replicated.Replicas* ]] && printf '1\n' && exit 0
    [[ "$format" == *ContainerSpec.Image* ]] && printf '%s\n' "$redis_image" && exit 0
    [[ "$format" == *ContainerSpec.Healthcheck* ]] && printf '{"Test":["CMD","true"]}\n' && exit 0
    if [[ "$format" == *CapabilityDrop* ]]; then
      printf '["ALL"]\n'
      exit 0
    fi
    if [[ "$format" == *CapabilityAdd* ]]; then
      printf '["CAP_CHOWN","CAP_DAC_OVERRIDE","CAP_SETGID","CAP_SETUID"]\n'
      exit 0
    fi
  fi
  if [[ "$service" == upstand_docker-broker || "$service" == upstand_server || "$service" == upstand_schedules || "$service" == upstand_deployment-worker || "$service" == upstand_web || "$service" == upstand_fumadocs ]]; then
    if [[ "$format" == *Replicated.Replicas* ]]; then
      [[ "$mode" == ha || "$mode" == remote-tasks ]] && printf '2\n' || printf '1\n'
      exit 0
    fi
    if [[ "$format" == *ContainerSpec.Image* ]]; then
      if [[ "$service" == upstand_schedules ]]; then
        printf '%s\n' "$schedules_image"
      elif [[ "$service" == upstand_deployment-worker ]]; then
        printf '%s\n' "$deployment_worker_image"
      else
        printf '%s\n' "$server_image"
      fi
      exit 0
    fi
    if [[ "$format" == *ContainerSpec.Healthcheck* ]]; then
      printf '{"Test":["CMD","true"]}\n'
      exit 0
    fi
    if [[ "$format" == *ContainerSpec.ReadOnly* ]]; then
      [[ "$service" == upstand_docker-broker || "$service" == upstand_web || "$service" == upstand_fumadocs || "$mode" != writable-app ]] && printf 'true\n' || printf 'false\n'
      exit 0
    fi
    if [[ "$format" == *CapabilityDrop* ]]; then
      [[ "$mode" == weak ]] && printf '[]\n' || printf '["ALL"]\n'
      exit 0
    fi
    if [[ "$format" == *ContainerSpec.Env* ]]; then
      if [[ "$service" == upstand_schedules ]]; then
        printf '["NODE_ENV=production","UPSTAND_BACKUP_ALERT_REQUIRE_SUCCESS=true","UPSTAND_BACKUP_ALERT_REQUIRE_RESTORE_VERIFICATION=true","UPSTAND_BACKUP_ALERT_MAX_AGE_MS=172800000"]\n'
      elif [[ "$service" == upstand_deployment-worker ]]; then
        printf '["NODE_ENV=production","UPSTAND_SCHEDULES_ROLE=deployment-worker"]\n'
      elif [[ "$mode" == observed ]]; then
        printf '["OTLP_ENDPOINT=http://otel-collector:4318"]\n'
      else
        printf '["NODE_ENV=production"]\n'
      fi
      exit 0
    fi
  fi
  exit 1
fi

if [[ "${1:-}" == "service" && "${2:-}" == "ps" ]]; then
  service="${3:-}"
  if [[ "$service" == upstand_migrate ]]; then
    printf 'Complete 1 second ago\n'
  elif [[ "$service" == upstand_external_postgres || "$service" == upstand_external_redis ]]; then
    printf 'Running 1 second ago\n'
  else
    [[ "$mode" == ha || "$mode" == remote-tasks ]] && printf 'Running 1 second ago\nRunning 1 second ago\n' || printf 'Running 1 second ago\n'
  fi
  exit 0
fi

if [[ "${1:-}" == "ps" && "${2:-}" == "-q" ]]; then
  filter="${4:-}"
  if [[ "$filter" == "label=com.docker.swarm.service.name" ]]; then
    if [[ "$mode" == node-local || "$mode" == node-local-root ]]; then
      printf 'container-upstand_docker-broker\ncontainer-upstand_server\ncontainer-upstand_schedules\ncontainer-upstand_deployment-worker\ncontainer-upstand_web\ncontainer-upstand_fumadocs\n'
    fi
    exit 0
  fi
  service="${filter##*=}"
  if [[ "$filter" == "label=com.upstand.component=monitoring-agent" ]]; then
    [[ "$mode" == missing-monitoring-agent ]] && exit 0
    printf 'monitoring-container\n'
    exit 0
  fi
  [[ "$mode" == missing-container ]] && exit 0
  if [[ "$mode" == ha ]]; then
    if [[ "$service" == upstand_external_postgres || "$service" == upstand_external_redis ]]; then
      printf 'container-%s\n' "$service"
      exit 0
    fi
    printf 'container-%s-1\ncontainer-%s-2\n' "$service" "$service"
    exit 0
  fi
  if [[ "$mode" == remote-tasks ]]; then
    printf 'container-%s-1\n' "$service"
    exit 0
  fi
  printf 'container-%s\n' "$service"
  exit 0
fi

if [[ "${1:-}" == "inspect" ]]; then
  if [[ "$*" == *Config.Labels* && "$4" == container-upstand_server ]]; then
    printf 'upstand_server\n'
  elif [[ "$*" == *Config.Labels* && "$4" == container-upstand_schedules ]]; then
    printf 'upstand_schedules\n'
  elif [[ "$*" == *Config.Labels* && "$4" == container-upstand_web ]]; then
    printf 'upstand_web\n'
  elif [[ "$*" == *Config.Labels* && "$4" == container-upstand_fumadocs ]]; then
    printf 'upstand_fumadocs\n'
  elif [[ "$*" == *Config.Labels* && "$4" == container-upstand_docker-broker ]]; then
    printf 'upstand_docker-broker\n'
  elif [[ "$*" == *Config.Image* && "$4" == monitoring-container ]]; then
    printf '%s\n' "$monitoring_image"
  elif [[ "$*" == *Config.Image* && "$4" == container-upstand_* ]]; then
    printf '%s\n' "$server_image"
  elif [[ "$*" == *State.Health* && "$4" == "monitoring-container" ]]; then
    printf 'healthy\n'
  elif [[ "$*" == *State.Health* && "$4" == container-upstand_* ]]; then
    printf 'healthy\n'
  elif [[ "$*" == *Config.User* && "$4" == "monitoring-container" ]]; then
    [[ "$mode" == root ]] && printf '0\n' || printf '10001:10001\n'
  elif [[ "$*" == *Config.User* && "$4" == container-upstand_* ]]; then
    if [[ "$mode" == node-local-root ]]; then
      printf '0\n'
    elif [[ "$4" == container-upstand_postgres && ("$mode" == bundled || "$mode" == proc-fallback-runtime-user) ]]; then
      printf '70:70\n'
    elif [[ "$4" == container-upstand_redis ]]; then
      printf '999:1000\n'
    elif [[ ("$mode" == stateful-root || "$mode" == proc-fallback || "$mode" == proc-fallback-root || "$mode" == proc-fallback-runtime-user) && ("$4" == container-upstand_postgres || "$4" == container-upstand_redis || "$4" == container-upstand_external_postgres || "$4" == container-upstand_external_redis) ]]; then
      printf '\n'
    else
      printf '10001:123\n'
    fi
  elif [[ "$*" == *HostConfig.CapDrop* && "$4" == "monitoring-container" ]]; then
    printf '["ALL"]\n'
  elif [[ "$*" == *HostConfig.CapDrop* && "$4" == container-upstand_* ]]; then
    printf '["ALL"]\n'
  elif [[ "$*" == *HostConfig.ReadonlyRootfs* && "$4" == "monitoring-container" ]]; then
    printf 'true\n'
  elif [[ "$*" == *HostConfig.ReadonlyRootfs* ]]; then
    [[ "$mode" == writable-app ]] && printf 'false\n' || printf 'true\n'
  elif [[ "$*" == *Config.User* ]]; then
    if [[ "$mode" == root ]]; then
      printf '0\n'
    elif [[ "$*" == *container-upstand_postgres* && ("$mode" == bundled || "$mode" == proc-fallback-runtime-user) ]]; then
      printf '70:70\n'
    elif [[ "$*" == *container-upstand_redis* ]]; then
      printf '999:1000\n'
    elif [[ ("$mode" == stateful-root || "$mode" == proc-fallback || "$mode" == proc-fallback-root || "$mode" == proc-fallback-runtime-user) && ("$*" == *container-upstand_postgres* || "$*" == *container-upstand_redis* || "$*" == *container-upstand_external_postgres* || "$*" == *container-upstand_external_redis*) ]]; then
      printf '\n'
    else
      printf '10001:123\n'
    fi
  else
    printf 'healthy\n'
  fi
  exit 0
fi

if [[ "${1:-}" == "top" ]]; then
  if [[ "$mode" == proc-fallback || "$mode" == proc-fallback-root || "$mode" == proc-fallback-runtime-user ]]; then
    exit 1
  fi
  printf 'USER PID COMMAND\n'
  [[ "$mode" == root || "$mode" == stateful-root || "$mode" == node-local-root ]] && printf 'root 1 service\n' || printf '70 1 service\n'
  exit 0
fi

if [[ "${1:-}" == "exec" ]]; then
  if [[ "$mode" == proc-fallback || "$mode" == proc-fallback-root || "$mode" == proc-fallback-runtime-user ]]; then
    if [[ "$mode" == proc-fallback-runtime-user && "$*" != *"999:1000"* ]]; then
      echo "fixture requires the configured Redis identity for process inspection" >&2
      exit 1
    fi
    [[ "$mode" == proc-fallback-root ]] && printf '0 1\n' || printf '70 1\n'
    exit 0
  fi
fi

echo "unsupported fixture Docker command: $*" >&2
exit 1
