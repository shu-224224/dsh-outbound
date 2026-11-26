<#
.SYNOPSIS
    Legacy 手工安装脚本：把 dsh-outbound 复制进 DSH profile 的 node_modules。
.DESCRIPTION
    【已不推荐】主流 DSH profile 的 node_modules 由 pnpm 管理。不在 profile
    package.json 依赖树里、且 pnpm-lock.yaml 没有记录的包，会在下一次
    pnpm install 时被移到 node_modules/.ignored 并删除（安装、升级、卸载任何
    插件都会触发 pnpm install）。

    请优先使用界面「添加插件」安装：
      1) DSH 设置 → 插件（Plugins）→ 添加插件：填本仓库的本地目录绝对路径
         或 Git 地址；
      2) 离线 / 固定版本：在仓库根目录 npm pack，然后把生成的 tgz 绝对路径
         填进同一个「添加插件」对话框。
    注意：桌面版 dsh plugin --profile desktop add 会执行 pnpm add 并 reconcile
    依赖树（也能完成安装），但没有界面安装的预检与显式启用；安装请优先界面。

    本脚本检测到 pnpm 管理的 profile 时会拒绝执行。确认 profile 不是 pnpm
    管理时，用 -Legacy（或设置 DSH_LEGACY=1）强制手工安装。
.PARAMETER ProfileDir
    DSH profile 目录。默认 %USERPROFILE%\.dsh\profiles\desktop。
.PARAMETER Source
    插件源码目录。默认本脚本的上一级目录。
.PARAMETER NoBackup
    不备份 profile 的 cordis.patch.yml。
.PARAMETER DryRun
    只打印将要执行的动作，不写任何文件。
.PARAMETER Legacy
    强制允许在 pnpm 管理的 profile 上手工安装（会再次被 pnpm 清理，不推荐）。
.EXAMPLE
    .\scripts\install.ps1 -DryRun
.EXAMPLE
    .\scripts\install.ps1 -ProfileDir 'D:\dsh-profiles\desktop' -Legacy
#>
[CmdletBinding()]
param(
    [string] $ProfileDir = (Join-Path $HOME '.dsh\profiles\desktop'),
    [string] $Source = '',
    [switch] $NoBackup,
    [switch] $DryRun,
    [switch] $Legacy
)

$ErrorActionPreference = 'Stop'
$PluginId = 'dsh-outbound'

if (-not $Source) {
    $Source = Split-Path -Parent $PSScriptRoot
}

$sourceManifest = Join-Path $Source 'package.json'
if (-not (Test-Path -LiteralPath $sourceManifest)) {
    throw "找不到插件源码：$sourceManifest"
}
$manifest = Get-Content -LiteralPath $sourceManifest -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -ne $PluginId) {
    throw "package.json 的 name 是 '$($manifest.name)'，不是 '$PluginId'。"
}
if (-not (Test-Path -LiteralPath $ProfileDir -PathType Container)) {
    throw "找不到 DSH profile 目录：$ProfileDir（先打开一次 DeepSeek Harness Desktop 初始化 profile）"
}

# ---- 检测 profile 是否由 pnpm 管理 ----
$legacyRequested = $Legacy.IsPresent -or ($env:DSH_LEGACY -eq '1')
$pnpmMarkers = @()
if (Test-Path -LiteralPath (Join-Path $ProfileDir 'pnpm-lock.yaml')) { $pnpmMarkers += 'pnpm-lock.yaml' }
if (Test-Path -LiteralPath (Join-Path $ProfileDir 'node_modules\.pnpm')) { $pnpmMarkers += 'node_modules\.pnpm' }
$profileManifest = Join-Path $ProfileDir 'package.json'
if (Test-Path -LiteralPath $profileManifest) {
    try {
        $profileJson = Get-Content -LiteralPath $profileManifest -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($profileJson.dependencies -and @($profileJson.dependencies.PSObject.Properties.Name).Count -gt 0) {
            $pnpmMarkers += 'package.json dependencies'
        }
    } catch {
        # 无法解析的 profile package.json 不参与判定
    }
}

if ($pnpmMarkers.Count -gt 0 -and -not $legacyRequested) {
    Write-Host ''
    Write-Host "检测到 profile 由 pnpm 管理（$($pnpmMarkers -join '、')）。" -ForegroundColor Yellow
    Write-Host '手工复制到 node_modules 的包会在下一次 pnpm install 时被清理。' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '请改用界面「添加插件」安装：'
    Write-Host '  1) DSH 设置 → 插件（Plugins）→ 添加插件：填本地目录绝对路径或 Git 地址'
    Write-Host '  2) 离线 / 固定版本：npm pack 后把 tgz 绝对路径填进同一个对话框'
    Write-Host '注意：dsh plugin --profile desktop add 会 pnpm add 并 reconcile 依赖树，但没有界面安装的预检与显式启用。'
    Write-Host ''
    Write-Host '确认 profile 不是 pnpm 管理时，加 -Legacy（或设置 DSH_LEGACY=1）强制执行本脚本。'
    exit 1
}
if ($legacyRequested -and $pnpmMarkers.Count -gt 0) {
    Write-Warning "profile 由 pnpm 管理（$($pnpmMarkers -join '、')），-Legacy 安装可能在下次 pnpm install 时被清理。"
}

$target = Join-Path $ProfileDir "node_modules\$PluginId"
$patchPath = Join-Path $ProfileDir 'cordis.patch.yml'

if ($DryRun) {
    Write-Host "[DryRun] 源目录 : $Source"
    Write-Host "[DryRun] profile: $ProfileDir"
    Write-Host "[DryRun] 目标   : $target"
    Write-Host "[DryRun] patch  : $patchPath"
    Write-Host '[DryRun] 将复制 lib\、package.json、README.md、CHANGELOG.md、LICENSE'
    Write-Host '[DryRun] 将追加 dsh-outbound insert 配置块（若尚未存在）'
    exit 0
}

# ---- 复制插件文件 ----
$null = New-Item -ItemType Directory -Force -Path $target
foreach ($item in @('lib', 'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE')) {
    $src = Join-Path $Source $item
    if (-not (Test-Path -LiteralPath $src)) { throw "插件源码缺少：$src" }
    Copy-Item -LiteralPath $src -Destination $target -Recurse -Force
}
Write-Host "已复制插件文件到 $target"

# ---- 追加 profile patch ----
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

$existing = ''
if (Test-Path -LiteralPath $patchPath) {
    $existing = Get-Content -LiteralPath $patchPath -Raw -Encoding UTF8
}
if ($existing -match '(?m)^\s*-?\s*id:\s*dsh-outbound\s*$') {
    Write-Host 'cordis.patch.yml 里已有 dsh-outbound 配置行，跳过追加。'
} else {
    if (-not $NoBackup.IsPresent -and (Test-Path -LiteralPath $patchPath)) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        Copy-Item -LiteralPath $patchPath -Destination "$patchPath.bak-$stamp" -Force
        Write-Host "已备份 patch：$patchPath.bak-$stamp"
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($patchPath, $block, $utf8)
    Write-Host '已追加 dsh-outbound 配置块到 cordis.patch.yml。'
}

Write-Host ''
Write-Host "已安装 $PluginId -> $target"
Write-Host '后续步骤：'
Write-Host '  1. 完全退出并重新打开 DeepSeek Harness Desktop。'
Write-Host '  2. 在 设置 → 通用 确认出现「出站代理」并检查策略状态。'
Write-Host '  3. 如果 profile 由 pnpm 管理，请改用界面「添加插件」安装（见 README「安装」）。'
