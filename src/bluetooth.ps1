# Collects Bluetooth adapter, radio and paired-device information as one JSON object.
$ErrorActionPreference = 'SilentlyContinue'
$K_CONNECTED = '{83DA6326-97A6-4088-9453-A1923F573B29} 15'
$K_BATTERY   = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'

# Radio on/off through the WinRT Radios API.
$radio = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
  $t = $asTask.MakeGenericMethod([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]).Invoke($null, @([Windows.Devices.Radios.Radio]::GetRadiosAsync()))
  $t.Wait(5000) | Out-Null
  $bt = $t.Result | Where-Object { $_.Kind -eq 'Bluetooth' } | Select-Object -First 1
  if ($bt) { $radio = [string]$bt.State }
} catch {
  # The WinRT Radios API is missing on some Windows builds. $radio stays $null, which the page shows as unknown.
}

$adapters = Get-PnpDevice -Class Bluetooth | Where-Object { $_.InstanceId -match '^(USB|PCI)\\' } | ForEach-Object {
  $drv = Get-CimInstance Win32_PnPSignedDriver -Filter ("DeviceID='" + ($_.InstanceId -replace '\\', '\\') + "'")
  [pscustomobject]@{
    Name = $_.FriendlyName; Status = [string]$_.Status; Problem = $_.Problem
    Version = $drv.DriverVersion; Date = $(if ($drv.DriverDate) { $drv.DriverDate.ToString('yyyy-MM-dd') }); Provider = $drv.DriverProviderName
  }
}

$all  = @(Get-PnpDevice | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE)\\' })
$devs = @($all | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE)\\DEV_' })
$props = @()
if ($devs.Count) { $props = Get-PnpDeviceProperty -InstanceId $devs.InstanceId -KeyName $K_CONNECTED, 'DEVPKEY_DeviceContainer_Category' }
$bats = @()
if ($all.Count) { $bats = Get-PnpDeviceProperty -InstanceId $all.InstanceId -KeyName $K_BATTERY | Where-Object { $_.Data -ne $null } }

$batByMac = @{}
foreach ($b in $bats) { if ($b.InstanceId -match '([0-9A-F]{12})(_C[0-9A-F]+)?$') { $batByMac[$matches[1]] = $b.Data } }

$devices = foreach ($d in $devs) {
  $mac = $null; if ($d.InstanceId -match 'DEV_([0-9A-F]{12})') { $mac = $matches[1] }
  $p = $props | Where-Object { $_.InstanceId -eq $d.InstanceId }
  $cat = ($p | Where-Object { $_.KeyName -eq 'DEVPKEY_DeviceContainer_Category' }).Data
  if ($cat -is [array]) { $cat = $cat[0] }
  [pscustomobject]@{
    Name      = $d.FriendlyName
    Mac       = $mac
    LowEnergy = $d.InstanceId.StartsWith('BTHLE')
    Status    = [string]$d.Status
    Connected = [bool](($p | Where-Object { $_.KeyName -eq $K_CONNECTED }).Data)
    Category  = $(if ($cat) { [string]$cat } else { '' })
    Battery   = $batByMac[$mac]
  }
}

[pscustomobject]@{
  Radio    = $radio
  Service  = [string](Get-Service bthserv).Status
  Adapters = @($adapters)
  Devices  = @($devices)
} | ConvertTo-Json -Depth 4 -Compress
