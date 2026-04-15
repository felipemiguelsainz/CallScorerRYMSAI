$ErrorActionPreference = 'Stop'

$rootPath = 'C:\Users\felip\listenAi2'

Write-Host 'Stopping minimal stack...'

$frontendListeners = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if ($frontendListeners) {
  $pids = $frontendListeners | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($pid in $pids) {
    try { Stop-Process -Id $pid -Force -ErrorAction Stop } catch { }
  }
}

docker rm -f callscorerrymsai_backend_dev callscorerrymsai_worker_dev 2>$null | Out-Null
docker compose -f (Join-Path $rootPath 'docker-compose.yml') stop postgres redis | Out-Null

Write-Host 'Minimal stack stopped.'
