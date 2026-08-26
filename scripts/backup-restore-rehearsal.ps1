$ErrorActionPreference = "Stop"

$runId = Get-Date -Format "yyyyMMddHHmmss"
$minioName = "upstand-acceptance-minio-$runId"
$sourceName = "upstand-acceptance-pg-source-$runId"
$restoreName = "upstand-acceptance-pg-restore-$runId"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "upstand-acceptance-$runId"
$bucket = "upstand-acceptance"
$accessKey = "acceptance-access"
$secretKey = "acceptance-secret"
$endpoint = "http://host.docker.internal:19000"
$healthEndpoint = "http://127.0.0.1:19000"
$serverImage = $env:UPSTAND_BACKUP_REHEARSAL_IMAGE
$minioImage = "minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e"
$postgresImage = "postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15"
$maxTotalSeconds = if ($env:UPSTAND_BACKUP_REHEARSAL_MAX_TOTAL_SECONDS) { [int]$env:UPSTAND_BACKUP_REHEARSAL_MAX_TOTAL_SECONDS } else { 0 }
$maxRestoreSeconds = if ($env:UPSTAND_BACKUP_REHEARSAL_MAX_RESTORE_SECONDS) { [int]$env:UPSTAND_BACKUP_REHEARSAL_MAX_RESTORE_SECONDS } else { 0 }
$evidenceFile = $env:UPSTAND_BACKUP_REHEARSAL_EVIDENCE_FILE

if ($maxTotalSeconds -lt 0 -or $maxTotalSeconds -gt 604800) {
  throw "UPSTAND_BACKUP_REHEARSAL_MAX_TOTAL_SECONDS must be between 0 and 604800"
}
if ($maxRestoreSeconds -lt 0 -or $maxRestoreSeconds -gt 604800) {
  throw "UPSTAND_BACKUP_REHEARSAL_MAX_RESTORE_SECONDS must be between 0 and 604800"
}
if ([string]::IsNullOrWhiteSpace($serverImage)) {
  throw "Set UPSTAND_BACKUP_REHEARSAL_IMAGE to the immutable server image under test"
}
if ($serverImage -notmatch '@sha256:[0-9a-fA-F]{64}$') {
  throw "UPSTAND_BACKUP_REHEARSAL_IMAGE must use an immutable digest"
}

$names = @($minioName, $sourceName, $restoreName)
$dumpPath = Join-Path $temporaryRoot "readiness.dump.gz"
$downloadPath = Join-Path $temporaryRoot "downloaded.dump.gz"

function Invoke-Docker {
  param([Parameter(Mandatory)][string[]]$Arguments)
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker command failed with exit code $LASTEXITCODE"
  }
}

function Assert-Budget {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][double]$ElapsedSeconds,
    [Parameter(Mandatory)][int]$MaximumSeconds
  )
  if ($MaximumSeconds -gt 0 -and $ElapsedSeconds -gt $MaximumSeconds) {
    throw "$Name exceeded its budget: elapsed=$([math]::Round($ElapsedSeconds, 3))s budget=${MaximumSeconds}s"
  }
}

