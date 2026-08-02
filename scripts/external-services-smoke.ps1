$ErrorActionPreference = "Stop"

$runId = Get-Date -Format "yyyyMMddHHmmss"
$postgresName = "upstand-acceptance-external-pg-$runId"
$redisName = "upstand-acceptance-external-redis-$runId"
$serverName = "upstand-acceptance-external-server-$runId"
$postgresPort = 15432
$redisPort = 16379
$serverPort = 13000
$databaseUrl = "postgres://postgres:acceptance-password@host.docker.internal:$postgresPort/acceptance"
$redisUrl = "redis://:acceptance-redis-password@host.docker.internal:$redisPort"
$authSecret = "acceptance-auth-secret-that-is-at-least-32-chars"
$encryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
$postgresImage = "postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15"
$redisImage = "redis:8.8-alpine@sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb"
$serverImage = $env:UPSTAND_EXTERNAL_SMOKE_IMAGE
if ([string]::IsNullOrWhiteSpace($serverImage)) {
  throw "Set UPSTAND_EXTERNAL_SMOKE_IMAGE to the immutable server image under test"
}
if ($serverImage -notmatch '@sha256:[0-9a-fA-F]{64}$') {
  throw "UPSTAND_EXTERNAL_SMOKE_IMAGE must use an immutable digest"
}
$names = @($postgresName, $redisName, $serverName)

function Invoke-Docker {
  param([Parameter(Mandatory)][string[]]$Arguments)
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker command failed with exit code $LASTEXITCODE"
  }
}

foreach ($name in $names) {
  $existing = ((& docker ps -aq --filter "name=^${name}$") | Out-String).Trim()
  if ($existing) {
    throw "Refusing to use an existing container named '$name'"
  }
}

try {
  Invoke-Docker @("run", "-d", "--rm", "--name", $postgresName,
    "-p", "127.0.0.1:${postgresPort}:5432",
    "-e", "POSTGRES_PASSWORD=acceptance-password",
    "-e", "POSTGRES_DB=acceptance", $postgresImage)
  Invoke-Docker @("run", "-d", "--rm", "--name", $redisName,
    "-p", "127.0.0.1:${redisPort}:6379",
    $redisImage, "redis-server", "--requirepass", "acceptance-redis-password")

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      Invoke-Docker @("exec", $postgresName, "pg_isready", "-U", "postgres", "-d", "acceptance")
      Invoke-Docker @("exec", $redisName, "redis-cli", "-a", "acceptance-redis-password", "ping")
      $ready = $true
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $ready) {
    throw "Disposable external database services did not become ready"
  }

  $commonEnvironment = @(
    "--add-host", "host.docker.internal:host-gateway",
    "-e", "NODE_ENV=production",
    "-e", "UPSTAND_PLATFORM=self-hosted",
    "-e", "IS_CLOUD=false",
    "-e", "DATABASE_URL=$databaseUrl",
    "-e", "REDIS_URL=$redisUrl",
    "-e", "UPSTAND_MIGRATION_ID=$runId",
    "-e", "BETTER_AUTH_SECRET=$authSecret",
    "-e", "ENCRYPTION_KEY_V1=$encryptionKey",
    "-e", "BETTER_AUTH_URL=https://api.example.invalid",
    "-e", "CORS_ORIGIN=https://app.example.invalid"
  )

  Invoke-Docker (@("run", "--rm") + $commonEnvironment + @(
      "--entrypoint", "sh", $serverImage, "-ec",
      "bun run apps/server/dist/migrate.mjs"))
  Invoke-Docker (@("run", "--rm") + $commonEnvironment + @(
      "--entrypoint", "sh", $serverImage, "-ec",
      "bun run apps/server/dist/migrate.mjs"))

  Invoke-Docker (@("run", "-d", "--rm", "--name", $serverName,
      "-p", "127.0.0.1:${serverPort}:3000") + $commonEnvironment + @(
      "-e", "UPSTAND_SKIP_MIGRATIONS=true",
      $serverImage))

  $live = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:${serverPort}/health/live"
      if ($response.StatusCode -eq 200) {
        $live = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $live) {
    throw "Rebuilt server image did not expose /health/live"
  }

  Write-Output "external-services-smoke: passed (image migration, external PostgreSQL/Redis URLs, live health endpoint)"
} finally {
  foreach ($name in $names) {
    $existing = ((& docker ps -aq --filter "name=^${name}$") | Out-String).Trim()
    if ($existing) {
      & docker rm -f $name | Out-Null
    }
  }
}
