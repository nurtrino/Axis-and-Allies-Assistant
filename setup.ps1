# One-time setup for the Axis & Allies Anniversary Companion on a new PC.
# Run from a PowerShell prompt in this folder:   powershell -ExecutionPolicy Bypass -File .\setup.ps1
$root = $PSScriptRoot
Set-Location $root

Write-Host "=== Axis & Allies Anniversary Companion — setup ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is not installed. Install Node 20+ from https://nodejs.org, then re-run this script." -ForegroundColor Red
  exit 1
}
Write-Host ("Node " + (node --version)) -ForegroundColor DarkGray

if (-not (Test-Path "$root\.env")) {
  Copy-Item "$root\.env.example" "$root\.env"
  Write-Host "Created .env from template. Paste your ANTHROPIC_API_KEY into it (optional — the AI assistant tab needs it; everything else works without it)." -ForegroundColor Yellow
}

Write-Host "Installing dependencies (a few minutes; rebuilds the native database driver for this PC)..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed — see output above." -ForegroundColor Red; exit 1 }

Write-Host "Preparing the database..." -ForegroundColor Cyan
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Write-Host "Database setup failed — see output above." -ForegroundColor Red; exit 1 }

Write-Host "`nSetup complete. Start the app with:  powershell -ExecutionPolicy Bypass -File .\start.ps1   (or: npm run dev)" -ForegroundColor Green