function Write-Evidence {
  param(
    [Parameter(Mandatory)][double]$ReadinessSeconds,
    [Parameter(Mandatory)][double]$TransferSeconds,
    [Parameter(Mandatory)][double]$RestoreSeconds,
    [Parameter(Mandatory)][double]$TotalSeconds
  )
  if ([string]::IsNullOrWhiteSpace($evidenceFile)) {
    return
  }
  $parent = Split-Path -Parent $evidenceFile
  if ($parent -and -not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "DR rehearsal evidence directory does not exist: $parent"
  }
  [ordered]@{
    schema = "upstand.backup-restore-rehearsal.v1"
    run_id = $runId
    completed_at = [DateTime]::UtcNow.ToString("o")
    image = $serverImage
    minio_image = $minioImage
    postgres_image = $postgresImage
    scope = "synthetic-disposable"
    result = "passed"
    data_assertion = $true
    readiness_seconds = [math]::Round($ReadinessSeconds, 3)
    transfer_seconds = [math]::Round($TransferSeconds, 3)
    restore_seconds = [math]::Round($RestoreSeconds, 3)
    total_seconds = [math]::Round($TotalSeconds, 3)
    max_restore_seconds = $maxRestoreSeconds
    max_total_seconds = $maxTotalSeconds
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $evidenceFile -Encoding utf8 -NoNewline
}

foreach ($name in $names) {
  $existing = ((& docker ps -aq --filter "name=^${name}$") | Out-String).Trim()
  if ($existing) {
    throw "Refusing to use an existing container named '$name'"
  }
}

New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null
Remove-Item -LiteralPath $dumpPath, $downloadPath -Force -ErrorAction SilentlyContinue

$rcloneEnvironment = @(
  "--add-host", "host.docker.internal:host-gateway",
  "-e", "RCLONE_CONFIG_UPSTAND_TYPE=s3",
  "-e", "RCLONE_CONFIG_UPSTAND_PROVIDER=Minio",
  "-e", "RCLONE_CONFIG_UPSTAND_ACCESS_KEY_ID=$accessKey",
  "-e", "RCLONE_CONFIG_UPSTAND_SECRET_ACCESS_KEY=$secretKey",
  "-e", "RCLONE_CONFIG_UPSTAND_ENDPOINT=$endpoint",
  "-e", "RCLONE_CONFIG_UPSTAND_NO_CHECK_BUCKET=true",
  "-e", "RCLONE_CONFIG_UPSTAND_FORCE_PATH_STYLE=true",
  "--entrypoint", "rclone",
  $serverImage
)

try {
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  Invoke-Docker @("run", "-d", "--rm", "--name", $minioName,
    "-p", "127.0.0.1:19000:9000",
    "-e", "MINIO_ROOT_USER=$accessKey",
    "-e", "MINIO_ROOT_PASSWORD=$secretKey",
    $minioImage, "server", "/data", "--console-address", ":9001")
  Invoke-Docker @("run", "-d", "--rm", "--name", $sourceName,
    "-e", "POSTGRES_PASSWORD=acceptance-password",
    "-e", "POSTGRES_DB=acceptance",
    "-e", "PGDATA=/var/lib/postgresql/data/pgdata",
    "--tmpfs", "/var/lib/postgresql/data", $postgresImage)
  Invoke-Docker @("run", "-d", "--rm", "--name", $restoreName,
    "-e", "POSTGRES_PASSWORD=acceptance-password",
    "-e", "POSTGRES_DB=acceptance",
    "-e", "PGDATA=/var/lib/postgresql/data/pgdata",
    "--tmpfs", "/var/lib/postgresql/data", $postgresImage)

  $ready = $false
  $readinessStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      Invoke-Docker @("exec", $sourceName, "pg_isready", "-U", "postgres", "-d", "acceptance")
      Invoke-Docker @("exec", $restoreName, "pg_isready", "-U", "postgres", "-d", "acceptance")
      $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$($healthEndpoint)/minio/health/live"
      if ($health.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $ready) {
    throw "Disposable backup rehearsal services did not become ready"
  }
  $readinessSeconds = $readinessStopwatch.Elapsed.TotalSeconds

  Invoke-Docker @("exec", $sourceName, "psql", "-U", "postgres", "-d", "acceptance",
    "-v", "ON_ERROR_STOP=1", "-c",
    "CREATE TABLE readiness_probe (id integer primary key, marker text not null); INSERT INTO readiness_probe VALUES (1, 'backup-restore-ok');")
  Invoke-Docker @("exec", $sourceName, "sh", "-ec",
    "pg_dump -U postgres -d acceptance -Fc --no-owner --no-acl | gzip > /tmp/readiness.dump.gz")
  Invoke-Docker @("cp", "$sourceName`:/tmp/readiness.dump.gz", $dumpPath)

  $transferStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  Invoke-Docker (@("run", "--rm", "-v", "$temporaryRoot`:/work:ro") + $rcloneEnvironment + @(
      "mkdir", "--s3-no-check-bucket=false", "upstand:$bucket"))
  Invoke-Docker (@("run", "--rm", "-v", "$temporaryRoot`:/work:ro") + $rcloneEnvironment + @(
      "copyto", "/work/readiness.dump.gz", "upstand:$bucket/readiness.dump.gz"))
  Invoke-Docker (@("run", "--rm", "-v", "$temporaryRoot`:/work") + $rcloneEnvironment + @(
      "copyto", "upstand:$bucket/readiness.dump.gz", "/work/downloaded.dump.gz"))
  $transferSeconds = $transferStopwatch.Elapsed.TotalSeconds
  Invoke-Docker @("cp", $downloadPath, "$restoreName`:/tmp/readiness.dump.gz")
  $restoreStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  Invoke-Docker @("exec", $restoreName, "sh", "-ec",
    "gzip -dc /tmp/readiness.dump.gz | pg_restore -U postgres -d acceptance --clean --if-exists --no-owner")
  $restoreSeconds = $restoreStopwatch.Elapsed.TotalSeconds
  Assert-Budget "restore" $restoreSeconds $maxRestoreSeconds

  $marker = (& docker exec $restoreName psql -U postgres -d acceptance -At -c "SELECT marker FROM readiness_probe WHERE id = 1").Trim()
  if ($LASTEXITCODE -ne 0 -or $marker -ne "backup-restore-ok") {
    throw "Restored marker mismatch"
  }

  $totalSeconds = $stopwatch.Elapsed.TotalSeconds
  Assert-Budget "total" $totalSeconds $maxTotalSeconds
  Write-Evidence $readinessSeconds $transferSeconds $restoreSeconds $totalSeconds
  Write-Output ("backup-restore-rehearsal: metrics readiness_seconds={0:N3} transfer_seconds={1:N3} restore_seconds={2:N3} total_seconds={3:N3} max_restore_seconds={4} max_total_seconds={5}" -f $readinessSeconds, $transferSeconds, $restoreSeconds, $totalSeconds, $maxRestoreSeconds, $maxTotalSeconds)
  Write-Output "backup-restore-rehearsal: passed (MinIO upload/download, PostgreSQL restore, data assertion)"
} finally {
  foreach ($name in $names) {
    $existing = ((& docker ps -aq --filter "name=^${name}$") | Out-String).Trim()
    if ($existing) {
      & docker rm -f $name | Out-Null
    }
  }
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
