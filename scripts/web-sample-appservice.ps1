# Dot-sourced by deploy-web-appservice.ps1; Azure commands and ZIP publishing share its checked helpers.
$sampleSettings = [ordered]@{
    TLC_WEB_MODE = 'sample'
    TLC_DATA_MODE = 'sample'
    TLC_DATA_STORE = 'sqlite'
    TLC_DATA_STORE_PATH = ':memory:'
    TLC_HOSTING_MODEL = 'single-instance'
    TLC_BACKGROUND_SYNC = '0'
    HOST = '0.0.0.0'
    WEBSITE_RUN_FROM_PACKAGE = '1'
    SCM_DO_BUILD_DURING_DEPLOYMENT = 'false'
    WEBSITE_SWAP_WARMUP_PING_PATH = '/api/health'
    WEBSITE_SWAP_WARMUP_PING_STATUSES = '200'
}
$releaseSetting = 'TLC_SAMPLE_RELEASE_ID'
$sampleManagedKeys = @($sampleSettings.Keys) + @($releaseSetting)

function Get-SampleTargetArguments {
    param([string] $TargetSlot)
    $arguments = @('--subscription', $SubscriptionId, '--resource-group', $ResourceGroup, '--name', $WebAppName)
    if ($TargetSlot) { $arguments += @('--slot', $TargetSlot) }
    return $arguments
}

function Get-SampleConfigurationUri {
    param([string] $TargetSlot, [string] $Configuration)
    $url = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$WebAppName"
    if ($TargetSlot) { $url += "/slots/$TargetSlot" }
    return "$url/config/${Configuration}?api-version=2022-03-01"
}

function Get-SampleArmConfiguration {
    param([string] $TargetSlot, [string] $Configuration, [string] $Query, [string] $Method = 'get')
    $url = Get-SampleConfigurationUri -TargetSlot $TargetSlot -Configuration $Configuration
    $arguments = @('rest', '--method', $Method, '--url', $url)
    if ($Query) { $arguments += @('--query', $Query) }
    return Invoke-AzJson -AsHashtable -Arguments $arguments
}

function Restore-SampleStickyNames {
    param([string[]] $ManagedNames = @())
    $configuration = Get-SampleArmConfiguration -Configuration slotConfigNames -Query properties
    $current = @($configuration['appSettingNames'] | Where-Object { $null -ne $_ })
    $expected = @($current | Where-Object { $_ -notin $sampleManagedKeys }) + $ManagedNames
    if ((@($current | Sort-Object) -join "`0") -ceq (@($expected | Sort-Object) -join "`0")) { return }
    $configuration['appSettingNames'] = @($expected | Select-Object -Unique)
    $bodyPath = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($bodyPath, (@{ properties = $configuration } | ConvertTo-Json -Depth 6))
        Invoke-CheckedCommand -Command az -Arguments @(
            'rest', '--method', 'put', '--url', (Get-SampleConfigurationUri -Configuration slotConfigNames),
            '--body', "@$bodyPath", '--output', 'none', '--only-show-errors'
        )
    }
    finally { Remove-Item -LiteralPath $bodyPath -Force }
}

function Invoke-SampleSettingsChange {
    param([string[]] $Arguments)
    $sticky = @(Get-SampleArmConfiguration -Configuration slotConfigNames -Query 'properties.appSettingNames')
    $managed = @($sticky | Where-Object { $_ -in $sampleManagedKeys })
    try { Invoke-CheckedCommand -Command az -Arguments $Arguments }
    finally { Restore-SampleStickyNames -ManagedNames $managed }
}

function Get-SampleSettings {
    param([string] $TargetSlot)
    $query = '{' + (($sampleManagedKeys | ForEach-Object { "${_}:properties.$_" }) -join ',') + '}'
    return Get-SampleArmConfiguration -TargetSlot $TargetSlot -Configuration 'appsettings/list' -Method post -Query $query
}

