[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string] $SubscriptionId = 'cbaf34df-7bb5-4fcf-bd7d-686a5f43ad31',
    [string] $TenantId = '72f988bf-86f1-41af-91ab-2d7cd011db47',
    [string] $ResourceGroup = 'myDemoRg',
    [string] $WebAppName = 'tlc',
    [string] $AppServicePlan = 'ASP-myDemoRg-94e3',
    [string] $ExpectedHostName = 'tlc-frfwf5g4g8edhcc0.westus3-01.azurewebsites.net',
    [string] $Slot,
    [string] $ArtifactPath,
    [string] $FoundryEnvironmentPath = 'config/foundry.environment.json',
    [switch] $SkipBuild,
    [switch] $PackageOnly,
    [switch] $SkipHealthCheck,
    [ValidateRange(1, 30)]
    [int] $HealthAttempts = 30,
    [ValidateRange(1, 60)]
    [int] $HealthDelaySeconds = 6
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)] [string] $Command,
        [Parameter(Mandatory)] [string[]] $Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
    }
}

function Invoke-AzJson {
    param([Parameter(Mandatory)] [string[]] $Arguments)

    $output = & az @Arguments --only-show-errors --output json
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed with exit code ${LASTEXITCODE}: az $($Arguments -join ' ')"
    }
    return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}

function Get-AppServiceDeployments {
    $arguments = @(
        'webapp', 'log', 'deployment', 'list',
        '--subscription', $SubscriptionId,
        '--resource-group', $ResourceGroup,
        '--name', $WebAppName
    )
    if ($Slot) { $arguments += @('--slot', $Slot) }
    return @(Invoke-AzJson -Arguments $arguments)
}

function Wait-AppServiceDeployment {
    param(
        [Parameter(Mandatory)] [string] $DeploymentId,
        [Parameter(Mandatory)] [int] $CommandExitCode
    )

    for ($attempt = 1; $attempt -le 60; $attempt++) {
        $deployment = Get-AppServiceDeployments | Where-Object { $_.id -eq $DeploymentId } | Select-Object -First 1
        if ($deployment.status -eq 4) {
            Write-Warning "Azure CLI exited with code $CommandExitCode, but App Service completed accepted deployment '$DeploymentId'."
            return
        }
        if ($deployment.status -eq 3) {
            throw "App Service deployment '$DeploymentId' failed after Azure CLI exited with code ${CommandExitCode}: $($deployment.status_text)"
        }
        Start-Sleep -Seconds 10
    }

    throw "App Service deployment '$DeploymentId' did not reach a terminal state after Azure CLI exited with code $CommandExitCode."
}

