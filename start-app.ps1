$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $root '.env'
$pidPath = Join-Path $root '.server.pid'
$url = 'http://127.0.0.1:3000'

if (-not (Test-Path -LiteralPath $envPath)) {
    throw '.env file not found.'
}

$requiredKeys = @('NOTION_TOKEN', 'NOTION_DATA_SOURCE_ID', 'ALADIN_TTB_KEY')
$values = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^([^#=]+)=(.*)$') {
        $values[$matches[1].Trim()] = $matches[2].Trim()
    }
}

foreach ($key in $requiredKeys) {
    if ([string]::IsNullOrWhiteSpace($values[$key])) {
        throw "$key is not configured in .env."
    }
}

if (Test-Path -LiteralPath $pidPath) {
    $oldPid = Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue
    if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
        Start-Process $url
        exit 0
    }
}

$process = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1
        if ($response.StatusCode -eq 200) {
            Start-Process $url
            exit 0
        }
    }
    catch {
        Start-Sleep -Milliseconds 200
    }
}

throw 'The local app did not start in time.'
