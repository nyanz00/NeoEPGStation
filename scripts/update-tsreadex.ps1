param(
    [string]$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') {
    throw 'update-tsreadex.ps1 currently downloads the Windows x64 tsreadex binary only.'
}

$apiUrl = 'https://api.github.com/repos/xtne6f/tsreadex/releases/latest'
$headers = @{ 'User-Agent' = 'EPGStation update-tsreadex' }
$release = Invoke-RestMethod -Uri $apiUrl -Headers $headers
$asset = $release.assets | Where-Object { $_.name -like 'tsreadex-*.zip' } | Select-Object -First 1

if ($null -eq $asset) {
    throw 'tsreadex release zip was not found.'
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('epgstation-tsreadex-' + [System.Guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $tempDir $asset.name
$extractDir = Join-Path $tempDir 'extract'
$destDir = Join-Path $RepoRoot 'thirdparty\tsreadex'
$destPath = Join-Path $destDir 'tsreadex.exe'

New-Item -ItemType Directory -Force -Path $tempDir, $extractDir, $destDir | Out-Null

try {
    Write-Host "Downloading $($asset.browser_download_url)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -Headers $headers

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractDir)

    $sourcePath = Join-Path $extractDir 'x64\tsreadex.exe'
    if ((Test-Path -LiteralPath $sourcePath) -eq $false) {
        throw 'x64/tsreadex.exe was not found in the release zip.'
    }

    Copy-Item -LiteralPath $sourcePath -Destination $destPath -Force
    Write-Host "Installed tsreadex: $destPath"
} finally {
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}
