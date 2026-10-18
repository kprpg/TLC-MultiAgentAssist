#requires -Version 7.4
<#
.SYNOPSIS
Rebuild both Teams ZIPs, run the extracted local runtime, verify HTTPS, and sideload the app.
.DESCRIPTION
Uses existing approved HTTPS ingress, or a supplied trusted PEM certificate/key for localhost.
Does not create tunnels, trust certificates, change networking, or provision Azure resources.
Stop a runtime started by this script using the same file with -Stop.
#>
[CmdletBinding(DefaultParameterSetName = 'Run')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Run')]
    [string] $Origin,
    [Parameter(ParameterSetName = 'Run')]
    [string] $ConfigPath,
    [Parameter(ParameterSetName = 'Run')]
    [ValidateSet('sample', 'live')]
    [string] $Mode,
    [Parameter(ParameterSetName = 'Run')]
    [ValidateRange(0, 65535)]
    [int] $LocalPort = 0,
    [Parameter(ParameterSetName = 'Run')]
    [string] $CertificatePath,
    [Parameter(ParameterSetName = 'Run')]
    [string] $PrivateKeyPath,
    [Parameter(ParameterSetName = 'Run')]
    [switch] $SkipBuild,
    [Parameter(ParameterSetName = 'Run')]
    [switch] $SkipTeamsUpload,
    [Parameter(ParameterSetName = 'Run')]
    [string] $RuntimeArchive,
    [Parameter(ParameterSetName = 'Run')]
    [string] $TeamsArchive,
    [Parameter(Mandatory, ParameterSetName = 'Stop')]
    [switch] $Stop,
    [string] $WorkDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'TLC-Assist\Teams\launcher')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$WorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
$recordPath = Join-Path $WorkDirectory 'current-run.json'

function Invoke-CheckedCommand {
    param([string] $Command, [string[]] $Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE. The current step did not complete." }
}

function Stop-OwnedRun {
    if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) { return }
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $releaseRoot = [IO.Path]::GetFullPath((Join-Path $WorkDirectory 'releases')) + [IO.Path]::DirectorySeparatorChar
    $directory = [IO.Path]::GetFullPath([string] $record.runtimeDirectory)
    if (-not $directory.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to stop a process with an unowned runtime directory.'
    }
    $markerPath = Join-Path $directory '.runner-owner'
    if (-not (Test-Path -LiteralPath $markerPath) -or (Get-Content -LiteralPath $markerPath -Raw).Trim() -ne $record.runId) {
        throw 'Refusing to stop a process without a matching runner ownership marker.'
    }
    $running = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if ($running) {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.pid)"
        $expectedServer = Join-Path $directory 'server.js'
        $recordedStart = ([DateTimeOffset] $record.startTimeUtc).UtcDateTime
        if ($running.StartTime.ToUniversalTime().Ticks -ne $recordedStart.Ticks -or
            -not $processInfo.CommandLine -or
            -not $processInfo.CommandLine.Contains($expectedServer, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing to stop a reused PID or an unrelated Node process.'
        }
        Stop-Process -Id $record.pid
        $running.WaitForExit()
    }
    Remove-Item -LiteralPath $recordPath
    Write-Host 'Stopped the runtime owned by this script. Persistent data was retained.'
}

function Test-TeamsEndpoint {
    param([string] $Base, [string] $ExpectedMode)
    $healthResponse = Invoke-WebRequest -Uri "$Base/api/health" -TimeoutSec 10 -MaximumRedirection 0
    $health = $healthResponse.Content | ConvertFrom-Json
    if ($healthResponse.StatusCode -ne 200 -or $health.status -ne 'ready' -or
        $health.surface -ne 'teams' -or $health.mode -ne $ExpectedMode) {
        throw 'The endpoint is not the expected Teams runtime and data mode.'
    }
    $page = Invoke-WebRequest -Uri "$Base/" -TimeoutSec 10 -MaximumRedirection 0
    $contentType = $page.Headers['Content-Type'] -join ','
    if ($page.StatusCode -ne 200 -or $contentType -notmatch '^text/html(?:\s*;|$)' -or
        -not $page.Content.Contains('TLC Assist for Teams')) { throw 'The Teams HTML UI is not reachable.' }
}

