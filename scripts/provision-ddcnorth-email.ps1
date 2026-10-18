# Run in an authenticated Exchange Online PowerShell session after the approved
# Entra registration exists. No mailbox-reading or tenant-wide mail role is used.
$ErrorActionPreference = 'Stop'
$mailTenantId = '220c85f6-1cb1-4bb2-a63b-55d9fd163b55'
$mailClientId = '1fcf36db-033f-4362-9550-f0297ad4aa31'
$mailPrincipalId = '5142583a-a2bb-49af-bc8c-cfb53a509e11'
$mailSender = 'societyer@ddcnorth.com'
$mailScopeName = 'Societyer DDC North sender'
$mailRoleName = 'Societyer DDC North send only'

$mailConnection = @(Get-ConnectionInformation | Where-Object { [string]$_.TenantID -eq $mailTenantId })
if ($mailConnection.Count -ne 1) { throw 'Connect to exactly one FirstForm Exchange Online session before provisioning.' }
$mailbox = Get-EXOMailbox -Identity $mailSender
if ([string]$mailbox.PrimarySmtpAddress -ne $mailSender -or [string]$mailbox.RecipientTypeDetails -ne 'SharedMailbox') {
  throw 'Expected the approved Societyer shared mailbox.'
}
$mailPointer = Get-ServicePrincipal -Identity $mailPrincipalId -ErrorAction SilentlyContinue
if (!$mailPointer) {
  $mailPointer = New-ServicePrincipal -AppId $mailClientId -ObjectId $mailPrincipalId -DisplayName 'Societyer DDC North email delivery'
}
if ([string]$mailPointer.AppId -ne $mailClientId) { throw 'Service principal does not match the approved email app.' }
$mailOrganization = Get-OrganizationConfig
if ($mailOrganization.IsDehydrated -eq $true) {
  # Exchange requires this one-time prerequisite before custom scopes/roles.
  Enable-OrganizationCustomization -Confirm:$false
  if ((Get-OrganizationConfig).IsDehydrated -eq $true) {
    throw 'Exchange organization customization is still propagating. Retry after Microsoft finishes provisioning.'
  }
}
$mailScope = Get-ManagementScope -Identity $mailScopeName -ErrorAction SilentlyContinue
if (!$mailScope) {
  $mailScope = New-ManagementScope -Name $mailScopeName -RecipientRestrictionFilter "EmailAddresses -eq 'smtp:societyer@ddcnorth.com'"
}
$mailMatches = @(Get-Recipient -RecipientPreviewFilter $mailScope.RecipientFilter -ResultSize 2)
if ($mailMatches.Count -ne 1 -or [string]$mailMatches[0].PrimarySmtpAddress -ne $mailSender) {
  throw 'Scope must match exactly the approved sender mailbox.'
}
$mailRole = Get-ManagementRoleAssignment -Identity $mailRoleName -ErrorAction SilentlyContinue
if (!$mailRole) {
  New-ManagementRoleAssignment -Name $mailRoleName -Role 'Application Mail.Send' -App $mailPrincipalId -CustomResourceScope $mailScopeName | Out-Null
}
$mailAllow = @(Test-ServicePrincipalAuthorization -Identity $mailPrincipalId -Resource $mailSender | Where-Object { $_.RoleName -eq 'Application Mail.Send' -and $_.InScope -eq $true })
$mailDeny = @(Test-ServicePrincipalAuthorization -Identity $mailPrincipalId -Resource 'Ahmad@ddcnorth.com' | Where-Object { $_.RoleName -eq 'Application Mail.Send' -and $_.InScope -eq $true })
if ($mailAllow.Count -lt 1 -or $mailDeny.Count -gt 0) { throw 'Mailbox authorization qualification failed.' }
[pscustomobject]@{ Sender = $mailSender; Role = 'Application Mail.Send'; SenderInScope = $true; AhmadMailboxInScope = $false; ScopeMatches = $mailMatches.Count } | ConvertTo-Json -Compress
# This test excludes Entra grants. Also verify the app has no broad Graph mail
# permissions, then perform a real Graph send after permission propagation.
