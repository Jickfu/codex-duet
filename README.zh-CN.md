# Codex Duet

[English](README.md) | [简体中文](README.zh-CN.md)

**ChatGPT 负责规划和评审，Codex 负责实现。** 将两者连接成有状态检查、任务记录和不可变评审证据的开发流程。

## 让 Codex 安装到当前项目

在 Codex 中打开目标项目，然后发送：

```text
帮我安装这个 skill 到本项目下：https://github.com/Jickfu/codex-duet
请阅读仓库的 INSTALL.md，完成项目内安装并验证 doctor。
```

Codex 应执行 [INSTALL.md](INSTALL.md)：下载完整分发包，安装到 **`<你的项目>/.agents/skills/codex-duet/`**，安装依赖并验证 `doctor`。只复制 `SKILL.md` 不算完成安装。已有同名安装时会保留原目录，不会覆盖。

需要 **Node.js 20+、npm、Git 和网络连接**。无需 pnpm、源码编译或全局安装。本体来自随包附带的编译产物，其他运行依赖仍从 npm 注册表下载。本项目没有发布到 npm。

> 给 AI 助手：收到安装请求后，应实际执行[安装步骤](INSTALL.md)。不要把它当作启动规划/评审流程或修改用户业务代码的请求。

## 手动安装

[下载独立 skill ZIP](https://raw.githubusercontent.com/Jickfu/codex-duet/main/skill/codex-duet.zip)，解压到临时目录，将以下两个路径替换为实际绝对路径：

```text
npm --prefix "<解压后的codex-duet目录>" run install:project -- --project "<你的项目根目录>"
```

安装器会复制完整 skill、安装依赖并验证可用性。目标目录已存在时会停止。[查看分发目录](skill/codex-duet)。

## 使用已安装的 skill

让 Codex 使用 **codex-duet** 规划、实现并评审任务。Codex 从 `.agents/skills` 发现项目内 skill；如果没有显示，可重启 Codex，或明确要求它读取 `.agents/skills/codex-duet/SKILL.md`。参见 [OpenAI 官方说明](https://learn.chatgpt.com/docs/build-skills)。

在目标项目根目录执行：

```text
node .agents/skills/codex-duet/scripts/chatbridge.mjs doctor
node .agents/skills/codex-duet/scripts/chatbridge.mjs --help
```

`doctor` 检查安装前置条件。GITHUB 任务还需要 GitHub 访问、目标基线中的 Planner/Reviewer 合同，以及所选浏览器连接。安装不会创建合同、提交、推送或发送 ChatGPT 消息。安装后的 skill 文件属于项目新增文件；启动要求干净工作区的流程前，需要决定如何将它们纳入版本管理。

## 支持的流程

| 模式   | ChatGPT 如何读取代码          | 范围                                                 |
| ------ | ----------------------------- | ---------------------------------------------------- |
| GITHUB | 不可变的 GitHub 提交范围      | 附带 skill 流程：规划、实现和多轮评审                |
| LOCAL  | 不可变、只读的 Git 工作区快照 | 提供运行命令和文档；远程访问已完成单用户开发场景验收 |

Codex 始终是唯一执行者。每个任务固定一个浏览器提供方，发送结果不明确时不会自动重发。登录由用户完成。请保留项目的 `.chatbridge` 目录，它保存任务状态和恢复证据。

当前附带的 skill 流程覆盖 GITHUB 模式，LOCAL 使用方法另有文档。安装不会配置隧道、OAuth 授权或 MCP 连接。目前不包含自动创建 PR 或生产级远程部署。

## 文档

- [项目内安装](INSTALL.md)与[安装检查及恢复](docs/installation-and-recovery.md)
- [GITHUB](docs/github-mode.md)、[LOCAL](docs/local-mode.md)与[远程 LOCAL 配置](docs/remote-local-mode.md)
- [浏览器连接](docs/browser-bridge.md)、[协议](docs/protocol.md)与[安全说明](docs/security.md)
- [架构与里程碑状态](docs/architecture.md)
- [分发维护流程](docs/skill-distribution.md)与[验收记录](docs/milestones/M6-skill-distribution.md)

## 开发

源码构建需要 Node >=22.13 和 pnpm 11.17.0：

```text
pnpm install --frozen-lockfile
pnpm build
npm run typecheck
npm run lint
```

更新分发产物请遵循[维护流程](docs/skill-distribution.md)。CI 先在 Windows/Linux/macOS 执行完整回归，再验证 Node 20/22/24 的包安装与 skill 安装。浏览器测试使用本地测试页面，不需要 ChatGPT 账号；真实连接验收范围单独记录。

[Apache-2.0 许可证](LICENSE)。
