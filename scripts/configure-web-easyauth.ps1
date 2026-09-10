<#
.SYNOPSIS
    Configures Azure App Service Easy Auth v2 for the TLC web application using a
    federated identity credential (FIC) instead of a client secret.

.DESCRIPTION
    The Microsoft corporate tenant disallows password credentials on app registrations
    (tenant policy 538f1913-...). This script wires Easy Auth v2 on the App Service to
    the existing app registration by:

      1. Adding the App Service Easy Auth reply URL to the app registration.
      2. Declaring the delegated Dynamics CRM `user_impersonation` permission required
         to receive an MSX-audience access token via `x-ms-token-aad-access-token`.
      3. Creating (or reusing) a user-assigned managed identity (UAMI).
      4. Assigning the UAMI to the App Service.
      5. Creating a federated identity credential on the app registration that trusts
         the UAMI's Entra-issued token.
      6. Storing the UAMI client id in the `OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID`
         app setting that Easy Auth reads instead of a client secret.
      7. Disabling any residual auth v1 configuration.
      8. Turning on Easy Auth v2 with the Microsoft Entra provider, token store, and
         a login parameter that requests the MSX delegated scope.

    The script never creates, prints, or handles secret material. The UAMI acts as the
    confidential-client credential for the app registration via workload identity
    federation.

.PARAMETER SubscriptionId
    Azure subscription that owns the App Service. Defaults to the current TLC production
    subscription.

.PARAMETER TenantId
    Microsoft Entra tenant that owns both the app registration and the App Service.

.PARAMETER ResourceGroup
    Resource group containing the App Service and the UAMI.

.PARAMETER WebAppName
    Name of the App Service to protect with Easy Auth.

.PARAMETER Location
    Azure region used when creating the UAMI. Must match the App Service region.

.PARAMETER AppRegistrationClientId
    Application (client) id of the existing Entra app registration to bind Easy Auth to.

.PARAMETER ManagedIdentityName
    Name of the user-assigned managed identity that acts as the FIC client credential.

.PARAMETER FederatedIdentityName
    Name of the federated identity credential added to the app registration.

.PARAMETER SecretSettingName
    App Service application setting that stores the UAMI client id. Easy Auth reads this
    setting name via `clientSecretSettingName`; the exact name
    `OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID` is required by App Service.

.PARAMETER DataverseResourceAppId
    Resource app id for Dynamics CRM (used to add the user_impersonation permission).

.PARAMETER DataverseUserImpersonationScopeId
    Scope id of the Dynamics CRM `user_impersonation` delegated permission.

.PARAMETER MsxScope
    Delegated scope to request at sign-in so the injected access token is valid for MSX.

.PARAMETER RunAdminConsent
    When set, calls `az ad app permission admin-consent`. Requires directory admin rights.

.EXAMPLE
    pwsh -NoProfile -File scripts/configure-web-easyauth.ps1

    Applies the production configuration with confirmation prompts.

.EXAMPLE
    pwsh -NoProfile -File scripts/configure-web-easyauth.ps1 -WhatIf

    Prints every mutating command without applying anything.

.NOTES
    Rollback:
      az webapp auth update --subscription <sub> --resource-group <rg> --name <app> --enabled false

    This disables Easy Auth without altering the app registration, UAMI, or FIC.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string] $SubscriptionId = 'cbaf34df-7bb5-4fcf-bd7d-686a5f43ad31',
    [string] $TenantId = '72f988bf-86f1-41af-91ab-2d7cd011db47',
    [string] $ResourceGroup = 'myDemoRg',
    [string] $WebAppName = 'tlc',
    [string] $Location = 'westus3',
    [string] $AppRegistrationClientId = 'd4a694ba-9ed0-4467-9c06-f7dfe41ceb8c',
    [string] $ManagedIdentityName = 'tlc-easyauth-mi',
    [string] $FederatedIdentityName = 'tlc-easyauth-fic',
    [string] $SecretSettingName = 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID',
    [string] $DataverseResourceAppId = '00000007-0000-0000-c000-000000000000',
    [string] $DataverseUserImpersonationScopeId = '78ce3f0f-a1ce-49c2-8cde-64b5c0896db4',
    [string] $MsxScope = 'https://microsoftsales.crm.dynamics.com/user_impersonation',
    [switch] $RunAdminConsent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-AzJson {
    param([Parameter(Mandatory)] [string[]] $Arguments)
    $output = & az @Arguments --only-show-errors --output json
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed (exit ${LASTEXITCODE}): az $($Arguments -join ' ')"
    }
    if (-not $output) { return $null }
    return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}

function Invoke-AzChecked {
    param([Parameter(Mandatory)] [string[]] $Arguments)
    & az @Arguments --only-show-errors --output none
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed (exit ${LASTEXITCODE}): az $($Arguments -join ' ')"
    }
}

