# API 与实时协议

统一前缀 `/api/v1`；旧 `/api` 路径重写到版本前缀供兼容。成功响应 `{code:"OK",message:"success",data,requestId,isDemoData:true}`。列表 `data={items,total,page,pageSize}`，支持 `page`、`pageSize`（≤500）、`q`。错误包含稳定的 `error.code`、`error.message` 与 requestId。数据库引用冲突映射到 409/422。

除登录、刷新和健康检查外，业务 API 需要 `Authorization: Bearer <access>`。刷新 Cookie 仅在 `/api/v1/auth` 路径发送；HTTPS 部署启用 Secure。模型上传地址携带短期 HMAC，不需要把访问令牌放入 URL。

| 路径 | 方法 | 功能 |
| --- | --- | --- |
| /auth/login, /auth/refresh, /auth/logout | POST | 登录与轮换 |
| /auth/me | GET | 当前用户 |
| /users, /users/:id | GET/POST, PATCH | 用户/角色/区域范围 |
| /roles, /roles/:id/permissions | GET, PUT | 角色权限 |
| /catalog/:sceneId | GET | 大屏资产与发布模型目录 |
| /areas, /areas/:id | GET/POST, GET/PUT | 区域维护 |
| /assets, /assets/:id | GET/POST, GET/PUT/DELETE | 资产维护 |
| /power-lines, /power-lines/:id | GET/POST, PUT/DELETE | 地理线路 |
| /assets/geojson | GET | bbox/zoom/type 视域查询 |
| /topology/graph, /topology/paths, /topology/trace | GET | 图、路径、上下游追踪 |
| /topology/edges, /topology/edges/:id | GET, PUT | 独立电气开关状态 |
| /topology/publish | POST | 拓扑版本快照 |
| /measurement-points, /alarm-rules | GET/POST | 测点与规则 |
| /measurement-points/:id, /alarm-rules/:id | PUT | 配置更新 |
| /telemetry/latest, /measurement-history | GET | 真实数据库最新测点与历史 |
| /telemetry/summary, /telemetry/history, /telemetry/replay | GET | 演示快照/历史/只读回放 |
| /simulation | GET/PATCH | 查询/管理员控制公共模拟时钟 |
| /alarms, /alarms/:id | GET | 生命周期告警 |
| /alarms/:id/acknowledge, /alarms/:id/close | POST | 确认/恢复后人工关闭 |
| /protection-events, /protection-events/:id | GET/POST, GET/PUT | 活动与目标 |
| /protection-events/:id/targets, /protection-events/:id/assets | PUT, GET | 目标集合/资产 |
| /protection-plans | GET/POST | 活动预案 |
| /work-orders, /work-orders/:id | GET/POST, GET | 工单与流转日志 |
| /work-orders/:id/{assign,start,submit,review} | POST | 带 version 的状态机操作 |
| /scene-configurations, /scene-configurations/:id | GET, PUT | 场景配置草稿 |
| /scene-models, /scene-models/upload-url | GET, POST | 模型清单与上传登记 |
| /scene-models/:id/complete | POST | 校验上传完成 |
| /scenes/:id/bindings, /scenes/:id/publish | PUT, POST | 绑定与发布 |
| /camera-presets, /camera-presets/:id | GET/POST, PUT | 镜头预设 |
| /reports/protection, /platform/summary, /audit | GET | 汇总与审计 |

工单创建可携带 `Idempotency-Key`；同一账户、相同键和相同请求体复用结果，换请求体返回 409。状态动作要求当前 `version`，重复已完成动作返回 idempotent，旧版本竞争返回 409。operator 不能指派或复核，也不能处理他人的任务；活动告警未恢复时禁止复核关闭。

## WebSocket

同源 `/ws/scene-events`，连接后 5 秒内发送 `{event:"auth",token}`。订阅 `{event:"telemetry.subscribe",assetIds:[]}`（空数组代表授权范围内全部），心跳 `{event:"system.heartbeat"}`。接收完整 `type:"telemetry"`、目录 `type:"catalog"`，以及带 seq/timestamp 的 domain 事件 `telemetry.batch`、`alarm.created`、`alarm.updated`。seq 仅在当前服务进程和连接恢复阶段用于去重，不是跨重启持久化日志偏移；重连以 HTTP 快照恢复。
