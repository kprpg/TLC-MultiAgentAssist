#requires -Version 7.4

function Get-OwnedTeamsRun {
    param([string] $WorkDirectory, [switch] $AllowStopped)
    $recordPath = Join-Path $WorkDirectory 'current-run.json'
    if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) { throw 'No launcher run is recorded here. Start run-teams-local.ps1 with this work directory first.' }
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $releaseRoot = [IO.Path]::GetFullPath((Join-Path $WorkDirectory 'releases')) + [IO.Path]::DirectorySeparatorChar
    $directory = [IO.Path]::GetFullPath([string] $record.runtimeDirectory)
    if (-not $directory.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing an unowned runtime directory.' }
    $marker = Join-Path $directory '.runner-owner'
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $record.runId) {
        throw 'The runtime has no matching runner ownership marker.'
    }
    $processId = [int] $record.pid
    if ($processId -lt 1) { throw 'The recorded runtime PID is invalid.' }
    $running = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($running) {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
        $expectedServer = Join-Path $directory 'server.js'
        $recordedStart = ([DateTimeOffset] $record.startTimeUtc).UtcDateTime
        if ($running.StartTime.ToUniversalTime().Ticks -ne $recordedStart.Ticks -or -not $processInfo.CommandLine -or
            -not $processInfo.CommandLine.Contains($expectedServer, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing a reused PID or an unrelated Node process.'
        }
    } elseif (-not $AllowStopped) { throw "The recorded backend is not running. Start the launcher normally to rebuild/restart it. Record: $recordPath" }
    return [pscustomobject]@{ Record = $record; Process = $running }
}

function Write-TeamsRunRecord {
    param([string] $WorkDirectory, [object] $Record)
    $temporary = Join-Path $WorkDirectory "current-run.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $Record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary
        Move-Item -LiteralPath $temporary -Destination (Join-Path $WorkDirectory 'current-run.json') -Force
    } finally { if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath $temporary } }
}

function Read-TeamsLaunchStatus {
    param([object] $Record)
    foreach ($property in @('clientBuildId', 'packageId', 'packageVersion', 'teamsArchive', 'teamsArchiveSha256', 'installation')) {
        if (-not $Record.PSObject.Properties[$property]) { throw 'This run predates guided verification. Start the launcher normally once to rebuild it; -Stop still supports older runs.' }
    }
    $response = Invoke-WebRequest -Uri "$($Record.origin)/api/teams/launch" -TimeoutSec 10 -MaximumRedirection 0
    $status = $response.Content | ConvertFrom-Json
    if ($response.StatusCode -ne 200 -or $status.contractVersion -ne '1.0' -or
        $status.runId -ne $Record.runId -or $status.clientBuildId -ne $Record.clientBuildId -or
        $status.packageId -ne $Record.packageId -or $status.packageVersion -ne $Record.packageVersion -or
        $status.origin -ne $Record.origin -or $status.mode -ne $Record.mode -or $status.authentication -ne $Record.authentication -or
        -not $status.PSObject.Properties['clients']) {
        throw 'The HTTPS endpoint is not this exact backend run, client build, app identity and profile. Do not pair it.'
    }
    return $status
}

function Invoke-TeamsRunOwner {
    param([string] $WorkDirectory, [string] $Action, [string] $UserCode)
    $arguments = @{ Action = $Action; WorkDirectory = $WorkDirectory; PassThru = $true }
    if ($UserCode) { $arguments.UserCode = $UserCode }
    return & (Join-Path $PSScriptRoot 'teams-local-connection.ps1') @arguments
}

function Get-TeamsRunStatus {
    param([string] $WorkDirectory)
    $record = (Get-OwnedTeamsRun -WorkDirectory $WorkDirectory).Record
    $status = Read-TeamsLaunchStatus -Record $record
    $native = $record.authentication -in @('local-interactive', 'local-azure-cli')
    $source = if ($record.mode -eq 'sample') { 'not-required' } elseif ($native) {
        $owner = Invoke-TeamsRunOwner -WorkDirectory $WorkDirectory -Action Status
        if ($owner.status.state -eq 'connected' -and @($owner.status.resources | Where-Object { $_.resource -eq 'msx' -and $_.state -eq 'connected' }).Count -gt 0) { 'connected' }
        elseif ($owner.status.state -eq 'connected') { 'msx-not-connected' }
        else { $owner.status.state }
    } else { 'delegated-session-only' }
    $clients = @($status.clients | Where-Object {
        $_.host -eq 'teams' -and ([DateTimeOffset] $_.checkedAt).UtcDateTime -gt [DateTime]::UtcNow.AddSeconds(-30) -and
        (-not $native -or ($_.PSObject.Properties['pairingCode'] -and
            (-not $record.pairingCode -or $_.pairingCode -eq $record.pairingCode)))
    })
    $installed = $record.installation -in @('command-succeeded', 'manually-confirmed', 'verified')
    return [pscustomobject]@{
        Backend = 'ready'; Origin = $record.origin; Mode = $record.mode; Authentication = $record.authentication
        RunId = $record.runId; ClientBuild = $record.clientBuildId; AppVersion = $record.packageVersion
        Installation = $record.installation; Source = $source; TeamsClient = $(if ($clients.Count) { 'verified' } else { 'waiting' })
        Ready = ($installed -and $clients.Count -gt 0 -and (-not $native -or $source -eq 'connected'))
        CheckedAt = [DateTime]::UtcNow.ToString('o'); Logs = $record.logs
    }
}