function Get-SampleAuth {
    param([string] $TargetSlot)
    # Inactive v2 settings can still exist on a classic-auth slot; read the active version first.
    $classic = Get-SampleArmConfiguration -TargetSlot $TargetSlot -Configuration 'authsettings/list' -Method post `
        -Query '{version:properties.configVersion,enabled:properties.enabled,unauthenticatedClientAction:properties.unauthenticatedClientAction}'
    if ($classic['version'] -notin @('v1', 'v2')) { throw 'The active App Service Authentication version could not be verified.' }
    if ($classic['version'] -eq 'v1') {
        if ($classic['enabled'] -isnot [bool]) { throw 'Classic App Service Authentication configuration could not be verified.' }
        $action = $classic['unauthenticatedClientAction']
        if ($null -ne $action -and $action -notin @('AllowAnonymous', 'RedirectToLoginPage')) { throw 'The classic authentication policy could not be verified.' }
        if ($classic['enabled'] -and $null -eq $action) { throw 'The enabled classic authentication requirement could not be verified.' }
        return @{
            version = 'v1'; enabled = $classic['enabled']
            requireAuthentication = $(if ($null -eq $action) { $null } else { $action -ne 'AllowAnonymous' })
            unauthenticatedClientAction = $action; excludedPaths = @()
        }
    }
    $auth = Get-SampleArmConfiguration -TargetSlot $TargetSlot -Configuration authsettingsV2 `
        -Query '{enabled:properties.platform.enabled,requireAuthentication:properties.globalValidation.requireAuthentication,excludedPaths:properties.globalValidation.excludedPaths}'
    if ($auth['enabled'] -isnot [bool]) { throw 'App Service Authentication configuration could not be verified.' }
    if ($auth['enabled'] -and $auth['requireAuthentication'] -isnot [bool]) { throw 'The enabled authentication requirement could not be verified.' }
    $auth['excludedPaths'] = @($auth['excludedPaths'] | Where-Object { $null -ne $_ })
    $auth['version'] = 'v2'
    return $auth
}

function Set-SampleAuthPaths {
    param([string[]] $Paths = @())
    if ((Get-SampleAuth)['version'] -eq 'v1') {
        if ($Paths.Count) { throw 'Classic Auth v1 cannot configure the health-route exclusions required for a protected slot swap.' }
        return
    }
    $json = ConvertTo-Json -InputObject @($Paths) -Compress
    Invoke-CheckedCommand -Command az -Arguments (@('webapp', 'auth', 'update') + (Get-SampleTargetArguments) +
        @('--excluded-paths', $json, '--output', 'none', '--only-show-errors'))
}

