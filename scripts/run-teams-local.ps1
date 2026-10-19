#requires -Version 7.4
<#
.SYNOPSIS
Rebuild both Teams ZIPs, run the extracted local runtime, verify HTTPS, and sideload the app.
.DESCRIPTION
Uses existing approved HTTPS ingress, or a supplied trusted PEM certificate/key for localhost.
Does not create tunnels, trust certificates, change networking, or provision Azure resources.
Without -Mode, offers a Sample/Live menu. Live defaults to the current Azure CLI user with
explicitly reviewed MSX writes; -CliWriteMode read-only retains the read-only profile.
Origin defaults to the configured TLC_TEAMS_ORIGIN or https://localhost:3978.
Stop a runtime started by this script using the same file with -Stop.
#>
[CmdletBinding(DefaultParameterSetName = 'Run')]
param(
    [Parameter(ParameterSetName = 'Run')]
    [string] $Origin,
    [Parameter(ParameterSetName = 'Run')]
    [string] $ConfigPath,
    [Parameter(ParameterSetName = 'Run')]
    [ValidateSet('sample', 'live')]
    [string] $Mode,
    [Parameter(ParameterSetName = 'Run')]
    [ValidateSet('hosted-obo', 'local-interactive', 'local-azure-cli')]
    [string] $AuthMode,
    [Parameter(ParameterSetName = 'Run')]
    [ValidateSet('read-only', 'reviewed')]
    [string] $CliWriteMode,
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
    [string] $WorkDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'TLC-Assist\Teams\launcher-cli')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
$teamsRoot = Join-Path $localAppData 'TLC-Assist\Teams'

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

if (-not $Stop) {
    if (-not $SkipBuild -and ($RuntimeArchive -or $TeamsArchive)) { throw 'Explicit archive overrides require -SkipBuild. A normal run must use its newly rebuilt ZIPs.' }
    if ($Mode) { $Mode = $Mode.ToLowerInvariant() }
    if (-not $Mode) {
        Write-Host 'TLC Assist for Teams'
        Write-Host '  1. Sample - sanitized local data, no source sign-in'
        Write-Host '  2. Live - current Azure CLI user; MSX changes require review and approval'
        switch ((Read-Host 'Select mode [1/2, Enter = Sample]').Trim().ToLowerInvariant()) {
            { $_ -in @('', '1', 's', 'sample') } { $Mode = 'sample'; break }
            { $_ -in @('2', 'l', 'live') } { $Mode = 'live'; break }
            default { throw 'Select Sample (1) or Live (2), or rerun with -Mode sample or -Mode live.' }
        }
    }
    if (-not $ConfigPath -and $Mode -eq 'live') {
        $defaultConfig = Join-Path $teamsRoot 'configuration\cli.env'
        if (Test-Path -LiteralPath $defaultConfig -PathType Leaf) { $ConfigPath = $defaultConfig }
    }
    $node = (Get-Command node -ErrorAction Stop).Source
    Get-Command npm -ErrorAction Stop | Out-Null
    if ($ConfigPath) { $ConfigPath = (Resolve-Path -LiteralPath $ConfigPath -ErrorAction Stop).Path }
    $inspectConfiguration = @'
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
try {
  const values = process.argv[1] ? parseEnv(await readFile(process.argv[1], 'utf8')) : {};
  const environment = { ...process.env, ...values };
  const paths = {};
  for (const name of ['TLC_FOUNDRY_ENV_FILE', 'TLC_TEAMS_DISCLOSURE_POLICY', 'TLC_MCEM_GUIDANCE_PATH', 'TLC_TEAMS_STATE_PATH', 'TLC_TEAMS_SAMPLE_PATH', 'TLC_TEAMS_DATA_DIR', 'TLC_TEAMS_OWNER_DIRECTORY', 'TLC_TEAMS_TLS_CERT_PATH', 'TLC_TEAMS_TLS_KEY_PATH']) {
    if (environment[name]) paths[name] = environment[name] === ':memory:' ? ':memory:' : resolve(process.argv[2], environment[name]);
  }
  console.log(JSON.stringify({
    origin: environment.TLC_TEAMS_ORIGIN ?? '',
    authentication: environment.TLC_TEAMS_AUTH_MODE ?? '',
    writeMode: environment.TLC_TEAMS_CLI_WRITE_MODE ?? '',
    appId: environment.TLC_TEAMS_PACKAGE_ID ?? '8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b',
    explicitAppId: Boolean(environment.TLC_TEAMS_PACKAGE_ID), botId: environment.TLC_TEAMS_BOT_CLIENT_ID ?? '',
    port: environment.TLC_TEAMS_PORT ?? '', paths
  }));
} catch { console.error('The private runtime configuration could not be read or parsed.'); process.exitCode = 1; }
'@
    $metadataText = & $node --input-type=module --eval $inspectConfiguration ([string] $ConfigPath) $repositoryRoot
    if ($LASTEXITCODE -ne 0) { throw 'Runtime configuration inspection failed. No credentials were printed.' }
    $metadata = ($metadataText -join "`n") | ConvertFrom-Json -AsHashtable
    if (-not $AuthMode) {
        $AuthMode = if ($Mode -eq 'sample') { 'hosted-obo' } elseif ($metadata.authentication) { $metadata.authentication } else { 'local-azure-cli' }
    }
    if ($AuthMode -notin @('hosted-obo', 'local-interactive', 'local-azure-cli')) { throw 'Select a supported authentication strategy.' }
    $AuthMode = $AuthMode.ToLowerInvariant()
    if ($Mode -eq 'live' -and $AuthMode -in @('local-interactive', 'local-azure-cli') -and -not $ConfigPath) {
        throw "Live local Teams requires a configured environment file. Copy apps\teams\.env.cli.example to '$teamsRoot\configuration\cli.env', fill in the approved tenant/source coordinates, or supply -ConfigPath. Startup never signs in automatically."
    }
    if ($AuthMode -eq 'local-azure-cli') {
        if (-not $CliWriteMode) { $CliWriteMode = if ($metadata.writeMode) { $metadata.writeMode } else { 'reviewed' } }
        if ($CliWriteMode -notin @('read-only', 'reviewed')) { throw 'TLC_TEAMS_CLI_WRITE_MODE must be read-only or reviewed.' }
        $CliWriteMode = $CliWriteMode.ToLowerInvariant()
    } elseif ($CliWriteMode) { throw '-CliWriteMode applies only to the live local-azure-cli profile.' }
    if (-not $Origin) {
        $defaultPort = if ($LocalPort) { $LocalPort } elseif ($metadata.port) { [int] $metadata.port } else { 3978 }
        $Origin = if ($metadata.origin) { $metadata.origin } else { "https://localhost:$defaultPort" }
    }
    $uri = [Uri] $Origin
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or
        $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment) { throw 'Origin must be an exact HTTPS origin, with no path, query or credentials.' }
    $Origin = $uri.GetLeftPart([UriPartial]::Authority)
    if ($uri.DnsSafeHost -match '(^|\.)(example\.(com|net|org)|example|test|invalid)$') {
        throw 'Replace the template origin with your actual approved HTTPS host.'
    }
    if ($AuthMode -eq 'local-interactive' -and -not $PSBoundParameters.ContainsKey('WorkDirectory')) {
        $WorkDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'TLC-Assist\Teams\launcher-native'
    }
}
$WorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
$recordPath = Join-Path $WorkDirectory 'current-run.json'

