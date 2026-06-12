# start-cleanup.ps1 -- kill everything left over from a previous start.bat
# run of THIS instance, so each double-click of start.bat is a fresh start.
#
# Kill rules (one process snapshot, then expand):
#   1. old cmd.exe whose command line contains this start.bat full path
#      (= the console window of the previous double-click)
#   2. node.exe / esbuild.exe whose command line contains the project root
#      (dev servers, tsx watch, vite, esbuild workers)
#   3. every descendant of the above (catches the pnpm main process whose
#      command line does NOT contain the project root, relative-path
#      children like "node scripts/dev-alt.mjs", cmd shims, conhost, ...)
#
# Self-protection: the current process and its whole ancestor chain
# (this powershell, the cmd running the NEW start.bat, explorer, ...)
# are never killed.
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][string]$Bat
)
$ErrorActionPreference = 'SilentlyContinue'

$Root = $Root.TrimEnd('\')

# One CIM query with a timeout -- a wedged WMI must not block startup forever.
$all = Get-CimInstance Win32_Process -OperationTimeoutSec 30
if (-not $all) {
  Write-Host '[VibeSpace]   process snapshot unavailable, skipping cleanup'
  exit 0
}

$byId = @{}
foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }

# Protect self + all ancestors. HashSet.Add returns $false on a repeat,
# which also breaks out of any PID-reuse cycle in the parent chain.
$protected = New-Object 'System.Collections.Generic.HashSet[int]'
$cur = $PID
while ($byId.ContainsKey($cur) -and $protected.Add($cur)) {
  $cur = [int]$byId[$cur].ParentProcessId
}

function Test-ContainsPath([string]$haystack, [string]$needle) {
  return $haystack -and $haystack.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

# Seed the kill set from the two command-line rules.
$kill = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($p in $all) {
  $id = [int]$p.ProcessId
  if ($protected.Contains($id)) { continue }
  if ($p.Name -eq 'cmd.exe' -and (Test-ContainsPath $p.CommandLine $Bat)) {
    [void]$kill.Add($id)
    continue
  }
  if (($p.Name -eq 'node.exe' -or $p.Name -eq 'esbuild.exe') -and (Test-ContainsPath $p.CommandLine $Root)) {
    [void]$kill.Add($id)
  }
}

# Expand to all (non-protected) descendants of anything in the kill set.
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($p in $all) {
    $id = [int]$p.ProcessId
    if ($kill.Contains([int]$p.ParentProcessId) -and -not $protected.Contains($id) -and $kill.Add($id)) {
      $changed = $true
    }
  }
}

foreach ($id in $kill) {
  Write-Host ('[VibeSpace]   killing stale {0} PID {1}' -f $byId[$id].Name, $id)
  Stop-Process -Id $id -Force
}
