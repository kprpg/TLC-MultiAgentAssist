#requires -Version 7.4
<#
.SYNOPSIS
Operate this Windows user's private Teams connection over the protected local owner channel.
.DESCRIPTION
Connect is explicit: native mode can open corporate sign-in; CLI mode reuses the current user.
Both verify the owner's read-only MSX identity mapping.
Approve pairs the exact public page code. No command writes to MSX/Dataverse.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Connect', 'Approve', 'Status', 'Disconnect')]
    [string] $Action,
    [ValidateSet('msx', 'mcp', 'graph')]
    [string] $Resource = 'msx',
    [ValidatePattern('^[A-Fa-f0-9]{8}$')]
    [string] $UserCode,
    [string] $WorkDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'TLC-Assist\Teams\launcher-native')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Action -eq 'Approve' -and -not $UserCode) { throw 'Supply the exact -UserCode displayed by your TLC page.' }
$WorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$base = [IO.Path]::GetFullPath([Environment]::GetFolderPath('LocalApplicationData'))
$prefix = $base.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $WorkDirectory.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Use this user''s private LocalAppData native installation.' }
$acl = Get-Acl -LiteralPath $WorkDirectory
if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or
    (Get-Item -LiteralPath $WorkDirectory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The native launcher work directory is not protected for this Windows owner.'
}
foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid.Value, 'S-1-5-18')) {
        throw 'Refusing to execute native connection code from a shared work directory.'
    }
}
$trusted = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544', 'S-1-3-0')
$write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
$parent = (Get-Item -LiteralPath $WorkDirectory -Force).Parent
while ($parent -and ($parent.FullName -eq $base -or $parent.FullName.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase))) {
    if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Native installation ancestors cannot be reparse points.' }
    $parentAcl = Get-Acl -LiteralPath $parent.FullName
    if ($parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'The native installation has an untrusted parent.' }
    foreach ($rule in $parentAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted -and ($rule.FileSystemRights -band $write)) { throw 'Another Windows user can replace a native installation ancestor.' }
    }
    $parent = $parent.Parent
}
$record = Get-Content -LiteralPath (Join-Path $WorkDirectory 'current-run.json') -Raw | ConvertFrom-Json
if (-not $record.PSObject.Properties['authentication'] -or $record.authentication -notin @('local-interactive', 'local-azure-cli')) {
    throw 'This launcher record is not a private local installation. Start an explicit local-interactive or local-azure-cli profile first.'
}
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $WorkDirectory 'releases')) + [IO.Path]::DirectorySeparatorChar
$runtime = [IO.Path]::GetFullPath([string] $record.runtimeDirectory)
if (-not $runtime.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase) -or
    (Get-Content -LiteralPath (Join-Path $runtime '.runner-owner') -Raw).Trim() -ne $record.runId) {
    throw 'The runtime does not have this launcher ownership marker.'
}
$server = Join-Path $runtime 'server.js'
$ownerDirectory = [string] $record.ownerDirectory
if (-not $ownerDirectory) { throw 'The protected native owner directory is not recorded.' }
$arguments = @('--experimental-sqlite', $server, '--local-owner', $Action.ToLowerInvariant(), $ownerDirectory)
if ($Action -eq 'Connect') { $arguments += $Resource }
if ($Action -eq 'Approve') { $arguments += $UserCode.ToUpperInvariant() }
& (Get-Command node -ErrorAction Stop).Source @arguments
if ($LASTEXITCODE -ne 0) { throw 'The protected native owner command failed. No success or source access is implied.' }
