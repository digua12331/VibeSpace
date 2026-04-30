# 把 VibeSpace 的 harness 配置（6 skill + 7 agent + 2 dev/ 文档）安装到目标项目。
# 用法：.\templates\harness\install.ps1 -Target "C:\path\to\your\project"
# 已存在同名文件会跳过 + 列出冲突清单（不会覆盖你已有的）。
#
# **同步提醒**：本脚本是命令行入口；server 端有等价实现
# packages/server/src/harness-template-service.ts（VibeSpace UI 调它）。
# 加新模板文件 / 改文件清单时**两边都要改**——它们是两份独立实现（pwsh vs TS）。

param(
  [Parameter(Mandatory=$true)]
  [string]$Target
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Target -PathType Container)) {
  Write-Host "ERROR: 目标目录不存在：$Target" -ForegroundColor Red
  exit 1
}

# SRC = 仓库根 = 本脚本所在 templates/harness/ 的两级父目录
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src = Resolve-Path (Join-Path $ScriptDir "..\..")

if (-not (Test-Path (Join-Path $Src ".aimon\skills") -PathType Container) -or
    -not (Test-Path (Join-Path $Src ".claude\agents") -PathType Container)) {
  Write-Host "ERROR: SRC ($Src) 看起来不像 VibeSpace 仓库根（找不到 .aimon\skills 或 .claude\agents）" -ForegroundColor Red
  exit 1
}

$Target = (Resolve-Path $Target).Path
Write-Host "[harness-install] SRC=$Src"
Write-Host "[harness-install] TARGET=$Target"

# 创建目标子目录
$null = New-Item -ItemType Directory -Force -Path (Join-Path $Target ".aimon\skills")
$null = New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\agents")
$null = New-Item -ItemType Directory -Force -Path (Join-Path $Target "dev")

$Conflicts = @()
$Copied = 0

function Copy-IfAbsent {
  param([string]$SrcFile, [string]$DstFile)
  if (Test-Path $DstFile) {
    $script:Conflicts += $DstFile
    return
  }
  Copy-Item -LiteralPath $SrcFile -Destination $DstFile
  $script:Copied++
}

# .aimon/skills/*.md
Get-ChildItem (Join-Path $Src ".aimon\skills") -Filter "*.md" | ForEach-Object {
  Copy-IfAbsent $_.FullName (Join-Path $Target ".aimon\skills\$($_.Name)")
}

# .claude/agents/*.md
Get-ChildItem (Join-Path $Src ".claude\agents") -Filter "*.md" | ForEach-Object {
  Copy-IfAbsent $_.FullName (Join-Path $Target ".claude\agents\$($_.Name)")
}

# dev/ 两份文档
Copy-IfAbsent (Join-Path $Src "dev\harness-roadmap.md")        (Join-Path $Target "dev\harness-roadmap.md")
Copy-IfAbsent (Join-Path $Src "dev\agent-team-blueprint.md")   (Join-Path $Target "dev\agent-team-blueprint.md")

# 改造清单放在显眼位置
Copy-IfAbsent (Join-Path $ScriptDir "CUSTOMIZE.md") (Join-Path $Target ".aimon\CUSTOMIZE-harness.md")

# .gitignore 追加 .aimon/runtime/
$Gitignore = Join-Path $Target ".gitignore"
if (Test-Path $Gitignore) {
  $existing = Get-Content $Gitignore -Raw
  if ($existing -notmatch '(?m)^\.aimon/runtime/?$') {
    Add-Content -Path $Gitignore -Value "`r`n# Harness runtime prompts (generated per-session, ignore)`r`n.aimon/runtime/"
    Write-Host "[harness-install] .gitignore: 追加 .aimon/runtime/"
  }
} else {
  Set-Content -Path $Gitignore -Value ".aimon/runtime/"
  Write-Host "[harness-install] 创建 .gitignore（含 .aimon/runtime/）"
}

Write-Host ""
Write-Host "============================================"
Write-Host "[harness-install] 复制完成：$Copied 个文件" -ForegroundColor Green

if ($Conflicts.Count -gt 0) {
  Write-Host "[harness-install] 跳过（目标已存在，未覆盖）：$($Conflicts.Count) 个" -ForegroundColor Yellow
  foreach ($c in $Conflicts) {
    Write-Host "  - $c"
  }
  Write-Host ""
  Write-Host "→ 想覆盖请手动 diff + 删除目标文件再跑一遍"
}

Write-Host ""
Write-Host "下一步必读：" -ForegroundColor Cyan
Write-Host "  $Target\.aimon\CUSTOMIZE-harness.md"
Write-Host ""
Write-Host "改造完后启动一次 claude session，Task 工具菜单应能看到 vibespace-*"
Write-Host "（建议改名成你项目代号前缀，如 myproj-*）"
Write-Host "============================================"