if ($AuthMode -in @('local-interactive', 'local-azure-cli') -or -not $PSBoundParameters.ContainsKey('WorkDirectory')) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $base = [IO.Path]::GetFullPath([Environment]::GetFolderPath('LocalApplicationData'))
    $prefix = $base.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $WorkDirectory.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Native work directories must be inside this user''s LocalAppData, not shared folders.' }
    if (-not (Test-Path -LiteralPath $WorkDirectory)) {
        [IO.Directory]::CreateDirectory((Split-Path -Parent $WorkDirectory)) | Out-Null
        New-Item -ItemType Directory -Path $WorkDirectory | Out-Null
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
        }
        Set-Acl -LiteralPath $WorkDirectory -AclObject $acl
    }
    $acl = Get-Acl -LiteralPath $WorkDirectory
    if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or
        (Get-Item -LiteralPath $WorkDirectory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Native mode needs a fresh owner/SYSTEM-only work directory, not an existing shared or inherited-ACL folder.'
    }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid.Value, 'S-1-5-18')) {
            throw 'Native work directory access must be limited to the owner and SYSTEM.'
        }
    }
    $trusted = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544', 'S-1-3-0')
    $write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    $parent = (Get-Item -LiteralPath $WorkDirectory -Force).Parent
    while ($parent -and ($parent.FullName -eq $base -or $parent.FullName.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase))) {
        if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Native work directory ancestors cannot be reparse points.' }
        $parentAcl = Get-Acl -LiteralPath $parent.FullName
        if ($parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'Native work directory has an untrusted parent.' }
        foreach ($rule in $parentAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted -and ($rule.FileSystemRights -band $write)) { throw 'Another Windows user can replace a native work directory ancestor.' }
        }
        $parent = $parent.Parent
    }
}
New-Item -ItemType Directory -Path $WorkDirectory -Force | Out-Null
$lock = [IO.File]::Open((Join-Path $WorkDirectory 'runner.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    if ($Stop) { Stop-OwnedRun; return }
    Push-Location -LiteralPath $repositoryRoot
    try {
        $native = $AuthMode -in @('local-interactive', 'local-azure-cli')
        if ($native -and ($Mode -ne 'live' -or -not $uri.IsLoopback -or -not $ConfigPath -or -not $metadata.explicitAppId)) {
            throw 'Local Teams needs explicit live mode, a configuration with explicit package/tenant/source coordinates, and loopback HTTPS.'
        }
        if (-not $CertificatePath -and $metadata.paths.ContainsKey('TLC_TEAMS_TLS_CERT_PATH')) { $CertificatePath = $metadata.paths.TLC_TEAMS_TLS_CERT_PATH }
        if (-not $PrivateKeyPath -and $metadata.paths.ContainsKey('TLC_TEAMS_TLS_KEY_PATH')) { $PrivateKeyPath = $metadata.paths.TLC_TEAMS_TLS_KEY_PATH }
        if ($uri.IsLoopback -and -not $CertificatePath -and -not $PrivateKeyPath) {
            $defaultCertificate = Join-Path $teamsRoot 'certs\localhost.pem'
            $defaultPrivateKey = Join-Path $teamsRoot 'certs\localhost-key.pem'
            if ((Test-Path -LiteralPath $defaultCertificate -PathType Leaf) -and (Test-Path -LiteralPath $defaultPrivateKey -PathType Leaf)) {
                $CertificatePath = $defaultCertificate
                $PrivateKeyPath = $defaultPrivateKey
            }
        }
        if ([bool] $CertificatePath -ne [bool] $PrivateKeyPath) { throw 'Supply both the TLS certificate and private key paths.' }
        if ($uri.IsLoopback -and -not $CertificatePath) {
            throw "HTTPS localhost requires a trusted TLS certificate and key. Supply -CertificatePath/-PrivateKeyPath, configure their environment paths, or prepare '$teamsRoot\certs\localhost.pem' and 'localhost-key.pem'. See docs\runbooks\teams-app.md for the one-time setup. An HTTP-only server produces a blank Teams window."
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
        if ($Mode -eq 'live' -and -not $native -and ($uri.IsLoopback -or -not $metadata.explicitAppId -or -not $metadata.botId)) {
            throw 'Live Teams packaging requires an approved reachable shared HTTPS origin and explicit package/bot IDs in the configuration.'
        }
        if ($LocalPort -eq 0) {
            $LocalPort = if ($uri.IsLoopback) { $uri.Port } elseif ($metadata.port) { [int] $metadata.port } else { 3978 }
        }
        if ($LocalPort -lt 1 -or $LocalPort -gt 65535) { throw 'The local listener port is invalid.' }
        if ($CertificatePath -and $LocalPort -ne $uri.Port) { throw 'The direct HTTPS listener port must match the manifest origin port.' }
        Write-Host "Starting Teams in $Mode mode at $Origin ($AuthMode)."
        if ($AuthMode -eq 'local-azure-cli') { Write-Host "CLI source write mode: $CliWriteMode. Every MSX change requires explicit review and approval; source permissions remain enforced." }
        if (-not $SkipBuild) {
            Write-Host '[1/4 and 2/4] Building and testing the runtime and Teams installation ZIPs...'
            $buildArguments = @('run', 'teams:release', '--', '--mode', $Mode, '--origin', $Origin, '--app-id', $metadata.appId)
            if ($AuthMode -eq 'local-azure-cli') { $buildArguments += '--local-azure-cli' }
            elseif ($native) { $buildArguments += '--local-native' }
            elseif ($Mode -eq 'live') { $buildArguments += @('--bot-id', $metadata.botId) }
            if ($uri.IsLoopback) { $buildArguments += '--development' }
            Invoke-CheckedCommand -Command npm -Arguments $buildArguments
        } else { Write-Host '[1/4 and 2/4] Reusing explicit verified archives (-SkipBuild).' }
        if (-not $RuntimeArchive) { $RuntimeArchive = Join-Path $repositoryRoot 'release-teams\TLC-Assist-Teams-runtime-win32-x64.zip' }
        if (-not $TeamsArchive) {
            $filename = if ($native) { 'TLC-Assist-Teams-local-live.zip' } elseif ($uri.IsLoopback) { 'TLC-Assist-Teams-development.zip' } elseif ($Mode -eq 'live') { 'TLC-Assist-Teams.zip' } else { 'TLC-Assist-Teams-sample.zip' }
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
const urls = [manifest.developer.websiteUrl, manifest.developer.privacyUrl, manifest.developer.termsOfUseUrl, ...manifest.staticTabs.flatMap((tab) => [tab.contentUrl, tab.websiteUrl]), ...(manifest.configurableTabs ?? []).map((tab) => tab.configurationUrl)];
if (urls.some((url) => new URL(url).origin !== origin) || manifest.validDomains.length !== 1 || manifest.validDomains[0] !== new URL(origin).hostname) throw new Error('The Teams ZIP URLs/domains do not match the runtime origin. Rebuild the correct package.');
const native = ['local-interactive', 'local-azure-cli'].includes(process.argv[5]);
if (manifest.id !== process.argv[3] || Boolean(manifest.bots?.length) !== (process.argv[4] === 'live' && !native)) throw new Error('The Teams ZIP identity/data mode does not match this run.');
if (native && (manifest.name.short !== 'TLC Assist Local' || manifest.configurableTabs?.length || manifest.webApplicationInfo)) throw new Error('The native ZIP must declare private local source use, not unreachable shared/cloud capabilities.');
'@
        Invoke-CheckedCommand -Command $node -Arguments @('--input-type=module', '--eval', $checkPackage, $TeamsArchive, $Origin, $metadata.appId, $Mode, $AuthMode)
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
        $ownerDirectory = ''
        if ($native) {
            $ownerDirectory = if ($metadata.paths.ContainsKey('TLC_TEAMS_OWNER_DIRECTORY')) { $metadata.paths.TLC_TEAMS_OWNER_DIRECTORY } else { Join-Path $WorkDirectory 'private' }
            Invoke-CheckedCommand -Command $node -Arguments @('--experimental-sqlite', (Join-Path $runtimeDirectory 'server.js'), '--local-owner', 'prepare', $ownerDirectory)
        }
        Stop-OwnedRun
        if (@(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
            throw "Port $LocalPort is already owned by another process. Stop it yourself or select -LocalPort; this script will not kill it."
        }
        $runEnvironment = @{}
        foreach ($name in $metadata.paths.Keys) { $runEnvironment[$name] = $metadata.paths[$name] }
        $runEnvironment['TLC_TEAMS_MODE'] = $Mode
        $runEnvironment['TLC_TEAMS_AUTH_MODE'] = $AuthMode
        if ($AuthMode -eq 'local-azure-cli') { $runEnvironment['TLC_TEAMS_CLI_WRITE_MODE'] = $CliWriteMode }
        $runEnvironment['TLC_TEAMS_RUNTIME_PROFILE'] = 'local'
        $runEnvironment['TLC_TEAMS_ORIGIN'] = $Origin
        $runEnvironment['TLC_TEAMS_HOST'] = if ($native -and $uri.HostNameType -eq [UriHostNameType]::IPv6) { '::1' } else { '127.0.0.1' }
        $runEnvironment['TLC_TEAMS_PORT'] = [string] $LocalPort
        if ($native) { $runEnvironment['TLC_TEAMS_OWNER_DIRECTORY'] = $ownerDirectory }
        if (-not $runEnvironment.ContainsKey('TLC_TEAMS_DATA_DIR')) {
            $runEnvironment['TLC_TEAMS_DATA_DIR'] = if ($native) { Join-Path $ownerDirectory 'data' } else { Join-Path $WorkDirectory "data\$Mode" }
        }
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
            runId = $runId; runtimeDirectory = $runtimeDirectory; origin = $Origin; mode = $Mode; authentication = $AuthMode; ownerDirectory = $ownerDirectory; logs = $logs
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
                if ($native) {
                    $public = Invoke-WebRequest -Uri "$Origin/api/teams/config" -TimeoutSec 10 -MaximumRedirection 0
                    $publicConfiguration = $public.Content | ConvertFrom-Json
                    $expectedVersion = if ($AuthMode -eq 'local-azure-cli') { '1.2' } else { '1.0' }
                    if ($publicConfiguration.mode -ne 'live' -or $publicConfiguration.authentication -ne $AuthMode -or $publicConfiguration.contractVersion -ne $expectedVersion) {
                        throw 'The running local authentication profile does not match this launch.'
                    }
                    if ($AuthMode -eq 'local-azure-cli' -and $publicConfiguration.writeMode -ne $CliWriteMode) { throw 'The running CLI write mode does not match this launch.' }
                }
            }
        } catch {
            if (-not $started.HasExited) { Stop-Process -Id $started.Id }
            Remove-Item -LiteralPath $recordPath
            throw [InvalidOperationException]::new("HTTPS/runtime verification failed; no Teams upload was attempted. Verify trusted certificates, origin and approved ingress. Logs: $logs", $_.Exception)
        }
        Write-Host "Runtime ready at $Origin ($Mode). Logs: $logs"
        Write-Host "Stop with: pwsh -File `"$PSCommandPath`" -Stop -WorkDirectory `"$WorkDirectory`""
        if ($native) { Write-Host 'Source sign-in has NOT occurred during startup. Use teams-local-connection.ps1 -Action Connect, then approve the page code yourself. No MSX records are read or modified by this launcher.' }
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