function Show-TeamsRunStatus {
    param([object] $Status)
    $Status | Format-List Backend, Origin, Mode, Authentication, AppVersion, RunId, ClientBuild, Installation, Source, TeamsClient, Ready, CheckedAt, Logs | Out-Host
    if (-not $Status.Ready) { Write-Warning 'Setup is incomplete. Keep Teams open and use -Resume with the same work directory; this does not restart the backend.' }
}

function Install-TeamsRunClient {
    param([string] $WorkDirectory, [object] $Record, [switch] $NoGuide, [switch] $Reinstall)
    $packageRoot = [IO.Path]::GetFullPath((Join-Path $WorkDirectory "packages\$($Record.runId)")) + [IO.Path]::DirectorySeparatorChar
    $archive = [IO.Path]::GetFullPath([string] $Record.teamsArchive)
    if (-not $archive.StartsWith($packageRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $archive -PathType Leaf) -or
        (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $Record.teamsArchiveSha256) {
        throw 'The recorded Teams installation ZIP is missing, changed or outside this run. Rebuild normally; do not upload an unverified ZIP.'
    }
    if (-not $Reinstall -and $Record.installation -in @('command-succeeded', 'manually-confirmed', 'verified')) {
        Write-Host 'Reusing this run''s recorded installation. Use -Resume -Reinstall to upload the exact package again.'
        return
    }
    while ($true) {
        try {
            Write-Host "[4/7] Installing/updating Teams personal app version $($Record.packageVersion). Exact ZIP: $archive"
            $installArguments = @('install', '--file-path', $archive, '--scope', 'Personal', '--interactive', 'false', '--telemetry', 'false')
            if (Get-Command atk -ErrorAction SilentlyContinue) {
                & atk @installArguments | Out-Host
            } else {
                $npmArguments = @('exec', '--yes', '--ignore-scripts', '--package=@microsoft/m365agentstoolkit-cli@1.1.18', '--', 'atk') + $installArguments
                & npm @npmArguments | Out-Host
            }
            if ($LASTEXITCODE -ne 0) { throw "Teams install failed with exit code $LASTEXITCODE." }
            $Record.installation = 'command-succeeded'
            Write-TeamsRunRecord -WorkDirectory $WorkDirectory -Record $Record
            return
        } catch {
            $Record.installation = 'failed'
            Write-TeamsRunRecord -WorkDirectory $WorkDirectory -Record $Record
            Write-Warning "Teams upload/install did not complete. The verified backend remains running. $($_.Exception.Message)"
            if ($NoGuide) { throw }
            Write-Host "Manual route: Teams > Apps > Manage your apps > Upload an app > Upload a custom app. Select ONLY: $archive"
            switch ((Read-Host 'R = retry installation, M = use manual upload, Q/Enter = pause and resume later').Trim().ToUpperInvariant()) {
                'R' { continue }
                'M' {
                    Start-Process -FilePath (Split-Path -Parent $archive)
                    if ((Read-Host 'After Teams accepts that exact ZIP, type INSTALLED; anything else pauses setup').Trim() -cne 'INSTALLED') {
                        throw 'Setup paused before installation confirmation. The backend is still running; use -Resume.'
                    }
                    $Record.installation = 'manually-confirmed'
                    Write-TeamsRunRecord -WorkDirectory $WorkDirectory -Record $Record
                    return
                }
                default { throw 'Setup paused: Teams installation is incomplete. The backend is still running; use -Resume.' }
            }
        }
    }
}

function Complete-TeamsRunSetup {
    param([string] $WorkDirectory, [switch] $NoGuide, [switch] $Reinstall, [int] $ClientTimeoutSeconds = 120)
    $record = (Get-OwnedTeamsRun -WorkDirectory $WorkDirectory).Record
    Read-TeamsLaunchStatus -Record $record | Out-Null
    Install-TeamsRunClient -WorkDirectory $WorkDirectory -Record $record -NoGuide:$NoGuide -Reinstall:$Reinstall
    if ($NoGuide) {
        Write-Host 'Teams upload/install command completed. Rendering, source connection and page pairing are NOT verified (-NoGuide). Use -Resume to finish.'
        return
    }
    $initial = Get-TeamsRunStatus -WorkDirectory $WorkDirectory
    if ($initial.Ready) {
        $record.setup = 'complete'; $record.installation = 'verified'; $record.verifiedAt = [DateTime]::UtcNow.ToString('o')
        Write-TeamsRunRecord -WorkDirectory $WorkDirectory -Record $record
        $initial.Installation = 'verified'
        Show-TeamsRunStatus -Status $initial
        Write-Host 'VERIFIED: the matching Teams client and backend are already connected.'
        return
    }
    $link = "https://teams.microsoft.com/l/entity/$($record.packageId)/tlc-personal?webjoin=true"
    Write-Host "[5/7] Opening the installed TLC personal app in Teams: $link"
    Write-Host "Expected backend: $($record.origin). App version: $($record.packageVersion). Backend run: $($record.runId)."
    Start-Process -FilePath $link
    $native = $record.authentication -in @('local-interactive', 'local-azure-cli')
    if ($native) {
        if ($initial.Source -ne 'connected') {
            Write-Host '[6/7] Explicit source connection. This verifies your own MSX identity; it does not write source records.'
            if ((Read-Host 'Type CONNECT to connect this backend using your own account; anything else pauses setup').Trim() -cne 'CONNECT') {
                throw 'Setup paused before source connection. The backend is still running; use -Resume when ready.'
            }
            $owner = Invoke-TeamsRunOwner -WorkDirectory $WorkDirectory -Action Connect
            if ($owner.status.state -ne 'connected' -or @($owner.status.resources | Where-Object { $_.resource -eq 'msx' -and $_.state -eq 'connected' }).Count -eq 0) {
                throw 'MSX connection was not verified. Check CLI login/native consent and source permissions, then use -Resume.'
            }
        } else { Write-Host '[6/7] The protected owner confirms MSX is already connected; no reconnect was attempted.' }
        Write-Host 'In the Teams app select Request local pairing if not already connected. Expand Backend connection and check the expected backend/run above.'
        if ($record.pairingCode) { Write-Host 'If the existing Teams page is already connected, press Enter to verify its fresh acknowledgement instead of pairing it again.' }
        $code = (Read-Host 'Enter the exact eight-character pairing code displayed INSIDE Teams (Enter = check a previously paired page; Q = pause)').Trim().ToUpperInvariant()
        if (-not $code -and $record.pairingCode) {
            Write-Host 'Checking the previously approved page. No new pairing approval was sent.'
        } else {
            if ($code -notmatch '^[A-F0-9]{8}$') { throw 'No valid page code was approved. Setup is incomplete; use -Resume and enter the exact Teams code.' }
            Invoke-TeamsRunOwner -WorkDirectory $WorkDirectory -Action Approve -UserCode $code | Out-Null
            $record.pairingCode = $code
        }
        $record.setup = 'waiting-for-client'
        Write-TeamsRunRecord -WorkDirectory $WorkDirectory -Record $record
    } else {
        Write-Host '[6/7] Keep the app open inside Teams. For hosted Live, complete corporate sign-in in that app.'
    }
    Write-Host '[7/7] Waiting for the matching, visible Teams client to acknowledge this exact backend and build...'
    $deadline = [DateTime]::UtcNow.AddSeconds($ClientTimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $current = Read-TeamsLaunchStatus -Record $record
        $matched = @($current.clients | Where-Object {
            $_.host -eq 'teams' -and ([DateTimeOffset] $_.checkedAt).UtcDateTime -gt [DateTime]::UtcNow.AddSeconds(-30) -and
            (-not $native -or ($_.PSObject.Properties['pairingCode'] -and $_.pairingCode -eq $record.pairingCode))
        })
        if ($matched.Count -gt 0) {
            $status = Get-TeamsRunStatus -WorkDirectory $WorkDirectory
            if ($status.Ready) {
                $record.setup = 'complete'; $record.installation = 'verified'
                $record.verifiedAt = [DateTime]::UtcNow.ToString('o')
                Write-TeamsRunRecord -WorkDirectory $WorkDirectory -Record $record
                $status.Installation = 'verified'
                Show-TeamsRunStatus -Status $status
                Write-Host 'VERIFIED: the latest packaged Teams client is connected to this exact backend. No MSX source write was performed by setup.'
                return
            }
        }
        Start-Sleep -Seconds 2
    }
    throw "Setup is incomplete: no matching Teams client acknowledged within $ClientTimeoutSeconds seconds. A browser preview or approved code alone does not count. Keep the Teams app visible, inspect its Backend connection/error, then use -Resume (or -Resume -Reinstall for a stale app). Backend retained. Logs: $($record.logs)"
}
