# 10 · 子项目代码架构：`@innodl/ui-components`

> 路径：`packages/ui-components/` · 状态：**占位包（placeholder）**
> `exports: "./src/index.ts"` · `src/index.ts` 全文 10 行 · `dist/index.js` 259 B

## 1. 全部源码

```ts
/** 将连接状态映射为可供任一前端复用的展示信息。 */
export function connectionPresentation(connected: boolean) {
  return {
    label: connected ? '实时链路在线' : '连接待恢复',
    color: connected ? '#16a085' : '#d89614',
  };
}
```

唯一导出 `connectionPresentation(connected: boolean)`，返回推断类型 `{ label: string; color: string }`（无显式返回类型注解）。**没有 import、没有 JSX、没有任何 React 组件**。

`package.json` 声明依赖 `@innodl/power-types: workspace:*`、`react: 18.3.1`、devDep `@types/react` —— **三者源码中全部未使用**。

## 2. 引用情况（全仓检索）

`ui-components` 与 `connectionPresentation` 的命中仅在：

- 自身 `src/index.ts`、`package.json`、`dist/index.js`、`dist/index.d.ts`
- 根 `code/README.md:35`（仅目录名罗列）
- `pnpm-lock.yaml:287`（workspace importer 条目）

**`apps/` 下零引用**；`pnpm-lock.yaml` 中 3 个 app 的 importers 均未声明该包。

## 3. 定位与结论

方案 B 原文第 8 章的 Monorepo 目录规划中列有 `packages/ui-components`，本包是为对齐该目录结构而建的骨架；实际 UI 原子组件并未抽取：

- 大屏使用 `apps/twin-screen/src/components/` 下的 `Panel.tsx`（styled-components）、`Charts.tsx`、`Topology.tsx`、`OperationsPanel.tsx`，全部为 app 私有。
- 后台使用 `apps/admin-web/src/components/ResourcePage.tsx`，也是 app 私有。
- 两 app 的「连接状态」展示各自实现：大屏 `App.tsx` 的 `.live-status` / `useStore.connection`，后台用 antd `Tag "模拟数据环境"`，**没有复用** `connectionPresentation`。

## 4. 设计取舍与已知缺口

1. **名不副实**：包名叫 `ui-components`，内容却是一个纯映射函数，无任何组件；容易让新维护者误判存在共享设计系统。
2. **无消费者**：既不产生运行时价值，也未被 tree-shaking 之外的任何环节使用；`turbo run build` 仍会为它生成 `dist/`。
3. **依赖冗余**：`react`、`@types/react`、`@innodl/power-types` 均为未使用声明，增加安装与锁文件噪音。
4. **后续两条路**：
   - 若继续保留占位 → 建议改名为更贴切的名字，或补充 README 说明「预留、暂不使用」，并清理依赖；
   - 若要真正建共享组件库 → 应抽取两 app 中确实重复的 UI（`page-heading`、状态 Tag、连接指示、面板框），并让 `power-types` 提供 props 契约，同时为 `connectionPresentation` 补显式返回类型与单测。
5. 该包与 `@innodl/eslint-config` 的 `@innodl/power-types` 依赖、`api-client` 的 `@innodl/shared-utils` 依赖、`admin-web` 的 `@innodl/shared-utils` 依赖，共同构成 4 处「声明但未使用」的 workspace 依赖，可在依赖卫生清理时一并处理。
