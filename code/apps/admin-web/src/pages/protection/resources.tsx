import { Tag } from 'antd';
import type { ResourceConfig } from '../../components/ResourcePage';
import { id, name, statusNames, type ResourceContext } from '../../router/resource-context';
/** 定义protection领域的维护表单和业务动作。
 * @param context 共享目录、操作函数和路由上下文。
 * @returns 当前路由的页面定义，未匹配时返回 null。
 */
export function configureProtection(context: ResourceContext): ResourceConfig | null {
  const { path, base } = context;
  if (path === '/protection/events')
    return {
      ...base,
      title: '重点保电活动',
      description: '维护活动时间、保障等级、预案与对象；存在未闭环工单时不能归档',
      endpoint: '/api/protection-events',
      canCreate: true,
      canEdit: true,
      columns: [
        ...base.columns,
        { title: '保障等级', dataIndex: 'level' },
        { title: '状态', dataIndex: 'status', render: (v) => <Tag>{statusNames[String(v)]}</Tag> },
        {
          title: '保障资产',
          dataIndex: 'assetIds',
          render: (v) => <span>{(v as string[]).length} 处</span>,
        },
      ],
      fields: [
        id,
        name,
        {
          name: 'level',
          label: '保障等级',
          type: 'select',
          options: ['一级', '二级', '三级'].map((v) => ({ label: v, value: v })),
          initial: '一级',
        },
        {
          name: 'status',
          label: '活动状态',
          type: 'select',
          options: [
            { label: '草稿', value: 'draft' },
            { label: '进行中', value: 'active' },
            { label: '已归档', value: 'completed' },
          ],
          initial: 'draft',
        },
        { name: 'plan', label: '保障预案', type: 'textarea', initial: '双路电源保障与现场巡检' },
        {
          name: 'targetIds',
          label: '保障资产编码（以逗号分隔）',
          initial: 'venue,station-a,station-b',
        },
        { name: 'startsAt', label: '开始时间', type: 'date', initial: Date.now() },
        {
          name: 'endsAt',
          label: '结束时间',
          type: 'date',
          initial: Date.now() + 86400000,
        },
      ],
      transform: (v, e) => ({
        ...Object.fromEntries(Object.entries(v).filter(([key]) => key !== 'targetIds')),
        assetIds: String(v.targetIds ?? (e?.assetIds as string[])?.join(',') ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      }),
    };
  if (path === '/protection/plans')
    return {
      ...base,
      title: '保障预案',
      description: '关联保电活动的组织、巡检与应急处置预案',
      endpoint: '/api/protection-plans',
      canCreate: true,
      fields: [
        id,
        name,
        { name: 'eventId', label: '保电活动编码' },
        { name: 'content', label: '保障方案内容', type: 'textarea' },
        {
          name: 'status',
          label: '预案状态',
          type: 'select',
          initial: 'draft',
          options: [
            { label: '草稿', value: 'draft' },
            { label: '已批准', value: 'approved' },
          ],
        },
      ],
    };
  return null;
}
