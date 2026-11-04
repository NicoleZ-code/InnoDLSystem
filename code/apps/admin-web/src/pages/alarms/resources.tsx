import { Button, Space, Tag } from 'antd';
import type { ResourceConfig } from '../../components/ResourcePage';
import { id, name, statusNames, type ResourceContext } from '../../router/resource-context';
/** 定义alarms领域的维护表单和业务动作。
 * @param context 共享目录、操作函数和路由上下文。
 * @returns 当前路由的页面定义，未匹配时返回 null。
 */
export function configureAlarms(context: ResourceContext): ResourceConfig | null {
  const { path, base, act } = context;
  if (path === '/alarms/rules')
    return {
      ...base,
      title: '告警阈值规则',
      description: '规则绑定测点，只有越过阈值且状态未恢复时才保留一个有效告警',
      endpoint: '/api/alarm-rules',
      canCreate: true,
      canEdit: true,
      columns: [
        ...base.columns,
        { title: '测点', dataIndex: 'pointId' },
        { title: '阈值', dataIndex: 'threshold' },
        { title: '启用', dataIndex: 'enabled' },
      ],
      fields: [
        id,
        name,
        { name: 'pointId', label: '测点 ID' },
        {
          name: 'operator',
          label: '比较方式',
          type: 'select',
          options: [
            { label: '大于', value: 'gt' },
            { label: '小于', value: 'lt' },
          ],
          initial: 'gt',
        },
        { name: 'threshold', label: '阈值', type: 'number', initial: 55 },
        {
          name: 'severity',
          label: '告警级别',
          type: 'select',
          options: [
            { label: '关注', value: 'attention' },
            { label: '异常', value: 'alarm' },
          ],
          initial: 'attention',
        },
        { name: 'enabled', label: '启用规则', type: 'switch', initial: true },
      ],
    };
  if (path === '/alarms/events')
    return {
      title: '告警处置中心',
      description: '确认不会清除设备异常，恢复与人工关闭独立管理',
      endpoint: '/api/alarms',
      canCreate: false,
      fields: [],
      columns: [
        { title: '告警内容', dataIndex: 'message' },
        { title: '资产', dataIndex: 'assetId' },
        { title: '级别', dataIndex: 'severity' },
        {
          title: '状态',
          dataIndex: 'status',
          render: (v, r) => (
            <Tag color={v === 'active' ? 'orange' : 'green'}>
              {r.acknowledgedAt ? '已确认' : (statusNames[String(v)] ?? String(v))}
            </Tag>
          ),
        },
      ],
      actions: (record, refresh) => (
        <Space>
          {!record.acknowledgedAt && (
            <Button
              size="small"
              onClick={() =>
                void act(
                  `/api/alarms/${record.id}/acknowledge`,
                  { note: '已由运维人员确认' },
                  refresh,
                )
              }
            >
              确认
            </Button>
          )}
          <Button
            size="small"
            onClick={() =>
              window.open(`http://localhost:5187/twin/station/${record.assetId}`, '_blank')
            }
          >
            定位
          </Button>
        </Space>
      ),
    };
  return null;
}
