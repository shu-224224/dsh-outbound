# dsh-outbound 一键安装脚本（方式一）
#
# 用法（在仓库根目录）：
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -ProfileDir "D:\other-profile"
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -DryRun
#
# 它会做两件事：
#   1. 把 lib/、package.json 等复制到 <ProfileDir>\node_modules\dsh-outbound
#   2. 在 <ProfileDir>\cordis.patch.yml 末尾追加一条 dsh-outbound 配置行（已存在则跳过）
#
# 改完配置后 DSH 若开着配置热更新会自动重载；没有生效时完全退出 DSH（含托盘）再重开。

[CmdletBinding()]
param(
    [string]$ProfileDir = (Join-Path $HOME '.dsh\profiles\desktop'),
    [string]$Source = '',
    [switch]$NoBackup,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$PluginId = 'dsh-outbound'

if (-not $Source) {
    $Source = Join-Path $PSScriptRoot '..'
}

# ---- 检查来源仓库 ----
$Source = (Resolve-Path -LiteralPath $Source).Path
$pkgJson = Join-Path $Source 'package.json'
if (-not (Test-Path -LiteralPath $pkgJson)) {
    throw "找不到 $pkgJson。请在仓库根目录执行脚本，或用 -Source 指向仓库根目录。"
}
$manifest = Get-Content -LiteralPath $pkgJson -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -ne $PluginId) {
    throw "package.json 里的 name 是 $($manifest.name)，不是 $PluginId。"
}

# ---- 检查目标 profile ----
$ProfileDir = [System.IO.Path]::GetFullPath($ProfileDir)
if (-not (Test-Path -LiteralPath $ProfileDir)) {
    throw "profile 目录不存在：$ProfileDir`n先启动一次 DeepSeek Harness 桌面版，让它初始化 profile，再执行本脚本。"
}
$target = Join-Path $ProfileDir "node_modules\$PluginId"
$patchPath = Join-Path $ProfileDir 'cordis.patch.yml'

Write-Host "来源仓库 : $Source"
Write-Host "目标插件 : $target"
Write-Host "配置文件 : $patchPath"

if ($DryRun) {
    Write-Host ''
    Write-Host '[DryRun] 将复制：lib/ package.json README.md CHANGELOG.md LICENSE'
    Write-Host '[DryRun] 若 cordis.patch.yml 没有 dsh-outbound 行，则追加一条 insert 行'
    exit 0
}

# ---- 复制插件文件 ----
New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($item in @('lib', 'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE')) {
    $from = Join-Path $Source $item
    if (Test-Path -LiteralPath $from) {
        Copy-Item -LiteralPath $from -Destination $target -Recurse -Force
    }
}
Write-Host "已复制插件文件。"

# ---- 追加配置行（幂等） ----
$block = @'
# --- dsh-outbound: 全局出站代理（手工安装） ---
- insert:
    - id: dsh-outbound
      name: dsh-outbound
      config:
        enabled: true
        mode: system
        proxy: ''
        keepModelDirect: true
        noProxy: []
        emergencyDirectHosts: []
        fallbackToDirect: false
        probeUrl: https://www.gstatic.com/generate_204
        pollIntervalMs: 2000
        probeIntervalMs: 5000
        probeTimeoutMs: 2500
'@

if (Test-Path -LiteralPath $patchPath) {
    $existing = Get-Content -LiteralPath $patchPath -Raw -Encoding UTF8
} else {
    $existing = ''
}
if ($existing -match '(?m)^\s*-?\s*id:\s*dsh-outbound\s*$') {
    Write-Host "cordis.patch.yml 已包含 dsh-outbound 行，跳过追加（避免重复 id）。"
} else {
    if (-not $NoBackup) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        Copy-Item -LiteralPath $patchPath -Destination "$patchPath.bak-$stamp" -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath "$patchPath.bak-$stamp") { Write-Host "已备份配置：$patchPath.bak-$stamp" }
    }
    $prefix = ''
    if ($existing.Length -gt 0 -and -not $existing.EndsWith("`n")) { $prefix = "`n" }
    $text = $prefix + "`n" + $block + "`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($patchPath, $text, $utf8NoBom)
    Write-Host "已追加 dsh-outbound 配置行到 cordis.patch.yml。"
}

Write-Host ''
Write-Host '安装完成。接下来：'
Write-Host '  1. 打开 DSH 设置 → 通用，确认出现「出站代理」一栏；'
Write-Host '  2. 没有出现就完全退出 DSH（含托盘）再重开；'
Write-Host '  3. 打开系统代理，抓一次 https://www.google.com/robots.txt 验证走代理。'
