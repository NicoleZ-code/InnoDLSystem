# 12 · 子项目代码架构：`@innodl/mock-telemetry`

> 路径：`tooling/mock-telemetry/`（private） · `server.mjs` **全文 6 行** · `README.md` · `package.json`
> **定位纠正：这不是 WebSocket 服务，不监听任何端口，也没有周期推送。**

## 1. 全部源码

```js
import { telemetryAt } from '@innodl/shared-utils';
// 独立采集适配器样例输出 NDJSON，不再启动绕过认证的第二套 API。
const count = Math.min(3600, Number(process.env.SAMPLES ?? 90));
for (let tick = 0; tick < count; tick++) {
  process.stdout.write(
    `${JSON.stringify({ source: 'simulator', quality: 'SIMULATED', ...telemetryAt(tick) })}\n`,
  );
}
```

启动：根 `package.json` 的 `"mock": "pnpm --filter @innodl/mock-telemetry dev"`，子包 `"dev": "node --import tsx server.mjs"`。

- **输出**：逐行 NDJSON 写到 `process.stdout`，每行 `{source:'simulator', quality:'SIMULATED', ...Telemetry}`，即两个标记字段 + `tick / timestamp / load / voltage / current / alarms`。
- **tick**：`tick` 从 `0` 同步循环到 `count-1`，一次性输出后进程结束；`count = min(3600, SAMPLES ?? 90)`。
- **无定时器、无 `listen()`、无 `WebSocketServer`、无鉴权、无重连、不写数据库**。`README.md` 明确：「本工具不启动第二套 HTTP 服务，不写生产业务表」。

## 2. 与真实后端的对比

| 维度 | mock-telemetry | 真实后端 `apps/api-server` |
| --- | --- | --- |
| 进程形态 | 6 行一次性 stdout 脚本 | Fastify + Nest 常驻服务 |
| 端口 | 无 | `API_PORT` 默认 8787 |
| WS 端点 | 无 | `GET /ws/scene-events`（`@fastify/websocket`） |
| 推送结构 | NDJSON 单行 Telemetry | `ServerEvent`：`telemetry` / `catalog` / `domain`（带 `seq`、`timestamp`） |
| 时钟 | 同步 for 循环 | `setInterval(simulation.advance, 1000)`，唯一权威时钟 |
| 快照生成 | 直接 `telemetryAt(tick)` | `snapshotAt` = `telemetryAt` + 过滤已删除资产告警 + `measurements.sample()` 规则评估 + `repository.record()` 持久化 |
| 鉴权/心跳 | 无 | 5s auth 超时、20s ping、45s 无 pong terminate、按 scope 裁剪 |
| 存储 | 无 | PostgreSQL / Redis（可选）/ MinIO 或本地文件 |

两者**共享同一个 `telemetryAt(tick)` 公式**（`@innodl/shared-utils`），因此样例数据与线上演示数据在数值上完全一致 —— 这是该工具的核心价值：提供一个不触碰生产表、可重定向到文件或其他采集适配器的确定性样本流。

## 3. 设计取舍与已知缺口

1. **命名误导**：包名 `mock-telemetry` + 文件名 `server.mjs` + 依赖 `ws`，容易让人以为存在第二套推送服务；实际它只是 `pnpm mock > samples.ndjson` 这样的样例生成器。README 已澄清，但 `package.json` 的依赖未同步清理。
2. **未使用依赖**：`ws`、`@innodl/power-types` 源码零引用；`tsx` 仅被 `dev` 脚本的 `--import tsx` 使用。
3. **无 `SAMPLES` 文档化**：数量上限 3600 与默认值 90 只在源码与 README 中，未进 `.env.example`。
4. **无背压处理**：`process.stdout.write` 未处理返回值，管道到慢消费者时可能内存堆积（3600 行规模下影响可忽略）。
5. **与方案 B 原文差异**：原文第 1.4 节运行架构图中有独立「数据模拟器」模块；实际把模拟时钟内聚到 `api-server`，本工具降级为离线样例输出，属于有意收窄（避免绕过认证的第二套 API）。这个决定写在源码第 2 行注释里，值得保留。
6. 若要扩展为真实采集适配器，建议保持「只输出 NDJSON」的接口不变，把下游对接放到独立进程，避免重新引入无鉴权的写入口。
