# Creates "Hardware Dashboard" shortcuts on the Desktop and in the Start Menu.
# Run: powershell -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1
$ErrorActionPreference = 'Stop'
$app  = Split-Path -Parent $PSScriptRoot
$exe  = Join-Path $app 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $app 'build\icon.ico'
if (-not (Test-Path $exe)) { throw "Electron is missing. Run 'npm install' in $app first." }

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Hardware Dashboard.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Hardware Dashboard.lnk')
)
foreach ($t in $targets) {
  $s = $shell.CreateShortcut($t)
  $s.TargetPath = $exe
  $s.Arguments = '"' + $app + '"'
  $s.WorkingDirectory = $app
  $s.IconLocation = "$icon,0"
  $s.Description = 'Watch your PC hardware and find where disk space went'
  $s.Save()
  Write-Output "Created $t"
}
