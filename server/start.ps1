$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js 22+ is needed. Install it first.'
  exit 1
}
$envFile=Join-Path $PSScriptRoot '.env.local'
if (-not (Test-Path $envFile)) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $token = ([BitConverter]::ToString($bytes) -replace '-', '')
  @("ADMIN_TOKEN=$token",'HOST=127.0.0.1','PORT=8787','OLLAMA_MODEL=qwen2.5-coder:7b','OLLAMA_BASE=http://127.0.0.1:11434','CORS_ORIGINS=http://localhost:4173,http://127.0.0.1:4173,https://jim-wfm-ai.netlify.app,https://wfm.hotelplannerqa.com') | Set-Content $envFile
  Write-Host "Generated local ADMIN_TOKEN in $envFile. Keep it private."
}
# Independent second key for Jim's encrypted agent-password vault.
if (-not (Select-String -Path $envFile -Pattern '^ROSTER_VAULT_KEY=' -Quiet)) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $vaultToken = ([BitConverter]::ToString($bytes) -replace '-', '')
  Add-Content -Path $envFile -Value "ROSTER_VAULT_KEY=$vaultToken"
  Write-Host 'Generated separate ROSTER_VAULT_KEY in server/.env.local. Keep it private.'
}
Write-Host 'Starting Jim WFM local AI bridge...'
Write-Host 'For real AI changes, install Ollama and run: ollama pull qwen2.5-coder:7b'
Write-Host 'Edit server/.env.local to change model or allowed front-end origins.'
node (Join-Path $PSScriptRoot 'index.mjs')
