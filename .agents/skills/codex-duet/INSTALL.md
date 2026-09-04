# 安装 Codex Duet skill

下载仓库中的整个 `skill/codex-duet` 文件夹，或下载仓库 ZIP 后取出这个目录。不要只下载 `SKILL.md`。目录已包含编译产物，无需克隆源码、pnpm、TypeScript 编译或全局安装。

需要 Node.js 20+（含 npm）、Git，以及可用的 Codex 浏览器能力或 Playwright 浏览器连接。第一次安装依赖需要联网；`codex-duet` 本体来自随包附带的 tarball，不从 npm 注册表获取。浏览器登录和连接按任务单独设置。

把目录放到你的 skill 安装位置，或直接让 Codex 读取该目录的 `SKILL.md`。在该目录打开终端执行：

```text
npm run setup
node scripts/chatbridge.mjs doctor
```

setup 先核对编译包 SHA-512，再安装到当前 skill 自己的 `node_modules`，禁用依赖生命周期脚本、浏览器下载和 npm 审计请求。不会更改全局 PATH、安装全局命令、连接 ChatGPT 或创建任务。其他运行依赖仍从 npm 注册表下载，因此不是完全离线包。

开始工作时，终端切到**目标项目根目录**，使用绝对路径执行：

```text
node "<skill目录的绝对路径>/scripts/chatbridge.mjs" doctor
node "<skill目录的绝对路径>/scripts/chatbridge.mjs" duet status --task <已有任务ID>
```

让 Codex 使用该目录的 `SKILL.md` 执行 GITHUB 规划和评审流程。首次任务还需要 GitHub 访问、目标仓库的 Planner/Reviewer 合同和浏览器连接。安装通过不代表这些任务前置条件已满足。LOCAL 使用方法在安装后的 `node_modules/codex-duet/docs/local-mode.md`。

更新时把新版放入一个新的目录，重新执行 setup 和 doctor，通过后再切换所用 skill 路径。已有项目的 `.chatbridge` 保存任务与恢复证据，不能删除或搬到安装目录。不要在运行中的任务里混用不同版本。
