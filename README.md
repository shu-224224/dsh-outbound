# dsh-outbound

给 DeepSeek Harness 用的**出站代理**插件：模型请求永远直连，网页抓取 / 普通 `fetch()` / 子进程跟随系统代理或手动代理；代理不可用时 fail-closed，只放行应急名单里的站点。

- 三种模式：`system`（跟随 Windows 系统代理开关）、`manual`（手动填代理地址）、`direct`（全部直连）。
- 代理目标每 2 秒重读一次，系统代理开关变化后 2~3 秒内自动重构策略，不需要重启 DSH。
- 每 5 秒经代理做一次真实健康检查；代理挂掉时不再进行「全部直连」，而是只放行 `emergencyDirectHosts`（默认空）。
- 设置入口：**设置 → 通用 → 出站代理**（host 与 client 两部分都会安装）。

## 它解决什么问题

DSH 原生只在启动时读一次代理环境变量，之后没有运行时开关：

- 模型请求和网页抓取走同一条路，没法按用途分开；
- 代理关掉后 `web_fetch` 直接失败，不会自动回落；
- 切换代理要改 `~/.dsh/.env` 并重启。

本插件把策略装进 `@deepseek-ai/dsh-http-proxy` 的进程级 active 策略：`dsh-web-fetch-http` 每次请求都会调用 `proxyRouteFor(url)`，普通 `fetch()` 读全局 undici dispatcher，宿主启动的子进程通过导出的 `HTTP(S)_PROXY / NO_PROXY` 跟随（模型发起的命令除外，见「已知边界」）—— 所以换策略立刻生效。

## 运行模式

| 模式 | 代理来源 | 说明 |
| --- | --- | --- |
| `system` | Windows 注册表 `HKCU\...\Internet Settings`（即 Clash「系统代理」开关） | 严格只认系统代理，不回退到 `proxy` 字段；非 Windows 平台退回启动时的代理环境变量 |
| `manual` | 配置里的 `proxy` | 只支持 `http://` 与 `https://`；写错或为空时按直连处理 |
| `direct` | 无 | 全部直连 |

## 健康检查与失败关闭

- 每 `probeIntervalMs`（默认 5000）经当前代理 `GET probeUrl`；`2xx/3xx` 以及除 `407` 外的 `4xx` 视为代理可用（说明隧道打到目标了），`5xx`、`407`、超时、连接错误视为不可用。
- 代理不可用时 **fail-closed**：`http_proxy/https_proxy` 照发，但 `no_proxy` 并入 `emergencyDirectHosts` —— 名单内站点直连，名单外站点走一个连不上的代理（等于失败），避免真实 IP 泄露。
- 若确实需要「代理挂了就全部直连」，把 `fallbackToDirect` 设为 `true`（会暴露真实 IP，默认关闭）。
- 目标地址（系统代理 / manual 配置）每 `pollIntervalMs`（默认 2000）重读；目标变化会立即重判，不需要等下一次探测。
- 模型域名（默认 `deepseek.com`）始终在 `no_proxy` 里（`keepModelDirect`）。

## 配置项

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关掉后恢复 DSH 启动时的原始策略 |
| `mode` | `system` | `system` / `manual` / `direct` |
| `proxy` | `''` | manual 模式使用的代理，如 `http://127.0.0.1:7897` |
| `keepModelDirect` | `true` | 把 `deepseek.com` 固定放进 `no_proxy` |
| `noProxy` | `[]` | 额外直连主机（与回环地址一起并入 `no_proxy`；不读取注册表 `ProxyOverride`） |
| `emergencyDirectHosts` | `[]` | 代理不可用时仍直连的主机 |
| `fallbackToDirect` | `false` | 代理不可用时是否全部直连（有 IP 泄露风险） |
| `probeUrl` | `https://www.gstatic.com/generate_204` | 健康检查地址 |
| `pollIntervalMs` | `2000` | 重读代理目标的间隔，`0` 表示只在启动/配置变更时读一次 |
| `probeIntervalMs` | `5000` | 健康检查间隔，`0` 表示关闭探测（目标存在即视为可用；目标变化仍会跟随） |
| `probeTimeoutMs` | `2500` | 单次探测超时 |

## 安装

前置：DeepSeek Harness 桌面版 `0.2.1-rc.2` ~ `0.2.x`（本包在 `0.2.1-rc.3` 上验证）。profile 默认位置：Windows `%USERPROFILE%\.dsh\profiles\desktop`，macOS/Linux `~/.dsh/profiles/desktop`。

### 方式一：一键脚本（推荐）

Windows（在仓库根目录执行）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

macOS / Linux：

