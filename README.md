# dsh-outbound

给 DeepSeek Harness 用的**出站代理**插件：模型请求永远直连，网页抓取 / 普通 `fetch()` / 宿主启动的子进程跟随系统代理或手动代理；代理不可用时 fail-closed，只放行应急名单里的站点。

- 三种模式：`system`（跟随 Windows 系统代理开关）、`manual`（手动填代理地址）、`direct`（全部直连）。
- 代理目标每 2 秒重读一次，开关系统代理后 2~3 秒内自动重装策略，不需要重启 DSH。
- 每 5 秒经代理做一次真实健康检查；代理挂掉后不会「悄悄全直连」，而是只放行 `emergencyDirectHosts`（默认空）。
- 设置入口：**设置 → 通用 → 出站代理**。

## 它解决什么问题

DSH 原生只在启动时读一次代理环境变量，之后没有运行时开关：

- 模型请求和网页抓取走同一条路，没法按用途分开；
- 代理关掉后 `web_fetch` 直接失败，不会自动回落；
- 切换代理要改 `~/.dsh/.env` 并重启。

本插件把策略装进 `@deepseek-ai/dsh-http-proxy` 的进程级 active 策略：`dsh-web-fetch-http` 每次请求都会调用 `proxyRouteFor(url)`，普通 `fetch()` 读全局 undici dispatcher，宿主启动的子进程通过导出的 `HTTP(S)_PROXY` / `NO_PROXY` 跟随（模型发起的命令除外，见「已知边界」）——换策略立刻生效。

## 运行模式

| 模式 | 含义 |
| --- | --- |
| `system` | 只认 Windows 系统代理开关：开则用注册表里的代理，关则全部直连。**不会**退回这里填的 `proxy` |
| `manual` | 固定使用 `proxy` 字段里的代理地址（只支持 `http://` / `https://`） |
| `direct` | 全部直连，忽略系统代理 |

## 健康检查与失败关闭

- 每 `probeIntervalMs`（默认 5000ms）通过代理实际 `GET probeUrl`（默认 `https://www.gstatic.com/generate_204`）判断代理是否可用。
- 200~499（407 除外）视为隧道可用；5xx、超时、连接错误视为不可用。
- 代理不可用时：`fallbackToDirect: false`（默认）→ **fail-closed**，只有 `emergencyDirectHosts` 里的站点直连，其他请求报网络错误；`fallbackToDirect: true` → 全部直连（会暴露真实 IP，谨慎）。
- 健康检查恢复后自动切回代理；关闭探测（`probeIntervalMs: 0`）时代理目标存在即视为可用。

## 配置项

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；`false` 时恢复启动时的直连策略 |
| `mode` | `system` | `system` / `manual` / `direct` |
| `proxy` | `''` | `manual` 模式下的代理地址，如 `http://127.0.0.1:7890` |
| `keepModelDirect` | `true` | 模型请求（`deepseek.com`）始终加入 `no_proxy` 直连 |
| `noProxy` | `[]` | 额外直连主机列表，如 `["internal.example.com"]` |
| `emergencyDirectHosts` | `[]` | 代理不可用时仍直连的站点，默认空即完全失败关闭 |
| `fallbackToDirect` | `false` | 代理不可用时是否退回全部直连（不推荐） |
| `probeUrl` | `https://www.gstatic.com/generate_204` | 健康检查地址 |
| `pollIntervalMs` | `2000` | 重读代理目标的周期；`0` 表示只在设置变更时重装 |
| `probeIntervalMs` | `5000` | 健康检查周期；`0` 表示关闭探测 |
| `probeTimeoutMs` | `2500` | 单次健康检查超时 |

## 安装

前置：DeepSeek Harness 桌面版 `>=0.2.1-rc.2 <0.3.0`（在 `0.2.1-rc.3` 上验证）；不需要另行安装依赖或构建。profile 默认位置：Windows 为 `%USERPROFILE%\.dsh\profiles\desktop`，macOS / Linux 为 `~/.dsh/profiles/desktop`。

### 方式一：DSH 界面「添加插件」（推荐）

打开 **设置 → 插件 → 添加插件**，在对话框里填下面任意一种地址：

- **本地目录**（现在就可以用）：下载本仓库 ZIP 并解压，填解压目录的绝对路径，例如 `C:\Users\you\Downloads\dsh-outbound-main`；
- **Git 地址**（现在就可以用）：`https://github.com/shu-224224/dsh-outbound`。

安装器会校验包里的 `dsh.bundle.patch`、执行 `pnpm add`、把包写进 profile 的 `dsh.profile.bundles` 并应用包内 patch，所以之后任何 `pnpm install` 都不会把它清掉。装完重启 DSH，**设置 → 通用** 出现「出站代理」即成功。

> 从 Git 地址安装时，插件管理器会先做一次 `git ls-remote` 连通性检查（默认 5 秒），网络不通会失败。

### 方式二：本地 tarball

适合离线环境或固定版本。在仓库根目录执行：

```powershell
npm pack
```

然后在 **设置 → 插件 → 添加插件** 里填生成的 `dsh-outbound-0.1.0.tgz` 绝对路径，或把 tgz 放到内网再填其路径。安装逻辑同方式一（同样会注册 bundle）。

### 关于命令行 `dsh plugin`

