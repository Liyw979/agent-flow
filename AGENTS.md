# AGENTS

本文件汇总当前项目的产品定位、运行约定、开发命令与文档同步要求

## 1. 代码要求
- 追求代码熵减，追求代码量变少
- 涉及的方法入参、返回值是否最小化，一个方法只应该传入它需要的参数，比如能传入string，就不要传入一个包装类
- 避免null、undefined、xxx?: T等可空变量，可空入参，可空返回值
- 避免兼容代码, 兜底代码，转换代码，额外状态，normalize方法等代码
- 新增的测试代码，能否直接合入已有的测试中，不要改一行代码，新增几百行测试

- 交付前必须先明确输出：原始任务、是否已经完成、任务完成的代码证据；证据不能只依赖单元测试。
- 每次交付前必须在仓库根目录运行 `bun tsc --noEmit` 与 `bun test --only-failures; bun run knip --fix`；类型检查通过是前置条件，同时要确认没有遗留失败用例与可自动修复的未使用项。
- bug优先，优先使用 `src/runtime/scheduler-script-emulator-migration.test.ts` 这类 script 测试直接验证真实对话流转，并优先复用现有 `config/team-topologies/*.yaml` 或其编译结果。

## 2. 约束

- 禁用词：`收口`。新增或修改文案、注释、提示词、日志、界面文案时都不得使用该表述，统一改为含义更准确的描述。
- 禁止未经同意加入“兜底”， “兼容”代码，当前属于项目初期，尽可能暴露问题，不需要考虑兼容，禁止加入兼容代码

## 3. 项目概览

### 3.1 产品定位

- Agent Team 是面向 OpenCode 的单工作区 Task Code Agent 编排桌面工具。
- 当前系统围绕当前 `cwd` 下的团队拓扑、Task 会话、群聊记录与 Agent 运行态工作，数据模型使用工作区与 Task。
- GUI 主布局为：上方当前 Task 拓扑图，下方左侧当前 Task 群聊，右侧当前 Task Agent 列表；前端只负责展示与聊天发消息，不负责任何配置写入。
- CLI 与 GUI 复用同一套 `Orchestrator`、OpenCode 与文件存储逻辑。
- 核心目标是不让 Agent 停下来

### 3.2 技术栈

- Node.js CLI + 浏览器 Web Host
- React 19 + TypeScript + TailwindCSS
- React Flow
- Zustand
- OpenCode Server (`opencode serve`)
- 文件存储：当前工作区 `.agent-team/` + 用户数据目录日志

## 5. CLI 约定

- CLI 默认使用当前目录作为工作目录，`task headless`、`task ui` 在解析 `--cwd` 时要求目标路径真实存在且为目录；创建 CLI 上下文前都会先执行一次 `opencode --help` 预检查，失败即直接报错。
- CLI 提供 `task headless`、`task ui`：前者会新建当前 Task、打印本轮群聊并在任务结束后退出；后者会新建当前 Task、启动本地 Web Host、打开浏览器页面并持续驻留到 `Ctrl+C` / `SIGTERM`。
- `task ui` 只会使用已构建好的静态资源；启动前会检查 `index.html` 是否存在，浏览器地址与本地 Web Host 监听地址统一使用 `localhost`，缺少入口文件时直接报错。
- CLI / 终端里的 attach 文案都直接显示底层 `opencode attach ...`；当 `group` 新增 runtime agent 且获得新 session 时，会增量打印新的 attach 命令。
- `bun run cli -- ...` 需要在仓库根目录执行；若从其他目录排查目标工作区，`task headless` / `task ui` 必须显式传入 `--cwd`。收到 `Ctrl+C` / `SIGTERM` 时，CLI 会先回收当前命令启动或连接过的全部 OpenCode 实例，再结束进程。

## 6. 开发与打包

开发环境：

```bash
bun install
bun run cli -- help
```

- 前端开发或修改 UI 相关文件后，必须执行 `bun run build`，生成最新的 `dist/web/`，避免浏览器继续读取旧 UI 产物。
- `task ui` 只会读取已构建好的 `dist/web/` 或编译产物内嵌的网页资源；源码运行时若缺少最新 `dist/web/`，或最终静态目录中缺少 `index.html`，会直接报错，不会再自动起 Vite 开发服务器兜底。

常用构建命令：

```bash
bun run build
bun run dist:win
bun run dist:mac-arm64
bun run dist:mac-x64
```

打包注意事项：

- 推荐直接使用 `bun run dist:win`；该命令会先执行 `bun run build` 生成最新 `dist/web/`，再生成单文件 `dist/agent-team.exe`。
- macOS Apple Silicon 打包命令为 `bun run dist:mac-arm64`，产物位于 `dist/agent-team-macos-arm64`。
- macOS Intel 打包命令为 `bun run dist:mac-x64`，产物位于 `dist/agent-team-macos-x64`。
- Windows 主程序位于 `dist/agent-team.exe`。
- 打包后的网页静态资源会连同 `index.html` 一起内嵌在编译产物中，并在运行时自动释放到本地 runtime 目录；若编译产物缺少这个入口文件，`task ui` 会直接报错，不会继续启动空壳 Web Host。
- 如果只想单独刷新网页产物，可以执行 `bun run build`。
- 每次修改前端页面、样式或共享前端数据结构后，都必须执行 `bun run build`，把最新的 UI 产物刷新到 `dist/web/`。

## 7. 文档同步要求

以下变更必须同步检查并在需要时更新本文件：

- 默认 Agent 模板变化
- 内置 Agent 集合变化
- 默认拓扑推断规则变化
- Project 全局注册或 Project 内 `.agent-team/` 存储布局变化
- CLI 命令、别名或默认行为变化
- 会影响协作者理解当前系统行为的 UI 或编排逻辑变化
