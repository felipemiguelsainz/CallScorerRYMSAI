$ErrorActionPreference = 'Stop'

$rootPath = 'C:\Users\felip\listenAi2'
$backendPath = Join-Path $rootPath 'backend'
$frontendPath = Join-Path $rootPath 'frontend'

Write-Host 'Starting minimal stack...'

docker version *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker daemon is not available. Start Docker Desktop first.'
}

docker compose -f (Join-Path $rootPath 'docker-compose.yml') up -d postgres redis | Out-Null

$pgIp = (docker inspect callscorerrymsai_db --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" | Out-String).Trim()
$redisIp = (docker inspect callscorerrymsai_redis --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" | Out-String).Trim()

$openai = ((Get-Content "$backendPath\.env" | Where-Object { $_ -match '^OPENAI_API_KEY=' }) -replace '^OPENAI_API_KEY=', '').Trim('"')
$jwt = ((Get-Content "$backendPath\.env" | Where-Object { $_ -match '^JWT_SECRET=' }) -replace '^JWT_SECRET=', '').Trim('"')

if ([string]::IsNullOrWhiteSpace($openai)) {
  throw 'OPENAI_API_KEY is empty in backend/.env'
}

if ([string]::IsNullOrWhiteSpace($jwt)) {
  throw 'JWT_SECRET is empty in backend/.env'
}

docker rm -f callscorerrymsai_backend_dev callscorerrymsai_worker_dev 2>$null | Out-Null

docker run -d --net listenai2_default --name callscorerrymsai_backend_dev -p 3001:3001 -v "${backendPath}:/app" -w /app -e DATABASE_URL="postgresql://postgres:postgres@${pgIp}:5432/callscorerrymsai_db" -e REDIS_URL="redis://${redisIp}:6379" -e OPENAI_API_KEY="$openai" -e JWT_SECRET="$jwt" -e JWT_ACCESS_EXPIRES_IN="15m" -e JWT_REFRESH_EXPIRES_IN="7d" -e FRONTEND_URL="http://localhost:5173" -e PORT="3001" -e UPLOADS_DIR="/app/secure-uploads" -e NODE_ENV="development" node:20 sh -lc "npm install; npx prisma migrate deploy --schema=prisma/schema.prisma; npm run prisma:seed; npm run dev" | Out-Null

docker run -d --net listenai2_default --name callscorerrymsai_worker_dev -v "${backendPath}:/app" -w /app -e DATABASE_URL="postgresql://postgres:postgres@${pgIp}:5432/callscorerrymsai_db" -e REDIS_URL="redis://${redisIp}:6379" -e OPENAI_API_KEY="$openai" -e JWT_SECRET="$jwt" -e JWT_ACCESS_EXPIRES_IN="15m" -e JWT_REFRESH_EXPIRES_IN="7d" -e FRONTEND_URL="http://localhost:5173" -e UPLOADS_DIR="/app/secure-uploads" -e NODE_ENV="development" node:20 sh -lc "npm install; npm run worker" | Out-Null

$existingFrontend = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if ($existingFrontend) {
  $pids = $existingFrontend | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($pid in $pids) {
    try { Stop-Process -Id $pid -Force -ErrorAction Stop } catch { }
  }
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendPath'; `$env:VITE_API_URL='http://localhost:3001'; npx vite --host=0.0.0.0 --port=5173"

Write-Host 'Minimal stack is up:'
Write-Host 'Frontend: http://localhost:5173/'
Write-Host 'Backend:  http://localhost:3001/api/health'
