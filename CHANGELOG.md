# Changelog

## 0.0.1

- 首个独立版本：`system` / `manual` / `direct` 三种出站模式；
- 模型请求默认直连，其余流量按代理目标统一发布 `http_proxy` / `https_proxy` / `no_proxy`；
- 代理健康检查 + fail-closed，代理不可用时只放行 `emergencyDirectHosts`；
- `pollIntervalMs` 轮询代理目标，系统代理开关变化无需重启即可跟随；
- Web 设置页「出站代理」表单（模式、代理地址、模型直连、应急名单）；
- `DSH_OUTBOUND_DISABLE=1` 环境变量总开关；
- 引擎、策略、注册表解析与直连名单清洗的单元测试；
- 安装文档重写：新增 `scripts/install.ps1` / `scripts/install.sh` 一键安装脚本（方式一），并补充手工复制（方式二）步骤。
