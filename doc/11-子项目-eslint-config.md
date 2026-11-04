# 11 · 子项目代码架构：`@innodl/eslint-config`

> 路径：`packages/eslint-config/` · 单文件 `index.mjs`（35 行） · `exports: "./index.mjs"` · `scripts: {}`（无 build/typecheck）
> 定位：ESLint 9 flat config 全仓统一配置，落实 `plan.md` 的「逐参数 JSDoc」要求

## 1. 全部配置

```js
import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';

export default ts.config(
  { ignores: [ '**/dist/**', '**/node_modules/**', '**/public/cesium/**',
               '**/.turbo/**', '**/test-results/**', '**/playwright-report/**' ] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': hooks, jsdoc },
    rules: {
      ...hooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      'jsdoc/require-jsdoc': ['error', { require: { FunctionDeclaration: true,
                                                    MethodDefinition: true } }],
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
    },
  },
);
```

根 `code/eslint.config.mjs` 只有一行：`export { default } from './packages/eslint-config/index.mjs';`

## 2. 规则含义

| 规则 | 效果 |
| --- | --- |
| `js.configs.recommended` + `ts.configs.recommended` | JS/TS 基础正确性规则 |
| `react-hooks` recommended | Hooks 调用顺序与依赖数组检查 |
| `no-explicit-any: error` | 禁止 `any`，全仓改用 `unknown` + 收窄 |
| `require-jsdoc`（FunctionDeclaration / MethodDefinition） | **命名函数声明与类方法必须有 JSDoc** |
| `require-param` + `require-param-description` | 每个参数都要有 `@param`，且必须有中文描述 |
| `require-returns` + `require-returns-description` | 必须有 `@returns` 且描述返回结构 |

这与源码实际写法一致，例如 `scripts/dev.mjs` 的 `stop(code)`、`apps/api-server/src/infrastructure/database/postgres.ts` 的 `openPostgres(connectionString, schema)`、`tests/e2e/auth.ts` 的 `login(page, request)` 都带逐参数 `@param` 与 `@returns`。`code/README.md:67` 亦明确「命名函数包含逐参数 `@param` 和 `@returns` 注释」。

**注意**：`require-jsdoc` 只约束 `FunctionDeclaration` 与 `MethodDefinition`，**不约束箭头函数常量**（如 `const fly = (mode) => ...`），因此 JSDoc 覆盖并非 100%。

## 3. 配套工具链

| 环节 | 位置 |
| --- | --- |
| Prettier | `code/.prettierrc.json`、`code/.prettierignore`；根脚本 `format` / `format:check` |
| lint-staged | `code/package.json` 的 `lint-staged` 字段：`*.{ts,tsx,js,mjs}` → `eslint --fix` + `prettier --write`；`*.{json,css,md,yaml}` → `prettier --write` |
| Husky | `code/.husky/pre-commit` 单行 `pnpm exec lint-staged` |
| 安装 | `code/scripts/setup-hooks.mjs`：`existsSync('.git')` 为真才执行 `pnpm exec husky`，否则打印提示（避免修改父级仓库 hooks） |
| 触发 | 根 `package.json` 的 `prepare: node scripts/setup-hooks.mjs` |

> `code/` 目录**尚未初始化 Git**，因此当前钩子实际未启用；后续在 `code/` 初始化 Git 后执行 `pnpm prepare` 即可。

## 4. 设计取舍与已知缺口

1. **依赖冗余**：`package.json` 声明 `"@innodl/power-types": "workspace:*"`，但 `index.mjs` 未 import（配置包不需要类型契约）。
2. **忽略项硬编码**：`**/public/cesium/**` 是为大屏静态 Cesium 资源特设；若将来资源路径变化需同步更新。`apps/twin-screen/dist/cesium/ThirdParty/Workers/package.json` 之类产物靠 `**/dist/**` 屏蔽。
3. **无分层覆盖**：所有 app / packages / tests / scripts 使用同一套规则，未针对测试文件放宽（例如 JSDoc 要求同样作用于 `tests/*.test.ts`）。
4. **无 `tsconfig` 关联**：采用 `typescript-eslint` 的 `configs.recommended`（非 type-checked 变体），不做类型感知分析。
5. **JSDoc 只查存在性**：不校验 `@param` 名称与实参是否对应、不校验类型注解一致性，描述质量靠人工。
6. **钩子依赖 Git 初始化**：`setup-hooks.mjs` 的静默跳过是合理防护，但也意味着 `pnpm lint` 与提交前检查在当前工作区不会自动发生。