在桌面版上，`dsh plugin --profile desktop add <spec>` 会先在 profile 目录执行 pnpm（即 `pnpm add`）；成功后还会对依赖树做一次 reconcile——校验新依赖声明了 `dsh.bundle.patch`，把包写进 `dsh.profile.bundles` 并加载包内 patch（源码见 `@deepseek-ai/dsh-plugin-manager` 的 `runProfilePnpm`）。所以它也能装本地 tarball（`file:vendor/xxx.tgz`，本仓库作者就用这条路径安装过）。

与界面「添加插件」的差别：界面那条通道还包含 spec 读取与兼容性预检、显式确认、`selectBundle(..., true)` 显式启用以及安装后的界面重载；CLI 没有这些步骤，兼容性检查失败等场景的反馈也更弱。因此正常安装和升级仍推荐界面「添加插件」；`dsh plugin` 只作为高级用法（离线 tarball、依赖管理、排错）的说明保留。

### 安装后的验证

1. 模型能正常回话 → 模型直连没有被破坏。
2. **设置 → 通用** 出现「出站代理」。
3. 打开系统代理后 `web_fetch https://www.google.com/robots.txt` 返回 200；关掉系统代理后 2~5 秒内 google 直连失败、baidu 仍 200。
4. 把系统代理指向不存在的端口（如 `127.0.0.1:9`）→ fail-closed：名单外失败，`emergencyDirectHosts` 内站点仍可直连；改回后自动恢复。
5. 可选：Clash 连接列表里能看到 DeepSeek Harness 发往代理的连接；关掉系统代理后消失。

## 升级、卸载与停用

- **组合包安装（界面 / tarball）**：在 **设置 → 插件** 的已安装列表里升级（重新添加新版本）或卸载；配置保存在 profile 的 `cordis.patch.yml`（用户 patch 层），升级不会重置。
- **从 Legacy 手工安装迁移**（推荐一次做完）：
  1. 先用界面「添加插件」装上新版本；
  2. 删掉 `cordis.patch.yml` 里旧的 `dsh-outbound` 手工 `insert` 块，避免和 bundle 自带的配置行重复；想保留自定义配置就把它改成顶层 `- id: dsh-outbound` 覆盖项；
  3. 完全退出 DSH 再打开。
  迁移后留下的 `node_modules\dsh-outbound\` 会被 pnpm 接管，也可手动删掉。
- **Legacy 手工卸载**（没有装组合包时）：删掉 `<profile>\node_modules\dsh-outbound\`，再删掉 `cordis.patch.yml` 里的 `dsh-outbound` insert 块，重启 DSH。
- **旧 profile（不由 pnpm 管理）**：仓库里的 `scripts/install.ps1` / `scripts/install.sh` 仅用于这种 profile 的一次性安装或修复，带 `-Legacy`（Windows）/ `--legacy`（sh）或 `DSH_LEGACY=1` 才会执行；正常安装不要用。
- **临时停用**：设 `DSH_OUTBOUND_DISABLE=1` 后重启 DSH；或在插件页禁用该 bundle；或把 `cordis.patch.yml` 里 `dsh-outbound` 行的 `enabled` 改成 `false`。

## 已知边界

- **模型请求**由宿主 Node 的全局 `fetch` 发出，走 `no_proxy` 直连；`keepModelDirect: false` 时模型请求也会跟随代理。
- **模型发起的命令**（Agent 执行的 `bash` / `pwsh` 等）不会继承插件发布的代理环境变量，这是 DSH 的行为；需要时请在命令里自行加 `-x` / `http_proxy`。
- **系统代理**只在 Windows 上读取注册表（`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`）；macOS / Linux 的 `system` 模式退回启动时的代理环境变量。
- 只支持 `http://` / `https://` 代理；SOCKS 和带账号密码的代理 URL 会被拒绝。
- `noProxy` 只接受主机名或域名后缀，`*`、CIDR 等条目会被丢弃并告警；不读取注册表的 `ProxyOverride`。
- 注册表里配置了 PAC（`AutoConfigURL`）时只告警、不解析。
- fail-closed 下所有非应急站点都会失败；请按需填写 `emergencyDirectHosts`（如 `["baidu.com", "bilibili.com"]`）。

## 模块结构

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | Cordis 入口：配置 schema、目标读取、生命周期 |
| `lib/engine.js` | 轮询 / 探测 / 重装策略的状态机 |
| `lib/plan.js` | 由配置 + 代理目标推导出要发布的策略 |
| `lib/bypass.js` | 组装 `no_proxy`（模型直连、回环、应急名单） |
| `lib/probe.js` | 经代理做健康检查 |
| `lib/system-proxy.js` | 读取 Windows 系统代理与 `ProxyOverride` |
| `lib/settings.js` | 配置归一化与校验 |
| `lib/client.js` | 设置页「出站代理」表单（Web 端） |
| `scripts/install.ps1`、`scripts/install.sh` | 旧 profile 的 legacy 安装 / 修复脚本（仅升级、卸载场景） |
| `test/` | 单元测试（配置、策略、注册表解析、引擎） |

## 测试

```powershell
node --test test/     # 44 个用例
npm run check         # 全部 lib 文件的语法检查
```

## 许可

[MIT](LICENSE)