function New-TemporaryJsonFile {
    param([Parameter(Mandatory)] [object] $Value)
    $file = New-TemporaryFile
    Set-Content -LiteralPath $file -Value ($Value | ConvertTo-Json -Depth 30) -Encoding utf8
    return $file
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI is required.'
}

$account = Invoke-AzJson -Arguments @('account', 'show', '--subscription', $SubscriptionId)
if ($account.tenantId -ne $TenantId) {
    throw "Subscription '$SubscriptionId' belongs to tenant '$($account.tenantId)', not '$TenantId'."
}

$replyUri = "https://$WebAppName-frfwf5g4g8edhcc0.$Location-01.azurewebsites.net/.auth/login/aad/callback"
$app = Invoke-AzJson -Arguments @('webapp', 'show', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup, '--name', $WebAppName)
if ($app.defaultHostName) {
    $replyUri = "https://$($app.defaultHostName)/.auth/login/aad/callback"
}
$target = "App Service '$WebAppName' in resource group '$ResourceGroup'"
if (-not $PSCmdlet.ShouldProcess($target, 'Configure Easy Auth v2 with FIC-backed managed identity')) {
    return
}

# 1. App registration reply URL (idempotent).
$registration = Invoke-AzJson -Arguments @('ad', 'app', 'show', '--id', $AppRegistrationClientId)
if (-not $registration.web.redirectUris -or -not ($registration.web.redirectUris -contains $replyUri)) {
    Write-Host "Adding Easy Auth reply URL to app registration: $replyUri"
    $webUris = @($registration.web.redirectUris) + $replyUri | Sort-Object -Unique
    Invoke-AzChecked -Arguments @('ad', 'app', 'update', '--id', $AppRegistrationClientId, '--web-redirect-uris') + $webUris
}
else {
    Write-Host "Reply URL already present on app registration."
}

# 2. Declare delegated Dynamics CRM user_impersonation without dropping existing scopes.
$requiredAccess = @($registration.requiredResourceAccess)
$dataverseEntry = $requiredAccess | Where-Object { $_.resourceAppId -eq $DataverseResourceAppId } | Select-Object -First 1
if (-not $dataverseEntry) {
    Write-Host "Declaring Dynamics CRM user_impersonation on app registration."
    $dataverseEntry = [pscustomobject]@{
        resourceAppId  = $DataverseResourceAppId
        resourceAccess = @(@{ id = $DataverseUserImpersonationScopeId; type = 'Scope' })
    }
    $requiredAccess += $dataverseEntry
    $file = New-TemporaryJsonFile -Value $requiredAccess
    try {
        Invoke-AzChecked -Arguments @('ad', 'app', 'update', '--id', $AppRegistrationClientId, '--required-resource-accesses', "@$file")
    }
    finally { Remove-Item -LiteralPath $file -Force }
}
else {
    Write-Host "Dynamics CRM permission already declared."
}

# 2b. Enable ID token issuance (required for Easy Auth OIDC hybrid response_type "code id_token").
if (-not $registration.web.implicitGrantSettings.enableIdTokenIssuance) {
    Write-Host "Enabling ID token issuance on app registration."
    $body = '{"web":{"implicitGrantSettings":{"enableIdTokenIssuance":true,"enableAccessTokenIssuance":false}}}'
    $file = New-TemporaryFile
    Set-Content -LiteralPath $file -Value $body -Encoding utf8
    try {
        Invoke-AzChecked -Arguments @('rest', '--method', 'patch', '--url', "https://graph.microsoft.com/v1.0/applications/$($registration.id)", '--body', "@$file", '--headers', 'Content-Type=application/json')
    }
    finally { Remove-Item -LiteralPath $file -Force }
}
else {
    Write-Host "ID token issuance already enabled."
}

# 3. Create or reuse the user-assigned managed identity that backs the FIC.
$existingUami = Invoke-AzJson -Arguments @('identity', 'list', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup) |
Where-Object { $_.name -eq $ManagedIdentityName } | Select-Object -First 1
if ($existingUami) {
    Write-Host "Reusing existing UAMI: $ManagedIdentityName"
    $uami = $existingUami
}
else {
    Write-Host "Creating UAMI: $ManagedIdentityName in $Location"
    $uami = Invoke-AzJson -Arguments @('identity', 'create', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup, '--name', $ManagedIdentityName, '--location', $Location)
}

# 4. Attach the UAMI to the App Service (idempotent).
$identityState = Invoke-AzJson -Arguments @('webapp', 'identity', 'show', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup, '--name', $WebAppName)
$attached = $identityState.userAssignedIdentities -and $identityState.userAssignedIdentities.PSObject.Properties.Name -contains $uami.id
if (-not $attached) {
    Write-Host "Attaching UAMI to App Service."
    Invoke-AzChecked -Arguments @('webapp', 'identity', 'assign', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup, '--name', $WebAppName, '--identities', $uami.id)
}
else {
    Write-Host "UAMI already attached to App Service."
}

