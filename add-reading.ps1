[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Title,

    [Parameter(Mandatory = $true)]
    [string]$Author,

    [Parameter(Mandatory = $true)]
    [string]$Publisher,

    [Parameter(Mandatory = $true)]
    [string]$Genre,

    [Parameter(Mandatory = $true)]
    [string]$Url,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $scriptRoot '.env'

function Import-DotEnv {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw ".env file not found: $Path"
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) {
            continue
        }

        $separator = $trimmed.IndexOf('=')
        if ($separator -lt 1) {
            continue
        }

        $name = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim()
        Set-Item -LiteralPath "Env:$name" -Value $value
    }
}

function Assert-NotBlank {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowEmptyString()][string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name cannot be empty."
    }
}

function Invoke-NotionApi {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST')][string]$Method,
        [Parameter(Mandatory = $true)][string]$Endpoint,
        [object]$Body
    )

    $headers = @{
        Authorization    = "Bearer $env:NOTION_TOKEN"
        'Notion-Version' = '2026-03-11'
    }

    try {
        if ($null -eq $Body) {
            return Invoke-RestMethod -Method $Method -Uri $Endpoint -Headers $headers
        }

        $jsonBody = $Body | ConvertTo-Json -Depth 12
        $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)
        return Invoke-RestMethod -Method $Method -Uri $Endpoint -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $utf8Body
    }
    catch {
        $statusCode = $null
        if ($null -ne $_.Exception.Response -and $null -ne $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }

        $message = $_.Exception.Message
        if (-not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
            try {
                $errorBody = $_.ErrorDetails.Message | ConvertFrom-Json
                if (-not [string]::IsNullOrWhiteSpace($errorBody.message)) {
                    $message = $errorBody.message
                }
            }
            catch {
                # Keep the original exception message for non-JSON responses.
            }
        }

        if ($null -ne $statusCode) {
            throw "Notion API request failed (HTTP $statusCode): $message"
        }
        throw "Notion API request failed: $message"
    }
}

Import-DotEnv -Path $envPath

Assert-NotBlank -Name 'Title' -Value $Title
Assert-NotBlank -Name 'Author' -Value $Author
Assert-NotBlank -Name 'Publisher' -Value $Publisher
Assert-NotBlank -Name 'Genre' -Value $Genre
Assert-NotBlank -Name 'Url' -Value $Url
Assert-NotBlank -Name 'NOTION_DATA_SOURCE_ID' -Value $env:NOTION_DATA_SOURCE_ID

$parsedUrl = $null
$isValidUrl = [Uri]::TryCreate($Url.Trim(), [UriKind]::Absolute, [ref]$parsedUrl)
if (-not $isValidUrl -or $parsedUrl.Scheme -notin @('http', 'https')) {
    throw 'Url must be a valid link starting with http:// or https://.'
}

if (-not $DryRun) {
    Assert-NotBlank -Name 'NOTION_TOKEN' -Value $env:NOTION_TOKEN
}

$koreaTimeZone = [TimeZoneInfo]::FindSystemTimeZoneById('Korea Standard Time')
$todayInKorea = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $koreaTimeZone).ToString('yyyy-MM-dd')
$normalizedUrl = $parsedUrl.AbsoluteUri

$properties = [ordered]@{
    Title = @{
        title = @(
            @{ text = @{ content = $Title.Trim() } }
        )
    }
    Date = @{
        date = @{ start = $todayInKorea }
    }
    Author = @{
        rich_text = @(
            @{ text = @{ content = $Author.Trim() } }
        )
    }
    Publisher = @{
        rich_text = @(
            @{ text = @{ content = $Publisher.Trim() } }
        )
    }
    Genre = @{
        select = @{ name = $Genre.Trim() }
    }
    URL = @{
        url = $normalizedUrl
    }
}

$createBody = [ordered]@{
    parent = @{
        data_source_id = $env:NOTION_DATA_SOURCE_ID
    }
    properties = $properties
}

if ($DryRun) {
    [pscustomobject]@{
        dry_run = $true
        request = $createBody
    } | ConvertTo-Json -Depth 12
    exit 0
}

$queryBody = @{
    page_size = 1
    filter = @{
        property = 'URL'
        url = @{
            equals = $normalizedUrl
        }
    }
}

$queryEndpoint = "https://api.notion.com/v1/data_sources/$($env:NOTION_DATA_SOURCE_ID)/query"
$existing = Invoke-NotionApi -Method POST -Endpoint $queryEndpoint -Body $queryBody

if (@($existing.results).Count -gt 0) {
    $existingPage = $existing.results[0]
    throw "The same URL is already registered: $($existingPage.url)"
}

$created = Invoke-NotionApi -Method POST -Endpoint 'https://api.notion.com/v1/pages' -Body $createBody

[pscustomobject]@{
    created = $true
    title = $Title.Trim()
    date = $todayInKorea
    notion_url = $created.url
} | ConvertTo-Json -Depth 4
