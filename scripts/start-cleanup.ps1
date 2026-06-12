# start-cleanup.ps1 -- WMI-free cleanup for start.bat.
#
# WHY NO WMI: on this machine Get-CimInstance Win32_Process times out after
# 30s every single time (filtered or not), so the old command-line-matching
# cleanup silently killed NOTHING while stalling startup for 30s. Everything
# here uses Toolhelp snapshots + Get-Process instead (all millisecond-fast).
#
# Default mode (cleanup + record):
#   1. Read the pid file written by the PREVIOUS run: "<pid>|<startTimeTicks>".
#      If that process is still alive AND its StartTime matches the recorded
#      ticks (PID-reuse guard), walk a Toolhelp PID->PPID snapshot and kill
#      every DESCENDANT of it -- pnpm, tsx, vite, node servers, esbuild, cmd
#      shims, conhost (killing conhost closes the old console window).
#      Only processes named node/esbuild/cmd/conhost/powershell are killed,
#      so if the old root is a user's interactive terminal now running
#      something unrelated, that survives. The old root cmd itself is never
#      killed either (it self-closes via -CheckOwner, see below).
#   2. Sweep orphan esbuild.exe whose executable lives under the project root.
#   3. Record THIS run: parent of this powershell (= the cmd running the new
#      start.bat) + its StartTime ticks into the pid file.
#
# -CheckOwner mode (run by start.bat after the dev servers exit):
#   exit 0 if the pid file still records MY parent cmd (normal shutdown),
#   exit 1 if a newer start.bat instance has taken over (the bat then closes
#   its now-useless window with `exit /b`).
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][string]$PidFile,
  [switch]$CheckOwner
)
$ErrorActionPreference = 'SilentlyContinue'
$Root = $Root.TrimEnd('\')

# Toolhelp process snapshot: PID/PPID pairs without WMI.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class VibeSnap {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct PROCESSENTRY32 {
    public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID;
    public uint th32ModuleID; public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Auto)] static extern bool Process32First(IntPtr h, ref PROCESSENTRY32 e);
  [DllImport("kernel32.dll", CharSet = CharSet.Auto)] static extern bool Process32Next(IntPtr h, ref PROCESSENTRY32 e);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static List<int[]> List() {
    var res = new List<int[]>();
    IntPtr h = CreateToolhelp32Snapshot(2 /* TH32CS_SNAPPROCESS */, 0);
    if (h == IntPtr.Zero || h == new IntPtr(-1)) return res;
    var e = new PROCESSENTRY32();
    e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
    if (Process32First(h, ref e)) {
      do { res.Add(new int[] { (int)e.th32ProcessID, (int)e.th32ParentProcessID }); } while (Process32Next(h, ref e));
    }
    CloseHandle(h);
    return res;
  }
}
'@

$pairs = [VibeSnap]::List()
$parentOf = @{}
$childrenOf = @{}
foreach ($pr in $pairs) {
  $parentOf[$pr[0]] = $pr[1]
  if (-not $childrenOf.ContainsKey($pr[1])) { $childrenOf[$pr[1]] = New-Object 'System.Collections.Generic.List[int]' }
  $childrenOf[$pr[1]].Add($pr[0])
}
$myParent = if ($parentOf.ContainsKey($PID)) { [int]$parentOf[$PID] } else { 0 }

if ($CheckOwner) {
  $rec = (Get-Content -LiteralPath $PidFile -TotalCount 1) -split '\|'
  if (-not $rec -or $rec[0] -eq "$myParent") { exit 0 }
  exit 1
}

# --- Phase A: kill descendants of the previous run's root cmd -----------
$KILLABLE = @('node', 'esbuild', 'cmd', 'conhost', 'powershell')

# protect self + whole ancestor chain (covers re-running the bat in the
# same terminal: the old root is then OUR ancestor and BFS must not recurse
# into our own chain). HashSet.Add returning $false also breaks PID cycles.
$protected = New-Object 'System.Collections.Generic.HashSet[int]'
$cur = $PID
while ($protected.Add($cur) -and $parentOf.ContainsKey($cur)) { $cur = [int]$parentOf[$cur] }

if (Test-Path -LiteralPath $PidFile) {
  $rec = (Get-Content -LiteralPath $PidFile -TotalCount 1) -split '\|'
  $oldPid = 0; $oldTicks = [long]0
  if ($rec.Count -ge 2) { $oldPid = [int]$rec[0]; $oldTicks = [long]$rec[1] }
  $oldProc = if ($oldPid -gt 4) { Get-Process -Id $oldPid } else { $null }
  if ($oldProc -and [math]::Abs($oldProc.StartTime.Ticks - $oldTicks) -lt 30000000) {
    $queue = New-Object 'System.Collections.Generic.Queue[int]'
    $queue.Enqueue($oldPid)
    $victims = New-Object 'System.Collections.Generic.List[int]'
    while ($queue.Count -gt 0) {
      $p = $queue.Dequeue()
      if (-not $childrenOf.ContainsKey($p)) { continue }
      foreach ($c in $childrenOf[$p]) {
        if ($protected.Contains($c)) { continue }
        $queue.Enqueue($c)
        $victims.Add($c)
      }
    }
    foreach ($v in $victims) {
      $vp = Get-Process -Id $v
      if ($vp -and $KILLABLE -contains $vp.ProcessName) {
        Write-Host ('[VibeSpace]   killing stale {0} PID {1}' -f $vp.ProcessName, $v)
        Stop-Process -Id $v -Force
      }
    }
  } else {
    Write-Host '[VibeSpace]   pid file is stale (previous instance already gone)'
  }
}

# --- Phase B: orphan esbuild.exe living under this project --------------
Get-Process esbuild | Where-Object { $_.Path -like ($Root + '\*') } | ForEach-Object {
  Write-Host ('[VibeSpace]   killing orphan esbuild PID {0}' -f $_.Id)
  Stop-Process -Id $_.Id -Force
}

# --- Phase C: record this run's root cmd for the NEXT cleanup -----------
if ($myParent -gt 4) {
  $pp = Get-Process -Id $myParent
  if ($pp) {
    $dir = Split-Path -Parent $PidFile
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Set-Content -LiteralPath $PidFile -Value ('{0}|{1}' -f $myParent, $pp.StartTime.Ticks) -Encoding Ascii
    Write-Host ('[VibeSpace]   recorded owner cmd PID {0}' -f $myParent)
  }
}
exit 0