function Set-SampleAuth {
    param([string] $TargetSlot, [bool] $Enabled, [bool] $RequireAuthentication, [string] $UnauthenticatedClientAction)
    $auth = Get-SampleAuth $TargetSlot
    if ($PSBoundParameters.ContainsKey('RequireAuthentication')) {
        $classic = $auth['version'] -eq 'v1'
        $configuration = if ($classic) { 'authsettings' } else { 'authsettingsV2' }
        $readConfiguration = if ($classic) { 'authsettings/list' } else { 'authsettingsV2' }
        $method = if ($classic) { 'post' } else { 'get' }
        # Preserve provider configuration and boolean types using the active version's ARM schema.
        $properties = Get-SampleArmConfiguration -TargetSlot $TargetSlot -Configuration $readConfiguration -Method $method -Query properties
        if ($properties -isnot [System.Collections.IDictionary]) { throw 'The authentication configuration could not be preserved.' }
        if ($classic) {
            if ($UnauthenticatedClientAction -notin @('AllowAnonymous', 'RedirectToLoginPage') `
                -or $RequireAuthentication -ne ($UnauthenticatedClientAction -ne 'AllowAnonymous')) {
                throw 'Restoring classic authentication requires its recorded unauthenticated-client action.'
            }
            $properties['enabled'] = $Enabled
            $properties['unauthenticatedClientAction'] = $UnauthenticatedClientAction
        }
        else {
            if ($properties['platform'] -isnot [System.Collections.IDictionary]) { $properties['platform'] = @{} }
            if ($properties['globalValidation'] -isnot [System.Collections.IDictionary]) { $properties['globalValidation'] = @{} }
            $properties['platform']['enabled'] = $Enabled
            $properties['globalValidation']['requireAuthentication'] = $RequireAuthentication
        }
        $bodyPath = [IO.Path]::GetTempFileName()
        try {
            [IO.File]::WriteAllText($bodyPath, (@{ properties = $properties } | ConvertTo-Json -Depth 30))
            Invoke-CheckedCommand -Command az -Arguments @(
                'rest', '--method', 'put', '--url', (Get-SampleConfigurationUri -TargetSlot $TargetSlot -Configuration $configuration),
                '--body', "@$bodyPath", '--output', 'none', '--only-show-errors'
            )
        }
        finally { Remove-Item -LiteralPath $bodyPath -Force }
        return
    }
    $commandGroup = if ($auth['version'] -eq 'v1') { 'auth-classic' } else { 'auth' }
    Invoke-CheckedCommand -Command az -Arguments (@('webapp', $commandGroup, 'update') + (Get-SampleTargetArguments $TargetSlot) + @(
        '--enabled', $Enabled.ToString().ToLowerInvariant(), '--output', 'none', '--only-show-errors'
    ))
}

function Restore-SampleAuthPolicy {
    param([System.Collections.IDictionary] $Auth)
    # Receipts created before version-aware authentication recorded v2 policies only.
    $version = if ($Auth.Contains('version')) { $Auth['version'] } else { 'v2' }
    if ($version -notin @('v1', 'v2') -or (Get-SampleAuth)['version'] -ne $version) {
        throw 'The authentication version changed since promotion; refusing to migrate or replace its policy.'
    }
    $parameters = @{ Enabled = $Auth['enabled'] }
    if ($Auth['requireAuthentication'] -is [bool]) { $parameters['RequireAuthentication'] = $Auth['requireAuthentication'] }
    if ($version -eq 'v1' -and $Auth['unauthenticatedClientAction']) {
        $parameters['UnauthenticatedClientAction'] = $Auth['unauthenticatedClientAction']
    }
    Set-SampleAuth @parameters
    $restored = Get-SampleAuth
    if ($restored['enabled'] -ne $Auth['enabled'] -or $restored['requireAuthentication'] -ne $Auth['requireAuthentication']) {
        throw 'The previous authentication requirement could not be restored; live content must not be activated.'
    }
}

function Set-SampleSettings {
    param([string] $TargetSlot, [string] $ReleaseId)
    $values = @($sampleSettings.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })
    if ($ReleaseId) { $values += "$releaseSetting=$ReleaseId" }
    Invoke-SampleSettingsChange -Arguments (@('webapp', 'config', 'appsettings', 'set') +
        (Get-SampleTargetArguments $TargetSlot) + @('--settings') + $values + @('--output', 'none', '--only-show-errors'))
}

function Restore-SampleSettings {
    param([string] $TargetSlot, [System.Collections.IDictionary] $Settings)
    $values = @()
    $remove = @()
    foreach ($key in $sampleManagedKeys) {
        if ($null -eq $Settings[$key]) { $remove += $key }
        else { $values += "${key}=$($Settings[$key])" }
    }
    $targetArguments = Get-SampleTargetArguments $TargetSlot
    if ($values.Count) {
        Invoke-SampleSettingsChange -Arguments (@('webapp', 'config', 'appsettings', 'set') + $targetArguments +
            @('--settings') + $values + @('--output', 'none', '--only-show-errors'))
    }
    if ($remove.Count) {
        Invoke-SampleSettingsChange -Arguments (@('webapp', 'config', 'appsettings', 'delete') + $targetArguments +
            @('--setting-names') + $remove + @('--output', 'none', '--only-show-errors'))
    }
}

function Get-SampleSite {
    param([string] $TargetSlot)
    $app = Invoke-AzJson -AsHashtable -Arguments (@('webapp', 'show') + (Get-SampleTargetArguments $TargetSlot) + @(
        '--query', '{id:id,name:name,kind:kind,defaultHostName:defaultHostName,serverFarmId:serverFarmId,publicNetworkAccess:publicNetworkAccess,siteConfig:siteConfig}'
    ))
    if (-not $app -or $app['kind'] -notlike '*linux*') { throw 'Sample deployment requires the selected Linux App Service.' }
    if ($app['defaultHostName'] -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Azure did not return a valid App Service hostname.' }
    if ($app['publicNetworkAccess'] -eq 'Disabled') { throw 'The selected App Service disables public network access; networking was not changed.' }
    if ($app['siteConfig']['numberOfWorkers'] -ne 1) { throw 'The selected sample target must run exactly one worker.' }
    if ($app['siteConfig']['linuxFxVersion'] -notmatch '^NODE\|(\d+)(?:-lts)?$' -or [int]$Matches[1] -lt 24) {
        throw 'The SQLite sample requires an existing Node 24+ App Service runtime; the runtime was not changed.'
    }
    return $app
}

function Assert-SampleTarget {
    $account = Invoke-AzJson -AsHashtable -Arguments @('account', 'show', '--subscription', $SubscriptionId)
    if ($account['tenantId'] -ne $TenantId) { throw 'The subscription does not belong to the expected tenant.' }
    $app = Get-SampleSite
    if ($ExpectedHostName -and $app['defaultHostName'] -ne $ExpectedHostName) { throw 'The production hostname does not match the expected target.' }
    $plan = Invoke-AzJson -AsHashtable -Arguments @(
        'appservice', 'plan', 'show', '--subscription', $SubscriptionId,
        '--resource-group', $ResourceGroup, '--name', $AppServicePlan
    )
    if (-not $plan['id'] -or $app['serverFarmId'] -ne $plan['id']) { throw 'The App Service is not attached to the expected plan.' }
    if ($plan['sku']['tier'] -notmatch '^(Standard|Premium|Isolated)') { throw 'Deployment slots require a Standard, Premium or Isolated plan; no upgrade was performed.' }
    if ($plan['sku']['capacity'] -ne 1 -or $app['siteConfig']['numberOfWorkers'] -ne 1 -or $plan['elasticScaleEnabled']) {
        throw 'This process-local sample requires one worker and no elastic scaling; the shared plan was not changed.'
    }
    $sticky = @(Get-SampleArmConfiguration -Configuration slotConfigNames -Query 'properties.appSettingNames')
    if ($sticky -contains $releaseSetting) { throw "$releaseSetting must not be slot-sticky because it identifies the content being swapped." }
    return $app
}

function Get-SampleDeploymentId {
    param([string] $TargetSlot)
    $deployments = @(Get-AppServiceDeployments -TargetSlot $TargetSlot)
    $active = @($deployments | Where-Object { $_.PSObject.Properties['active'] -and $_.active })
    $deployment = if ($active.Count) { $active[0] } else { $deployments | Select-Object -First 1 }
    if (-not $deployment -or -not $deployment.id -or $deployment.status -ne 4) {
        throw "No completed deployment can be verified for '$WebAppName/$TargetSlot'."
    }
    return [string] $deployment.id
}

function Test-SampleConfiguration {
    param([string] $TargetSlot, [string] $ReleaseId)
    $settings = Get-SampleSettings $TargetSlot
    foreach ($key in $sampleSettings.Keys) {
        if ($settings[$key] -ne $sampleSettings[$key]) { throw "The sample target has an unexpected '$key' setting." }
    }
    if ($ReleaseId -and $settings[$releaseSetting] -ne $ReleaseId) { throw 'The selected slot no longer contains the recorded sample release.' }
    if ((Get-SampleAuth $TargetSlot)['enabled']) { throw 'App Service Authentication must be disabled on the public sample target.' }
}

function Test-SampleWeb {
    param([string] $TargetSlot, [switch] $AccessOnly, [bool] $Protected = $false)
    $site = Get-SampleSite $TargetSlot
    $uri = "https://$($site['defaultHostName'])"
    $arguments = @((Join-Path $PSScriptRoot 'smoke-web-release.mjs'))
    if ($AccessOnly) {
        $arguments += @('--access-url', $uri, $(if ($Protected) { '--protected' } else { '--public' }))
    } else { $arguments += @('--url', $uri) }
    for ($attempt = 1; $attempt -le $HealthAttempts; $attempt++) {
        & node @arguments
        if ($LASTEXITCODE -eq 0) { return }
        if ($attempt -eq $HealthAttempts) { throw "Anonymous access verification failed for $uri; the operation was not successful." }
        Start-Sleep -Seconds $HealthDelaySeconds
    }
}

function Save-SampleReceipt {
    param([System.Collections.IDictionary] $Receipt)
    [IO.Directory]::CreateDirectory((Split-Path -Parent $script:sampleReceiptPath)) | Out-Null
    $temporaryPath = "$script:sampleReceiptPath.tmp"
    [IO.File]::WriteAllText($temporaryPath, ($Receipt | ConvertTo-Json -Depth 10))
    Move-Item -LiteralPath $temporaryPath -Destination $script:sampleReceiptPath -Force
}

function Read-SampleReceipt {
    if (-not (Test-Path -LiteralPath $script:sampleReceiptPath -PathType Leaf)) { throw 'The deployment receipt is missing. Deploy and verify the sample slot first.' }
    $receipt = Get-Content -LiteralPath $script:sampleReceiptPath -Raw | ConvertFrom-Json -AsHashtable
    foreach ($key in @('subscription', 'tenant', 'resourceGroup', 'app', 'slot')) {
        $expected = @{ subscription = $SubscriptionId; tenant = $TenantId; resourceGroup = $ResourceGroup; app = $WebAppName; slot = $Slot }[$key]
        if ($receipt[$key] -ne $expected) { throw 'The deployment receipt does not match the exact Azure target.' }
    }
    if ($receipt['version'] -ne 1 -or $receipt['releaseId'] -notmatch '^[a-f0-9]{64}$' -or -not $receipt['deploymentId']) {
        throw 'The sample deployment receipt is invalid.'
    }
    return $receipt
}

function Invoke-SampleSwap {
    Invoke-CheckedCommand -Command az -Arguments (@('webapp', 'deployment', 'slot', 'swap') +
        (Get-SampleTargetArguments $Slot) + @('--target-slot', 'production', '--output', 'none', '--only-show-errors'))
}

function Invoke-SamplePromotion {
    param([System.Collections.IDictionary] $Receipt)
    if ($Receipt['state'] -ne 'staged') { throw 'Only a successfully staged deployment can be promoted. A new staging deploy requires a new receipt.' }
    if ((Get-SampleDeploymentId $Slot) -ne $Receipt['deploymentId']) { throw 'The staging deployment changed after verification. Redeploy before promoting.' }
    Test-SampleConfiguration -TargetSlot $Slot -ReleaseId $Receipt['releaseId']
    Test-SampleWeb -TargetSlot $Slot
    $Receipt['productionSettings'] = Get-SampleSettings
    $Receipt['productionAuth'] = Get-SampleAuth
    if ($Receipt['productionAuth']['version'] -eq 'v1' -and $Receipt['productionAuth']['enabled']) {
        throw 'Protected production promotion requires Auth v2 health-route exclusions. Classic Auth v1 was not migrated or changed.'
    }
    $Receipt['sourceSettings'] = Get-SampleSettings $Slot
    $Receipt['managedStickyNames'] = @(Get-SampleArmConfiguration -Configuration slotConfigNames -Query 'properties.appSettingNames' |
        Where-Object { $_ -in $sampleManagedKeys })
    if ($Receipt['productionSettings'][$releaseSetting] -eq $Receipt['releaseId']) { throw 'Production already has this sample release; use a new release for promotion.' }
    if (-not $PSCmdlet.ShouldProcess("$WebAppName production", 'Replace production with the verified PUBLIC ANONYMOUS SQLite SAMPLE; preserve a rollback receipt')) { return }
    $Receipt['state'] = 'promoting'
    Save-SampleReceipt $Receipt
    try {
        Set-SampleSettings
        # Only the non-sensitive health route bypasses Easy Auth while protected production warms up.
        if ($Receipt['productionAuth']['enabled']) {
            Set-SampleAuthPaths -Paths @($Receipt['productionAuth']['excludedPaths'] + '/api/health' | Select-Object -Unique)
        }
        Invoke-SampleSwap
        if ((Get-SampleSettings)[$releaseSetting] -ne $Receipt['releaseId']) { throw 'The production release marker did not follow the swapped content.' }
        $Receipt['rollbackDeploymentId'] = Get-SampleDeploymentId $Slot
        Save-SampleReceipt $Receipt
        Set-SampleAuth -Enabled $false
        Set-SampleAuthPaths -Paths $Receipt['productionAuth']['excludedPaths']
        Test-SampleConfiguration -ReleaseId $Receipt['releaseId']
        Test-SampleWeb
        $Receipt['state'] = 'promoted'
        Save-SampleReceipt $Receipt
        Write-Host 'Production is now the verified public sample demo. SQLite state resets on recycle or swap.'
    }
    catch {
        $failure = $_
        if ($Receipt['productionAuth']['enabled']) {
            Restore-SampleAuthPolicy -Auth $Receipt['productionAuth']
            if ($Receipt['productionAuth']['requireAuthentication']) { Test-SampleWeb -AccessOnly -Protected $true }
        }
        Set-SampleAuthPaths -Paths $Receipt['productionAuth']['excludedPaths']
        $Receipt['state'] = 'promotion-failed'
        Save-SampleReceipt $Receipt
        throw "Sample promotion failed; the previous authentication protection was reapplied when required. Use the retained receipt with -Action Rollback. $($failure.Exception.Message)"
    }
}

function Invoke-SampleRollback {
    param([System.Collections.IDictionary] $Receipt)
    if ($Receipt['state'] -notin @('promoted', 'promoting', 'promotion-failed', 'rolling-back')) { throw 'The receipt has no production transition to roll back.' }
    foreach ($name in @('productionSettings', 'sourceSettings', 'productionAuth')) {
        if ($Receipt[$name] -isnot [System.Collections.IDictionary]) { throw 'The rollback receipt has no verified original configuration.' }
    }
    foreach ($settings in @($Receipt['productionSettings'], $Receipt['sourceSettings'])) {
        if ($settings.Count -ne $sampleManagedKeys.Count) { throw 'The rollback receipt contains unexpected settings.' }
        foreach ($key in $sampleManagedKeys) {
            if (-not $settings.Contains($key) -or ($null -ne $settings[$key] -and $settings[$key] -isnot [string])) { throw 'The rollback settings are invalid.' }
        }
    }
    if ($Receipt['productionAuth']['enabled'] -isnot [bool]) { throw 'The original authentication policy is invalid.' }
    if (($Receipt['productionAuth']['enabled'] -and $Receipt['productionAuth']['requireAuthentication'] -isnot [bool]) `
        -or ($null -ne $Receipt['productionAuth']['requireAuthentication'] -and $Receipt['productionAuth']['requireAuthentication'] -isnot [bool])) {
        throw 'The original authentication requirement is invalid.'
    }
    if (-not $Receipt.Contains('managedStickyNames') -or @($Receipt['managedStickyNames'] | Where-Object { $_ -notin $sampleManagedKeys }).Count) {
        throw 'The original slot-sticky settings are invalid.'
    }
    $current = Get-SampleSettings
    $swapped = $current[$releaseSetting] -eq $Receipt['releaseId']
    if (-not $swapped -and $current[$releaseSetting] -ne $Receipt['productionSettings'][$releaseSetting]) { throw 'Production changed outside this workflow; refusing an unsafe rollback.' }
    if ($swapped) {
        if ((Get-SampleSettings $Slot)[$releaseSetting] -ne $Receipt['productionSettings'][$releaseSetting]) { throw 'The retained rollback slot was replaced.' }
        if ($Receipt['rollbackDeploymentId'] -and (Get-SampleDeploymentId $Slot) -ne $Receipt['rollbackDeploymentId']) { throw 'The retained rollback deployment was replaced.' }
    }
    if (-not $PSCmdlet.ShouldProcess("$WebAppName production", 'Restore prior authentication BEFORE any live content, then restore the recorded production deployment and settings')) { return }
    $Receipt['state'] = 'rolling-back'
    Save-SampleReceipt $Receipt
    if ($Receipt['productionAuth']['enabled']) {
        Restore-SampleAuthPolicy -Auth $Receipt['productionAuth']
        if ($Receipt['productionAuth']['requireAuthentication']) { Test-SampleWeb -AccessOnly -Protected $true }
    }
    if ($swapped) {
        if ($Receipt['productionAuth']['enabled']) {
            Set-SampleAuthPaths -Paths @($Receipt['productionAuth']['excludedPaths'] + '/api/health' | Select-Object -Unique)
        }
        Invoke-SampleSwap
    }
    Restore-SampleSettings -Settings $Receipt['productionSettings']
    Restore-SampleSettings -TargetSlot $Slot -Settings $Receipt['sourceSettings']
    Restore-SampleStickyNames -ManagedNames $Receipt['managedStickyNames']
    Set-SampleAuth -TargetSlot $Slot -Enabled $false
    Restore-SampleAuthPolicy -Auth $Receipt['productionAuth']
    Set-SampleAuthPaths -Paths $Receipt['productionAuth']['excludedPaths']
    $restored = Get-SampleSettings
    foreach ($key in $sampleManagedKeys) {
        if ($restored[$key] -ne $Receipt['productionSettings'][$key]) { throw "Rollback did not restore '$key'." }
    }
    $auth = Get-SampleAuth
    if ($auth['enabled'] -ne $Receipt['productionAuth']['enabled'] -or $auth['requireAuthentication'] -ne $Receipt['productionAuth']['requireAuthentication'] `
        -or ($auth['excludedPaths'] -join "`0") -cne ($Receipt['productionAuth']['excludedPaths'] -join "`0")) {
        throw 'Rollback did not restore the original authentication boundary.'
    }
    Test-SampleWeb -AccessOnly -Protected ($auth['enabled'] -and $auth['requireAuthentication'])
    $Receipt['state'] = 'rolled-back'
    Save-SampleReceipt $Receipt
    Write-Host 'Previous production content, managed settings and anonymous-access policy restored. Verify authenticated live functionality with its normal sign-in.'
}

function Invoke-SampleAppServiceWorkflow {
    if ($SkipHealthCheck) { throw 'Public sample deployments cannot skip anonymous functional verification.' }
    if ($Action -in @('Promote', 'Rollback') -and ($PackageOnly -or $ArtifactPath -or $CreateSlot -or $SkipBuild)) { throw 'Promote/Rollback do not build, accept artifacts or create slots; supply the existing receipt instead.' }
    if ($Action -eq 'Verify' -and ($PackageOnly -or $CreateSlot -or $SkipBuild)) { throw 'Verify uses the existing ZIP and slot without building, creating or deploying anything.' }
    if (-not $PackageOnly -and (-not $Slot -or $Slot -eq 'production' -or $Slot -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{0,18}$')) {
        throw 'Sample mode requires a named non-production -Slot; production is only changed by an explicit promotion.'
    }
    $script:sampleReceiptPath = if ($ReceiptPath) {
        if ([IO.Path]::IsPathRooted($ReceiptPath)) { [IO.Path]::GetFullPath($ReceiptPath) }
        else { [IO.Path]::GetFullPath((Join-Path $repositoryRoot $ReceiptPath)) }
    }
        else { Join-Path $repositoryRoot "release-web\$WebAppName-$Slot-deployment.json" }
    if ($Action -in @('Deploy', 'Verify')) {
        $path = Resolve-ArtifactPath
        if ($Action -eq 'Deploy' -and -not $SkipBuild) { Invoke-CheckedCommand -Command npm -Arguments @('run', 'web:release:sample') }
        Test-AppServiceArchive -Path $path -RequiredEntries @(
            'package.json', 'server.js', 'apps/desktop/dist/revamp/index.html',
            'docs/knowledge/MCEM Overview.pdf', 'node_modules/zod/package.json'
        )
        $releaseId = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        Write-Host "Validated sample App Service package: $path (SHA256 $releaseId)"
        if ($PackageOnly) { Write-Host 'Package-only operation completed; Azure was not contacted.'; return }
    }
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI is required; sign in as the publisher before deployment.' }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required for anonymous functional verification.' }
    $production = Assert-SampleTarget
    $slots = @(Invoke-AzJson -AsHashtable -Arguments (@('webapp', 'deployment', 'slot', 'list') + (Get-SampleTargetArguments) + @('--query', '[].{name:name}')))
    $exists = @($slots | Where-Object { $_['name'] -eq $Slot }).Count -gt 0
    if (-not $exists -and ($Action -ne 'Deploy' -or -not $CreateSlot)) { throw "Slot '$Slot' does not exist. Use -CreateSlot explicitly to create it; the App Service plan will not be upgraded." }
    if ($exists) { $null = Get-SampleAuth $Slot }
    if ($Action -in @('Promote', 'Rollback')) {
        $receipt = Read-SampleReceipt
        if ($Action -eq 'Promote') { Invoke-SamplePromotion $receipt }
        else { Invoke-SampleRollback $receipt }
        return
    }
    if (Test-Path -LiteralPath $script:sampleReceiptPath) {
        $previous = Read-SampleReceipt
        if ($previous['state'] -in @('promoted', 'promoting', 'promotion-failed', 'rolling-back')) {
            throw 'This slot retains production rollback content. Roll back or archive the receipt explicitly before replacing that content.'
        }
    }
    $operation = if ($Action -eq 'Verify') { 'Verify the existing sample upload and save its local receipt (no Azure changes)' }
        else { 'Deploy PUBLIC ANONYMOUS SQLite SAMPLE (production is not changed)' }
    if (-not $PSCmdlet.ShouldProcess("$WebAppName/$Slot", $operation)) { return }
    if ($Action -eq 'Verify') {
        $site = Get-SampleSite $Slot
        if ($site['serverFarmId'] -ne $production['serverFarmId']) { throw 'The slot is not on the validated App Service plan.' }
        $deploymentId = Get-SampleDeploymentId $Slot
    }
    else {
        if (-not $exists) {
            Invoke-CheckedCommand -Command az -Arguments (@('webapp', 'deployment', 'slot', 'create') + (Get-SampleTargetArguments $Slot) + @('--output', 'none', '--only-show-errors'))
            Invoke-CheckedCommand -Command az -Arguments (@('webapp', 'config', 'set') + (Get-SampleTargetArguments $Slot) +
                @('--linux-fx-version', $production['siteConfig']['linuxFxVersion'], '--output', 'none', '--only-show-errors'))
        }
        $site = Get-SampleSite $Slot
        if ($site['serverFarmId'] -ne $production['serverFarmId']) { throw 'The slot is not on the validated App Service plan.' }
        Set-SampleSettings -TargetSlot $Slot
        $deploymentId = Publish-AppServiceArchive -Path $path -TargetSlot $Slot -WaitForCompletion
        Set-SampleSettings -TargetSlot $Slot -ReleaseId $releaseId
        Set-SampleAuth -TargetSlot $Slot -Enabled $false
        Invoke-CheckedCommand -Command az -Arguments (@('webapp', 'update') + (Get-SampleTargetArguments $Slot) + @('--https-only', 'true', '--output', 'none', '--only-show-errors'))
    }
    Test-SampleConfiguration -TargetSlot $Slot -ReleaseId $releaseId
    Test-SampleWeb -TargetSlot $Slot
    if ((Get-SampleDeploymentId $Slot) -ne $deploymentId) { throw 'The sample deployment changed during verification; no new receipt was saved.' }
    $receipt = [ordered]@{
        version = 1; subscription = $SubscriptionId; tenant = $TenantId; resourceGroup = $ResourceGroup
        app = $WebAppName; slot = $Slot; releaseId = $releaseId
        deploymentId = $deploymentId; state = 'staged'
    }
    Save-SampleReceipt $receipt
    Write-Host "Verified sample deployment: https://$($site['defaultHostName'])"
    Write-Host "Production was not changed. Receipt: $script:sampleReceiptPath"
}