```sh
sh ./scripts/install.sh
```

脚本会：把插件文件复制到 `<profile>/node_modules/dsh-outbound/`，并在 `<profile>/cordis.patch.yml` 末尾追加一条 `dsh-outbound` 配置行（已存在则跳过，重复执行安全）。可选参数：`-DryRun`（只打印不写）、`-ProfileDir <路径>`、`-NoBackup`（Windows，不备份旧 patch）；macOS/Linux 用环境变量 `DSH_PROFILE_DIR=<路径>`、`DRY_RUN=1`。

### 方式二：手工复制

1. 把 `lib/`、`package.json`、`README.md`、`CHANGELOG.md`、`LICENSE` 复制到 `<profile>\node_modules\dsh-outbound\`（目录不存在就手动创建）。
2. 在 `<profile>\cordis.patch.yml` 末尾追加：

```yaml
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
```

3. 打开 **设置 → 通用**，看到「出站代理」即安装成功；没看到就**完全退出 DSH（含托盘图标）再重开**。

手工方式不需要改 profile 的 `package.json`，也不需要 `pnpm install`（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-http-proxy` 等模块由 DSH 宿主提供）。

## 验证

1. 模型能正常回话 → 模型直连没有被破坏。
2. **设置 → 通用** 出现「出站代理」→ client UI 加载正常。
3. 打开系统代理后 `web_fetch https://www.google.com/robots.txt` 返回 200；关掉系统代理后 2~5 秒内 google 直连失败、baidu 仍 200。
4. 把系统代理指向一个不存在的端口（如 `127.0.0.1:9`）→ 进入 fail-closed：名单外失败、`emergencyDirectHosts` 内站点仍可直连；改回来后自动恢复。
5. 可选：打开系统代理后，在 Clash 的连接列表里能看到 `DeepSeek Harness` 进程发往代理的连接；关掉系统代理后这些连接消失。

## 升级与卸载

- 升级（方式一 / 方式二）：重新执行安装脚本，或重新复制 `lib/` 与 `package.json`，配置行会跳过不重复；设置会保留。
- 卸载（方式一 / 方式二）：删除 `<profile>\node_modules\dsh-outbound\`，并删掉 `cordis.patch.yml` 里的 `dsh-outbound` insert 块。
- 临时停用：设环境变量 `DSH_OUTBOUND_DISABLE=1` 后重启 DSH；或在 `cordis.patch.yml` 的 `dsh-outbound` 行把 `enabled` 设为 `false`（配置重载后生效）。

## 已知边界

- 只支持 HTTP(S) 代理，不支持 SOCKS（宿主 `dsh-http-proxy` 的限制）。
- `system` 模式的注册表读取只实现了 Windows；macOS / Linux 上该模式退回启动时的代理环境变量。
- PAC（`AutoConfigURL`）不会解析，只在日志里告警。
- 健康检查基于单个探针地址：探针返回 5xx、超时或连接错误会被判为代理不可用（4xx 除 407 外视为隧道可用），可以换 `probeUrl` 或把 `probeIntervalMs` 设为 `0`。
- `system` 模式只读系统代理的开关与地址，不解析注册表 `ProxyOverride` 直连列表；要额外直连的主机请写进 `noProxy`。
- 代理地址不要写带用户名密码的 URL（会明文写进配置文件）。
- 模型发起的命令（bash / 子代理 / workflow 等）的进程环境**不包含**插件注入的 `http_proxy` / `https_proxy`——DSH 宿主有意不把代理设置交给模型代码，所以不要用终端里的 `cmd /c set` 判断插件是否生效，请用设置页和 `web_fetch` 的实际走向验证。

## 模块结构

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | 插件入口：配置 schema、上下文接线、启动引擎 |
| `lib/settings.js` | 配置归一化 / 代理 URL 与主机名清洗 |
| `lib/bypass.js` | 生成 `no_proxy`（模型直连 + 回环 + 应急名单） |
| `lib/system-proxy.js` | 读取 Windows 系统代理（注册表，一次整键查询） |
| `lib/plan.js` | 纯函数：根据目标与健康状态生成策略 |
| `lib/probe.js` | 经代理的健康探测（undici ProxyAgent，复用连接池） |
| `lib/engine.js` | 轮询 / 探测 / 安装策略的状态机（可注入时钟，便于测试） |
| `lib/client.js` | 「设置 → 通用 → 出站代理」界面 |
| `scripts/install.ps1`、`scripts/install.sh` | 方式一安装脚本 |
| `test/` | 单元测试（含假时钟引擎测试） |

## 测试

```sh
node --test test/
```

## 许可

MIT，见 [LICENSE](LICENSE)。