# 5. Federated identity credential on the app registration (subject = UAMI principalId).
$existingFic = Invoke-AzJson -Arguments @('ad', 'app', 'federated-credential', 'list', '--id', $AppRegistrationClientId) |
Where-Object { $_.name -eq $FederatedIdentityName } | Select-Object -First 1
if (-not $existingFic) {
    Write-Host "Creating federated credential '$FederatedIdentityName' on app registration."
    $ficBody = @{
        name      = $FederatedIdentityName
        issuer    = "https://login.microsoftonline.com/$TenantId/v2.0"
        subject   = $uami.principalId
        audiences = @('api://AzureADTokenExchange')
    }
    $file = New-TemporaryJsonFile -Value $ficBody
    try {
        Invoke-AzChecked -Arguments @('ad', 'app', 'federated-credential', 'create', '--id', $AppRegistrationClientId, '--parameters', "@$file")
    }
    finally { Remove-Item -LiteralPath $file -Force }
}
else {
    Write-Host "Federated credential '$FederatedIdentityName' already exists."
}

# 6. App setting the FIC-mode Easy Auth reads instead of a client secret.
Write-Host "Setting App Service setting $SecretSettingName (slot-sticky)."
Invoke-AzChecked -Arguments @(
    'webapp', 'config', 'appsettings', 'set',
    '--subscription', $SubscriptionId,
    '--resource-group', $ResourceGroup,
    '--name', $WebAppName,
    '--settings', "$SecretSettingName=$($uami.clientId)",
    '--slot-settings', "$SecretSettingName=$($uami.clientId)"
)

# 7. Disable auth v1 so v2 configuration is not rejected.
Write-Host "Disabling classic (v1) auth."
Invoke-AzChecked -Arguments @('webapp', 'auth-classic', 'update', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup, '--name', $WebAppName, '--enabled', 'false')

# 8. Configure Microsoft Entra provider on Easy Auth v2 and enable the token store.
Write-Host "Binding Entra provider on Easy Auth v2."
Invoke-AzChecked -Arguments @(
    'webapp', 'auth', 'microsoft', 'update',
    '--subscription', $SubscriptionId,
    '--resource-group', $ResourceGroup,
    '--name', $WebAppName,
    '--client-id', $AppRegistrationClientId,
    '--client-secret-setting-name', $SecretSettingName,
    '--tenant-id', $TenantId,
    '--yes'
)
Write-Host "Enabling token store and RedirectToLoginPage."
Invoke-AzChecked -Arguments @(
    'webapp', 'auth', 'update',
    '--subscription', $SubscriptionId,
    '--resource-group', $ResourceGroup,
    '--name', $WebAppName,
    '--enabled', 'true',
    '--action', 'RedirectToLoginPage',
    '--redirect-provider', 'azureactivedirectory',
    '--enable-token-store', 'true'
)

# 9. Login parameters must be set via a full authsettingsV2 PUT (no dedicated CLI flag).
Write-Host "Requesting the MSX delegated scope at sign-in."
$current = Invoke-AzJson -Arguments @('webapp', 'auth', 'show', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup, '--name', $WebAppName)
$current.properties.identityProviders.azureActiveDirectory.login = @{
    loginParameters = @("scope=openid profile offline_access $MsxScope")
}
$body = @{ properties = $current.properties }
$file = New-TemporaryJsonFile -Value $body
try {
    $url = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$WebAppName/config/authsettingsV2?api-version=2024-11-01"
    Invoke-AzChecked -Arguments @('rest', '--method', 'put', '--url', $url, '--body', "@$file", '--headers', 'Content-Type=application/json')
}
finally { Remove-Item -LiteralPath $file -Force }

# 10. Optional tenant admin consent.
if ($RunAdminConsent) {
    Write-Host "Granting admin consent for app registration $AppRegistrationClientId."
    Invoke-AzChecked -Arguments @('ad', 'app', 'permission', 'admin-consent', '--id', $AppRegistrationClientId)
}

# Final summary (no secrets printed).
$summary = Invoke-AzJson -Arguments @('webapp', 'auth', 'show', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroup, '--name', $WebAppName) |
Select-Object -ExpandProperty properties
[pscustomobject]@{
    Platform        = $summary.platform.enabled
    Unauthenticated = $summary.globalValidation.unauthenticatedClientAction
    Provider        = $summary.identityProviders.azureActiveDirectory.registration.clientId
    Issuer          = $summary.identityProviders.azureActiveDirectory.registration.openIdIssuer
    SecretSetting   = $summary.identityProviders.azureActiveDirectory.registration.clientSecretSettingName
    TokenStore      = $summary.login.tokenStore.enabled
    LoginParameters = $summary.identityProviders.azureActiveDirectory.login.loginParameters
    UamiClientId    = $uami.clientId
    UamiPrincipalId = $uami.principalId
} | Format-List

Write-Host ''
Write-Host "Easy Auth configured. Verify with a fresh incognito browser at https://$($app.defaultHostName)"
Write-Host "Rollback: az webapp auth update --resource-group $ResourceGroup --name $WebAppName --enabled false"
