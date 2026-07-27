$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidPath = Join-Path $root '.server.pid'

if (-not (Test-Path -LiteralPath $pidPath)) {
    Write-Output 'The local app is not running.'
    exit 0
}

$serverPid = Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue
if ($serverPid) {
    $process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $serverPid
    }
}

Remove-Item -LiteralPath $pidPath -Force
Write-Output 'The local app has stopped.'
