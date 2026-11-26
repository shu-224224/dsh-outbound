# Changelog

## 0.1.0

- 安装方式重做，以 DSH 界面 **设置 → 插件 → 添加插件** 为准：支持填 Git 地址、本地目录或本地 tarball。安装器会校验 `dsh.bundle.patch`、把包写进 profile 依赖树与 `dsh.profile.bundles` 并应用包内 patch，之后的 `pnpm install` 不会再把它清掉。
- 修正桌面版 CLI 说明：`dsh plugin --profile desktop add <spec>` 会执行 `pnpm add`，成功后还会对依赖树 reconcile（同样写入 `dsh.profile.bundles` 并应用包内 patch）；但它缺少界面安装的预检、显式启用与重载流程，文档仍以界面「添加插件」为推荐安装/升级方式，CLI 仅作高级用法说明。
- README 安装章节只保留界面 / 本地 tarball 两条通道（界面支持本地目录、Git 地址两种填法）；手工安装从安装章节移除，只在「升级、卸载与停用」里作为 legacy 迁移 / 清理说明保留。
- `scripts/install.ps1` / `scripts/install.sh` 降级为 legacy：检测到 pnpm 管理的 profile 时直接拒绝并提示界面安装，`-Legacy` / `DSH_LEGACY=1` 可强制旧行为。
- 修复 `engines.dsh` 与 `@deepseek-ai/dsh-*` peer 范围的预发布陷阱：`>=0.2.1-rc.2 <0.3.0` 会被 node-semver 静默排除 `0.2.2-rc.x` / `0.2.3-rc.x` 等宿主版本，改为显式 `||` 分支。
- 补充仓库元数据：`repository` / `homepage` / `bugs` / `keywords` / `author`，版本 `0.0.1` → `0.1.0`。
- 新增 `.github/workflows/release.yml`：推 `v*` tag 时跑测试、校验 tag 与 `package.json` 版本一致，并把 `npm pack` 产物挂到 GitHub Release（不发布 npm）。
- 行为无变化：代理策略、配置项、设置页与 0.0.1 相同。

## 0.0.1

- 首个独立版本：`system` / `manual` / `direct` 三种出站模式；
- 模型请求默认直连，其余流量按代理目标统一发布 `http_proxy` / `https_proxy` / `no_proxy`；
- 代理健康检查 + fail-closed，代理不可用时只放行 `emergencyDirectHosts`；
- `pollIntervalMs` 轮询代理目标，系统代理开关变化无需重启即可跟随；
- Web 设置页「出站代理」表单（模式、代理地址、模型直连、应急名单）；
- `DSH_OUTBOUND_DISABLE=1` 环境变量总开关；
- 引擎、策略、注册表解析与直连名单清洗的单元测试；
- 安装文档重写：新增 `scripts/install.ps1` / `scripts/install.sh` 一键安装脚本（方式一），并补充手工复制（方式二）步骤。