function Resolve-ArtifactPath {
    if ($ArtifactPath) {
        if ([IO.Path]::IsPathRooted($ArtifactPath)) {
            return [IO.Path]::GetFullPath($ArtifactPath)
        }
        return [IO.Path]::GetFullPath((Join-Path $repositoryRoot $ArtifactPath))
    }

    $package = Get-Content (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
    return Join-Path $repositoryRoot "release-web/TLC-MultiAgent-Assist-$($package.version)-Web-AppService.zip"
}

function Test-AppServiceArchive {
    param([Parameter(Mandatory)] [string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "App Service package was not found: $Path"
    }
    if ((Get-Item -LiteralPath $Path).Length -eq 0) {
        throw "App Service package is empty: $Path"
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    try {
        $archive = [IO.Compression.ZipFile]::OpenRead($Path)
        try {
            $entryNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
            foreach ($entry in $archive.Entries) {
                [void] $entryNames.Add($entry.FullName.Replace('\', '/'))
            }
            foreach ($requiredEntry in @('package.json', 'server.js')) {
                if (-not $entryNames.Contains($requiredEntry)) {
                    throw "App Service package is missing required root entry '$requiredEntry': $Path"
                }
            }
            if ($archive.Entries.Count -eq 0) {
                throw "App Service package contains no entries: $Path"
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    catch {
        throw "App Service package validation failed: $($_.Exception.Message)"
    }
}

function Get-FoundryEnvironmentSetting {
    $resolvedPath = if ([IO.Path]::IsPathRooted($FoundryEnvironmentPath)) {
        [IO.Path]::GetFullPath($FoundryEnvironmentPath)
    }
    else {
        [IO.Path]::GetFullPath((Join-Path $repositoryRoot $FoundryEnvironmentPath))
    }
    if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
        throw "Foundry environment file was not found: $resolvedPath"
    }

    $content = Get-Content -LiteralPath $resolvedPath -Raw
    try {
        $configuration = $content | ConvertFrom-Json
    }
    catch {
        throw "Foundry environment file is not valid JSON: $resolvedPath"
    }
    if (-not $configuration.foundry.projectEndpoint -or -not $configuration.foundry.agents) {
        throw "Foundry environment file is missing the project endpoint or agent bindings: $resolvedPath"
    }
    if ($content -match 'clientSecret|apiKey|connectionString') {
        throw "Foundry environment file contains credential-like fields and cannot be stored in App Service settings: $resolvedPath"
    }

    return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($content))
}

function Test-HealthEndpoint {
    param([Parameter(Mandatory)] [string] $HostName)

    $healthUri = "https://$HostName/api/health"
    for ($attempt = 1; $attempt -le $HealthAttempts; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri $healthUri -Method Get -TimeoutSec 20
            if ($health.status -eq 'ready') {
                Write-Host "Health check passed: $healthUri"
                return
            }
        }
        catch {
            if ($attempt -eq $HealthAttempts) {
                throw "Health check failed after $HealthAttempts attempts at ${healthUri}: $($_.Exception.Message)"
            }
        }
        Start-Sleep -Seconds $HealthDelaySeconds
    }
    throw "Health endpoint did not return status 'ready': $healthUri"
}

Push-Location $repositoryRoot
try {
    $resolvedArtifactPath = Resolve-ArtifactPath
    if (-not $SkipBuild) {
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            throw 'npm is required to build the App Service package.'
        }
        Write-Host 'Building and smoke-testing the web release...'
        Invoke-CheckedCommand -Command 'npm' -Arguments @('run', 'web:release')
    }

    Test-AppServiceArchive -Path $resolvedArtifactPath
    $artifactSize = [Math]::Round((Get-Item -LiteralPath $resolvedArtifactPath).Length / 1MB, 2)
    Write-Host "Validated App Service package: $resolvedArtifactPath ($artifactSize MB)"

    if ($PackageOnly) {
        Write-Host 'Package-only operation completed; Azure was not contacted.'
        return
    }

    $foundryEnvironmentSetting = Get-FoundryEnvironmentSetting

    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw 'Azure CLI is required to deploy the App Service package.'
    }

    $account = Invoke-AzJson -Arguments @('account', 'show', '--subscription', $SubscriptionId)
    if ($account.tenantId -ne $TenantId) {
        throw "Subscription '$SubscriptionId' belongs to tenant '$($account.tenantId)', not '$TenantId'."
    }

    $plan = Invoke-AzJson -Arguments @(
        'appservice', 'plan', 'show',
        '--subscription', $SubscriptionId,
        '--resource-group', $ResourceGroup,
        '--name', $AppServicePlan
    )
    if ($plan.name -ne $AppServicePlan) {
        throw "App Service plan '$AppServicePlan' was not found in resource group '$ResourceGroup'."
    }

    $appArguments = @(
        'webapp', 'show',
        '--subscription', $SubscriptionId,
        '--resource-group', $ResourceGroup,
        '--name', $WebAppName
    )
    if ($Slot) { $appArguments += @('--slot', $Slot) }
    $app = Invoke-AzJson -Arguments $appArguments
    if ($ExpectedHostName -and -not $Slot -and $app.defaultHostName -ne $ExpectedHostName) {
        throw "Web app hostname '$($app.defaultHostName)' does not match expected hostname '$ExpectedHostName'."
    }
    if ($app.kind -notlike '*linux*') {
        throw "Web app '$WebAppName' is not a Linux App Service (kind: '$($app.kind)')."
    }

    $targetName = if ($Slot) { "$WebAppName/$Slot" } else { $WebAppName }
    if (-not $PSCmdlet.ShouldProcess($targetName, "Deploy $resolvedArtifactPath to Azure App Service")) {
        return
    }

    $deployArguments = @(
        'webapp', 'deploy',
        '--subscription', $SubscriptionId,
        '--resource-group', $ResourceGroup,
        '--name', $WebAppName,
        '--src-path', $resolvedArtifactPath,
        '--type', 'zip',
        '--clean', 'true',
        '--restart', 'true',
        '--track-status', 'false',
        '--only-show-errors'
    )
    if ($Slot) { $deployArguments += @('--slot', $Slot) }

    Write-Host "Deploying package to $targetName..."
    $settingsArguments = @(
        'webapp', 'config', 'appsettings', 'set',
        '--subscription', $SubscriptionId,
        '--resource-group', $ResourceGroup,
        '--name', $WebAppName,
        '--settings',
        "TLC_FOUNDRY_ENV_BASE64=$foundryEnvironmentSetting",
        'WEBSITE_RUN_FROM_PACKAGE=1',
        '--output', 'none'
    )
    if ($Slot) { $settingsArguments += @('--slot', $Slot) }
    Invoke-CheckedCommand -Command 'az' -Arguments $settingsArguments
    $deploymentBefore = Get-AppServiceDeployments | Select-Object -First 1
    $deploymentBeforeId = if ($null -eq $deploymentBefore) { $null } else { $deploymentBefore.id }
    & az @deployArguments
    $deployExitCode = $LASTEXITCODE
    if ($deployExitCode -ne 0) {
        $deploymentAfter = Get-AppServiceDeployments | Select-Object -First 1
        if ($null -eq $deploymentAfter -or -not $deploymentAfter.id -or $deploymentAfter.id -eq $deploymentBeforeId) {
            throw "Azure CLI deployment failed with exit code $deployExitCode and App Service did not accept a new deployment."
        }
        Wait-AppServiceDeployment -DeploymentId $deploymentAfter.id -CommandExitCode $deployExitCode
    }

    if (-not $SkipHealthCheck) {
        Test-HealthEndpoint -HostName $app.defaultHostName
    }
    Write-Host "Deployment completed: https://$($app.defaultHostName)"
}
finally {
    Pop-Location
}