New-Item -ItemType Directory -Path $WorkDirectory -Force | Out-Null
$lock = [IO.File]::Open((Join-Path $WorkDirectory 'runner.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    if ($Stop) { Stop-OwnedRun; return }
    if (-not $SkipBuild -and ($RuntimeArchive -or $TeamsArchive)) { throw 'Explicit archive overrides require -SkipBuild. A normal run must use its newly rebuilt ZIPs.' }
    $uri = [Uri] $Origin
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or
        $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment) { throw 'Origin must be an exact HTTPS origin, with no path, query or credentials.' }
    $Origin = $uri.GetLeftPart([UriPartial]::Authority)
    if ($uri.DnsSafeHost -match '(^|\.)(example\.(com|net|org)|example|test|invalid)$') {
        throw 'Replace the template origin with your actual approved HTTPS host.'
    }
    $node = (Get-Command node -ErrorAction Stop).Source
    Get-Command npm -ErrorAction Stop | Out-Null
    if ($ConfigPath) {
        $ConfigPath = (Resolve-Path -LiteralPath $ConfigPath -ErrorAction Stop).Path
    }
    $inspectConfiguration = @'
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
try {
  const values = process.argv[1] ? parseEnv(await readFile(process.argv[1], 'utf8')) : {};
  const environment = { ...process.env, ...values };
  const paths = {};
  for (const name of ['TLC_FOUNDRY_ENV_FILE', 'TLC_TEAMS_DISCLOSURE_POLICY', 'TLC_MCEM_GUIDANCE_PATH', 'TLC_TEAMS_STATE_PATH', 'TLC_TEAMS_SAMPLE_PATH', 'TLC_TEAMS_DATA_DIR', 'TLC_TEAMS_TLS_CERT_PATH', 'TLC_TEAMS_TLS_KEY_PATH']) {
    if (environment[name]) paths[name] = environment[name] === ':memory:' ? ':memory:' : resolve(process.argv[2], environment[name]);
  }
  console.log(JSON.stringify({
    mode: environment.TLC_TEAMS_MODE ?? (process.argv[1] ? '' : 'sample'),
    appId: environment.TLC_TEAMS_PACKAGE_ID ?? '8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b',
    explicitAppId: Boolean(environment.TLC_TEAMS_PACKAGE_ID), botId: environment.TLC_TEAMS_BOT_CLIENT_ID ?? '',
    port: environment.TLC_TEAMS_PORT ?? '', paths
  }));
} catch { console.error('The private runtime configuration could not be read or parsed.'); process.exitCode = 1; }
'@
    Push-Location -LiteralPath $repositoryRoot
    try {
        $metadataText = & $node --input-type=module --eval $inspectConfiguration ([string] $ConfigPath) $repositoryRoot
        if ($LASTEXITCODE -ne 0) { throw 'Runtime configuration inspection failed. No credentials were printed.' }
        $metadata = ($metadataText -join "`n") | ConvertFrom-Json -AsHashtable
        if (-not $Mode) { $Mode = $metadata.mode }
        if ($Mode -notin @('sample', 'live')) { throw 'Configure an explicit sample or live mode.' }
        if (-not $CertificatePath -and $metadata.paths.ContainsKey('TLC_TEAMS_TLS_CERT_PATH')) { $CertificatePath = $metadata.paths.TLC_TEAMS_TLS_CERT_PATH }
        if (-not $PrivateKeyPath -and $metadata.paths.ContainsKey('TLC_TEAMS_TLS_KEY_PATH')) { $PrivateKeyPath = $metadata.paths.TLC_TEAMS_TLS_KEY_PATH }
        if ([bool] $CertificatePath -ne [bool] $PrivateKeyPath) { throw 'Supply both the TLS certificate and private key paths.' }
        if ($uri.IsLoopback -and -not $CertificatePath) {
            throw 'HTTPS localhost requires a supplied trusted TLS certificate and key. An HTTP-only server produces a blank Teams window.'
        }
        if ($CertificatePath) {
            if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) {
                throw "TLS certificate file not found: '$CertificatePath'. Set -CertificatePath or TLC_TEAMS_TLS_CERT_PATH to an existing PEM file, not a placeholder or directory. See docs/runbooks/teams-app.md for localhost certificate setup."
            }
            if (-not (Test-Path -LiteralPath $PrivateKeyPath -PathType Leaf)) {
                throw "TLS private key file not found: '$PrivateKeyPath'. Set -PrivateKeyPath or TLC_TEAMS_TLS_KEY_PATH to an existing PEM file, not a placeholder or directory. See docs/runbooks/teams-app.md for localhost certificate setup."
            }
            $CertificatePath = (Resolve-Path -LiteralPath $CertificatePath).Path
            $PrivateKeyPath = (Resolve-Path -LiteralPath $PrivateKeyPath).Path
            if (-not $uri.IsLoopback) { throw 'Direct certificate mode is for a loopback HTTPS origin. Use existing approved HTTPS ingress for a shared host.' }
        }
        if ($Mode -eq 'live' -and ($uri.IsLoopback -or -not $metadata.explicitAppId -or -not $metadata.botId)) {
            throw 'Live Teams packaging requires an approved reachable shared HTTPS origin and explicit package/bot IDs in the configuration.'
        }
        if ($LocalPort -eq 0) {
            $LocalPort = if ($uri.IsLoopback) { $uri.Port } elseif ($metadata.port) { [int] $metadata.port } else { 3978 }
        }
        if ($LocalPort -lt 1 -or $LocalPort -gt 65535) { throw 'The local listener port is invalid.' }
        if ($CertificatePath -and $LocalPort -ne $uri.Port) { throw 'The direct HTTPS listener port must match the manifest origin port.' }
        if (-not $SkipBuild) {
            Write-Host '[1/4 and 2/4] Building and testing the runtime and Teams installation ZIPs...'
            $buildArguments = @('run', 'teams:release', '--', '--mode', $Mode, '--origin', $Origin, '--app-id', $metadata.appId)
            if ($Mode -eq 'live') { $buildArguments += @('--bot-id', $metadata.botId) }
            if ($uri.IsLoopback) { $buildArguments += '--development' }
            Invoke-CheckedCommand -Command npm -Arguments $buildArguments
        } else { Write-Host '[1/4 and 2/4] Reusing explicit verified archives (-SkipBuild).' }
        if (-not $RuntimeArchive) { $RuntimeArchive = Join-Path $repositoryRoot 'release-teams\TLC-Assist-Teams-runtime-win32-x64.zip' }
        if (-not $TeamsArchive) {
            $filename = if ($uri.IsLoopback) { 'TLC-Assist-Teams-development.zip' } elseif ($Mode -eq 'live') { 'TLC-Assist-Teams.zip' } else { 'TLC-Assist-Teams-sample.zip' }
            $TeamsArchive = Join-Path $repositoryRoot "release-teams\$filename"
        }
        $RuntimeArchive = (Resolve-Path -LiteralPath $RuntimeArchive).Path
        $TeamsArchive = (Resolve-Path -LiteralPath $TeamsArchive).Path
        $checkPackage = @'
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { validateTeamsManifestCapabilities } from './scripts/package-teams.mjs';
const zip = await JSZip.loadAsync(await readFile(process.argv[1]), { checkCRC32: true });
if (Object.keys(zip.files).sort().join(',') !== 'color.png,manifest.json,outline.png') throw new Error('Teams ZIP must have exactly three root files.');
const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
validateTeamsManifestCapabilities(manifest);
const origin = process.argv[2];
const urls = [manifest.developer.websiteUrl, manifest.developer.privacyUrl, manifest.developer.termsOfUseUrl, ...manifest.staticTabs.flatMap((tab) => [tab.contentUrl, tab.websiteUrl]), ...manifest.configurableTabs.map((tab) => tab.configurationUrl)];
if (urls.some((url) => new URL(url).origin !== origin) || manifest.validDomains.length !== 1 || manifest.validDomains[0] !== new URL(origin).hostname) throw new Error('The Teams ZIP URLs/domains do not match the runtime origin. Rebuild the correct package.');
if (manifest.id !== process.argv[3] || Boolean(manifest.bots?.length) !== (process.argv[4] === 'live')) throw new Error('The Teams ZIP identity/data mode does not match this run.');
'@
        Invoke-CheckedCommand -Command $node -Arguments @('--input-type=module', '--eval', $checkPackage, $TeamsArchive, $Origin, $metadata.appId, $Mode)
        Write-Host '[3/4] Extracting and configuring the local runtime...'
        $runId = [Guid]::NewGuid().ToString('N')
        $runtimeDirectory = Join-Path $WorkDirectory "releases\$runId"
        New-Item -ItemType Directory -Path $runtimeDirectory | Out-Null
        Expand-Archive -LiteralPath $RuntimeArchive -DestinationPath $runtimeDirectory
        foreach ($file in @('server.js', 'package.json', 'client\index.html', '.generated-teams-runtime')) {
            if (-not (Test-Path -LiteralPath (Join-Path $runtimeDirectory $file) -PathType Leaf)) { throw "The runtime ZIP lacks required entry $file." }
        }
        if ((Get-Content -LiteralPath (Join-Path $runtimeDirectory '.generated-teams-runtime') -Raw) -ne 'TLC_TEAMS_GENERATED_RUNTIME') { throw 'The archive is not an owned Teams runtime release.' }
        Set-Content -LiteralPath (Join-Path $runtimeDirectory '.runner-owner') -Value $runId -NoNewline
        Stop-OwnedRun
        if (@(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
            throw "Port $LocalPort is already owned by another process. Stop it yourself or select -LocalPort; this script will not kill it."
        }
        $runEnvironment = @{}
        foreach ($name in $metadata.paths.Keys) { $runEnvironment[$name] = $metadata.paths[$name] }
        $runEnvironment['TLC_TEAMS_MODE'] = $Mode
        $runEnvironment['TLC_TEAMS_RUNTIME_PROFILE'] = 'local'
        $runEnvironment['TLC_TEAMS_ORIGIN'] = $Origin
        $runEnvironment['TLC_TEAMS_HOST'] = '127.0.0.1'
        $runEnvironment['TLC_TEAMS_PORT'] = [string] $LocalPort
        if (-not $runEnvironment.ContainsKey('TLC_TEAMS_DATA_DIR')) { $runEnvironment['TLC_TEAMS_DATA_DIR'] = Join-Path $WorkDirectory "data\$Mode" }
        if ($CertificatePath) {
            $runEnvironment['TLC_TEAMS_TLS_CERT_PATH'] = $CertificatePath
            $runEnvironment['TLC_TEAMS_TLS_KEY_PATH'] = $PrivateKeyPath
        }
        $logs = Join-Path $WorkDirectory "logs\$runId"
        New-Item -ItemType Directory -Path $logs -Force | Out-Null
        $arguments = @('--experimental-sqlite')
        if ($ConfigPath) { $arguments += "--env-file=`"$ConfigPath`"" }
        $arguments += "`"$(Join-Path $runtimeDirectory 'server.js')`""
        $started = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $runtimeDirectory -Environment $runEnvironment -PassThru -RedirectStandardOutput (Join-Path $logs 'stdout.log') -RedirectStandardError (Join-Path $logs 'stderr.log') -WindowStyle Hidden
        @{
            pid = $started.Id; startTimeUtc = $started.StartTime.ToUniversalTime().ToString('o')
            runId = $runId; runtimeDirectory = $runtimeDirectory; origin = $Origin; mode = $Mode; logs = $logs
        } | ConvertTo-Json | Set-Content -LiteralPath $recordPath
        try {
            $localOrigin = if ($CertificatePath) { $Origin } else { "http://127.0.0.1:$LocalPort" }
            $ready = $false
            for ($attempt = 0; $attempt -lt 30; $attempt++) {
                if ($started.HasExited) { throw "The runtime exited. Check the privacy-safe logs in $logs." }
                try { Test-TeamsEndpoint -Base $localOrigin -ExpectedMode $Mode; $ready = $true; break }
                catch { if ($attempt -eq 29) { throw }; Start-Sleep -Seconds 1 }
            }
            if (-not $ready) { throw 'The local runtime did not become ready.' }
            Test-TeamsEndpoint -Base $Origin -ExpectedMode $Mode
            if ($Mode -eq 'live') {
                $anonymous = Invoke-WebRequest -Uri "$Origin/api/teams/session" -TimeoutSec 10 -MaximumRedirection 0 -SkipHttpErrorCheck
                if ($anonymous.StatusCode -ne 401) { throw 'The live host must reject an unauthenticated session with 401.' }
            }
        } catch {
            if (-not $started.HasExited) { Stop-Process -Id $started.Id }
            Remove-Item -LiteralPath $recordPath
            throw [InvalidOperationException]::new("HTTPS/runtime verification failed; no Teams upload was attempted. Verify trusted certificates, origin and approved ingress. Logs: $logs", $_.Exception)
        }
        Write-Host "Runtime ready at $Origin ($Mode). Logs: $logs"
        Write-Host "Stop with: pwsh -File `"$PSCommandPath`" -Stop -WorkDirectory `"$WorkDirectory`""
        if ($SkipTeamsUpload) { Write-Host '[4/4] Teams upload skipped explicitly (-SkipTeamsUpload).'; return }
        Write-Host '[4/4] Uploading/installing the Teams package for your signed-in account. Sign-in/consent or tenant policy may require your interaction.'
        try {
            if (Get-Command atk -ErrorAction SilentlyContinue) {
                Invoke-CheckedCommand -Command atk -Arguments @('install', '--file-path', $TeamsArchive, '--scope', 'Personal', '--interactive', 'true', '--telemetry', 'false')
            } else {
                Invoke-CheckedCommand -Command npm -Arguments @('exec', '--yes', '--ignore-scripts', '--package=@microsoft/m365agentstoolkit-cli@1.1.18', '--', 'atk', 'install', '--file-path', $TeamsArchive, '--scope', 'Personal', '--interactive', 'true', '--telemetry', 'false')
            }
        } catch {
            Write-Warning 'Teams upload/install failed or was declined. The verified runtime remains running; use this script with -Stop when finished.'
            throw
        }
        Write-Host 'Teams upload/install completed. Actual Teams rendering and live source authorization still require client verification.'
    } finally { Pop-Location }
} finally { $lock.Dispose() }
