<p align="center">
  <img src="assets/brand/deepseek-wordmark.svg" alt="DeepSeek" width="360">
</p>

<h1 align="center">DeepSeek Work</h1>

<p align="center"><strong>把 DeepSeek Harness 变成一款开箱即用的桌面工作台。</strong></p>
<p align="center">DeepSeek Harness, ready for the desktop.</p>

<p align="center">
  <a href="https://github.com/astraclawteam/deepseek-work/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/astraclawteam/deepseek-work/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/astraclawteam/deepseek-work/actions/workflows/release.yml"><img alt="Release" src="https://github.com/astraclawteam/deepseek-work/actions/workflows/release.yml/badge.svg"></a>
  <img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-0078D4?logo=windows11&logoColor=white">
  <img alt="macOS Apple Silicon" src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?logo=apple&logoColor=white">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-4D6BFE"></a>
</p>

DeepSeek Work 是 AstraClaw Team 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建的社区桌面发行版。它保留 Harness 的 Agent、工具、MCP、Skill、Subagent 与 Workflow 能力，同时提供真正的桌面窗口、完整内置运行时、启动健康检查和可靠的进程生命周期管理。

> 本项目不是 DeepSeek 官方桌面客户端；DeepSeek Harness、名称与黑色鲸鱼品牌素材归其原始权利方所有。

## 为什么选择 DeepSeek Work

- **下载即用**：安装包内置精确锁定的 DeepSeek Harness、Node.js 与原生依赖，不要求用户安装 Node、pnpm 或克隆源码。
- **桌面体验**：16:10 原生窗口、自定义启动壳、系统托盘、官方黑色鲸鱼视觉和独立应用数据目录。
- **不在首次启动下载运行时**：发布构建在 CI 中完成 Runtime 装配、裁剪和逐文件 SHA-256 校验，启动时只使用包内制品。
- **安全隔离**：Harness Web UI 运行在 sandboxed Electron renderer 中，无 Node integration；外部链接交给系统浏览器。
- **干净退出**：桌面端监管完整 Harness 子进程树，退出后回收进程并释放随机 loopback 端口。
- **可审计发布**：Runtime 锁定上游提交与平台制品；无侵入裁剪只作用于 DeepSeek Work 的暂存副本，不修改 Harness 仓库。

## 下载

前往 [GitHub Releases](https://github.com/astraclawteam/deepseek-work/releases) 获取最新版本：

| 平台 | 推荐文件 | 发布保障 |
|---|---|---|
| Windows 10/11 x64 | `DeepSeek-Work-Setup-*-x64.exe` | SimplySign Desktop + Certum 企业 Authenticode 签名与可信时间戳 |
| macOS Apple Silicon | `DeepSeek-Work-*-macOS-arm64.dmg` | 原生 arm64 构建；正式标签要求 Developer ID 签名与 Apple notarization |

安装后直接启动 DeepSeek Work，再按 Harness 界面提示配置模型凭据即可。凭据始终是本机运行时输入，不会写入本仓库或发布制品。

## 它如何工作

```text
DeepSeek Work / Electron
  ├─ 验证包内 Runtime 清单与入口
  ├─ 启动内置 Node.js + DeepSeek Harness
  ├─ 等待随机 127.0.0.1 端口就绪并执行 HTTP 健康检查
  ├─ 在安全桌面窗口中加载 Harness Web UI
  └─ 退出时回收完整子进程树
```

桌面壳不复制、不改写 Harness 的 Agent runtime；它只负责平台包装、Runtime 物化、窗口安全和进程监管。更多细节见 [架构说明](docs/architecture.md) 与 [上游来源锁定](docs/upstream.md)。

## 本地开发

要求 Node.js `^22.19.0` 或 `>=24.0.0`、pnpm `11.7.0`，以及位于相邻目录 `../deepseek-harness` 的干净 Harness checkout。

```powershell
pnpm install
pnpm run dev
```

Harness 位于其他位置时设置 `DEEPSEEK_HARNESS_ROOT`。只有兼容的 Node 不在 `PATH` 时才需要设置 `DEEPSEEK_HARNESS_NODE`。

## 构建与验证

```powershell
pnpm run check
pnpm run smoke
pnpm run release:win   # Windows x64，正式入口要求 SimplySign 会话
pnpm run release:mac   # macOS Apple Silicon，自动选择 Developer ID 或显式 ad-hoc 模式
```

发布入口会依次完成 Runtime 准备、品牌资源生成、TypeScript 编译、平台打包、签名验证和 packaged smoke。`build/runtime/runtime-pruning.json` 记录裁剪前后数量、字节数和每类移除原因；内容寻址缓存会在复用前重新验证全部文件。

推送与 `package.json` 版本一致的 `v*` 标签后，统一 GitHub Actions 流水线会并行生成 Windows 与 macOS 制品。只有两端检查、签名和冒烟测试全部成功，才会自动创建 GitHub Release。发布与签名操作说明见 [Release signing](docs/code-signing.md)。

## 参与贡献

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。普通改动通过 PR、至少一名审核者和全部检查进入 `main`；仓库管理员保留发布、应急和维护场景下直接推送 `main` 的权限，任何角色均不得强推或删除 `main`。

DeepSeek Work 使用 [MIT License](LICENSE)。第三方组件及品牌素材来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
