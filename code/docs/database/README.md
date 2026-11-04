# 数据与迁移

`database/migrations/001-core.sql` 建立独立资产、线路、区域、活动、工单、场景、会话、审计及演示快照表；`002-domains.sql` 增加测点/规则、分区历史、最新值、拓扑节点/边/版本、预案、工单日志、模型/绑定/图层/镜头、角色/范围、刷新会话与幂等键。

服务启动在事务和 advisory lock 下执行可重复迁移，基础种子由基础迁移版本控制；不会清空已有数据。Prisma schema 位于 `database/schemas/schema.prisma`，用于测点与规则映射；空间和分区 DDL 由 SQL 管理，不用 prisma db push 代替迁移。

关系约束保证线路端点、活动资产、工单资产和模型绑定有效。规则活动告警有部分唯一索引；工单版本号保护并发；业务变更与对应审计尽可能在同一事务内提交。

telemetry_history 按 ts 范围分区，默认分区可直接运行，正式部署应按留存周期创建月分区并配置归档任务。telemetry_latest 保存每测点最新值；telemetry 保存演示快照，保留最近 86400 tick。Redis 为可选最新值/事件缓存，数据库仍是业务事实来源。

具备 PostGIS 的实例安装扩展、创建 WGS84 Point 和 GiST 索引；普通 PostgreSQL 可使用经纬度字段运行本地演示。当前本机 PostgreSQL 14 不含 PostGIS，所以仅验证普通 PG 路径；Compose 使用带 PostGIS 的镜像。

`pnpm seed:demo` 是显式的扩展种子：保留已有资产，按 demo-* 编码幂等追加 12 站、300 设备、120 线路、800 测点。默认小规模样例便于在无正式资产时验收闭环。

备份示例：`pg_dump "$DATABASE_URL" > innodl.sql`。数据库凭据只放环境变量；不要把备份提交到仓库。Compose 卷在 infra:down 时保留。
