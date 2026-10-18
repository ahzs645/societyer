# Bounded interactive sign-in, approved sender-only grant, and guaranteed logout.
$ErrorActionPreference = 'Stop'
$mailRepoRoot = Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $mailRepoRoot 'work/microsoft-mail-tools/modules/ExchangeOnlineManagement/3.10.1/ExchangeOnlineManagement.psd1')
try {
  Connect-ExchangeOnline -UserPrincipalName 'Ahmad@ddcnorth.com' -ShowBanner:$false
  & (Join-Path $PSScriptRoot 'provision-ddcnorth-email.ps1')
} finally {
  Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue
}
