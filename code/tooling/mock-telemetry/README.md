# 模拟采集工具

`pnpm mock` 输出 90 条 NDJSON 遥测包（SAMPLES 可调整），用于开发采集适配器和导入演示。正式运行的唯一模拟时钟位于 api-server 的 telemetry 模块，本工具不启动第二套 HTTP 服务，不写生产业务表。
