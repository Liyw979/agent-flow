# 移除主工程里的 Electron 残留

## Summary

- 清理范围限定为主工程，不动 `.opencode/` 这套独立依赖。
- 目标不是“重做迁移”，而是把当前仓库里还会误导协作者或影响交付的残留彻底收尾：空 `electron/` 目录、根工程 `package-lock.json`、以及主工程里仍指向 npm 的命令文案。
- 现状已确认：真实 Electron 运行时依赖已移除，`shared/no-electron-footprint.test.ts` 当前通过；剩余问题主要是仓库清洁度和 Bun 迁移尾巴。

## Key Changes

- 删除主工程 Electron 空壳
  - 删除根目录空的 `electron/` 目录。
  - 保留现有 `cli/`、`runtime/`、`src/` 结构，不做额外目录重命名。

- 清理主工程 npm 残留
  - 删除根目录 `package-lock.json`。
  - 保持 `.opencode/package-lock.json` 不动，因为本次范围已确认不覆盖 `.opencode/`。
  - 为主工程补齐 Bun 作为默认入口所需的声明与锁文件：
    - 提交 `bun.lock`
    - 在 `package.json` 中保留或补充 Bun-first 元信息与脚本约定

- 统一主工程命令文案到 Bun
  - 把 `AGENTS.md` 中所有主工程 `npm run ...` 示例改成 `bun run ...` / `bun test` / `bun install`。
  - 把 `shared/terminal-commands.ts` 生成的 attach 命令从 `npm run cli -- ...` 改成 `bun run cli -- ...`。
  - 同步更新对应测试：`shared/terminal-commands.test.ts`

- 保持 Electron 残留守卫有效
  - 继续保留 `shared/no-electron-footprint.test.ts` 作为回归保护。
  - 视实际改动微调断言，让它继续检查：
    - 根工程不再声明 Electron 依赖
    - 不再存在 `electron.vite.config.ts` / Electron 主进程入口 / preload
    - 脚本和文档不再回指 `electron/cli`
  - 不把 `.opencode/` 纳入这条测试的失败范围，避免误报。

## Test Plan

- 先做最小纯函数/静态断言回归：
  - `bun test shared/no-electron-footprint.test.ts`
  - `bun test shared/terminal-commands.test.ts`
- 再跑主工程基线：
  - `bun test`
  - `bun run build`
- 最后验证命令链路文本与打包命令：
  - `bun run cli -- help`
  - `bun run dist:win`

## Assumptions

- 本次“移除”默认理解为“移除主工程中的 Electron 残留并把主工程命令体系收口到 Bun”，不是清理所有子目录的包管理痕迹。
- `.opencode/` 被视为独立依赖区域，当前不删除它的 `package-lock.json`，也不把它并入本次验收标准。
- 不改动你当前未提交的业务代码，只处理主工程的残留清理与对应测试、文档同步。
