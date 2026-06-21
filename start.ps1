# Start the app (hidden server) and open it in the browser.
# Run:  powershell -ExecutionPolicy Bypass -File .\start.ps1
$root = $PSScriptRoot
$next = Join-Path $root "node_modules\next\dist\bin\next"
$log  = Join-Path $root "dev-server.log"

if (-not (Test-Path $next)) {
  Write-Host "Dependencies are missing. Run setup first:  powershell -ExecutionPolicy Bypass -File .\setup.ps1" -ForegroundColor Red
  exit 1
}

# Already running?
$busy = $false
try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 3000); $c.Close(); $busy = $true } catch {}
if (-not $busy) {
  Write-Host "Starting War Ledger (hidden window)..." -ForegroundColor Cyan
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c node `"$next`" dev > `"$log`" 2>&1" -WindowStyle Hidden -WorkingDirectory $root
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    try { if ((Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/health -TimeoutSec 2).StatusCode -eq 200) { break } } catch {}
  }
}

Start-Process "http://localhost:3000"
Write-Host "Running at http://localhost:3000  (logs: dev-server.log)." -ForegroundColor Green
Write-Host "To stop: use the in-app lower-left Restart button to recycle it, or end the 'node' process on port 3000." -ForegroundColor DarkGray
