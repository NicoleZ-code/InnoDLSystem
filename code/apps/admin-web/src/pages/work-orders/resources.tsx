import { Button, Tag, Modal, Input } from 'antd';
import type { ResourceConfig } from '../../components/ResourcePage';
import { statusNames, type ResourceContext } from '../../router/resource-context';
import { stripSpaces } from '../../utils/space';
/** 定义work-orders领域的维护表单和业务动作。
 * @param context 共享目录、操作函数和路由上下文。
 * @returns 当前路由的页面定义，未匹配时返回 null。
 */
export function configureWorkOrders(context: ResourceContext): ResourceConfig | null {
  const { path, assetOptions, act } = context;
  if (path === '/work-orders')
    return {
      title: '运维工单管理',
      description: '工单按待分派、已指派、处理中、待复核、已关闭流转；恢复后人工复核',
      endpoint: '/api/work-orders',
      canCreate: true,
      fields: [
        { name: 'title', label: '工单主题' },
        { name: 'assetId', label: '关联资产', type: 'select', options: assetOptions },
        { name: 'alarmId', label: '关联告警 ID', required: false },
        { name: 'eventId', label: '保电活动 ID', required: false },
        { name: 'assignee', label: '指派人员', initial: 'admin' },
      ],
      columns: [
        { title: '主题', dataIndex: 'title' },
        { title: '资产', dataIndex: 'assetId' },
        { title: '处理人', dataIndex: 'assignee' },
        {
          title: '状态',
          dataIndex: 'status',
          render: (v) => <Tag>{statusNames[String(v)] ?? String(v)}</Tag>,
        },
        { title: '反馈', dataIndex: 'feedback' },
      ],
      transform: (v) => ({ ...v, alarmId: v.alarmId || null, eventId: v.eventId || null }),
      actions: (record, refresh) => {
        const operation =
          record.status === 'pending'
            ? 'assign'
            : record.status === 'assigned'
              ? 'start'
              : record.status === 'processing'
                ? 'submit'
                : record.status === 'resolved'
                  ? 'review'
                  : null;
        return (
          operation && (
            <Button
              size="small"
              onClick={() => {
                if (operation === 'submit') {
                  let feedback = '';
                  Modal.confirm({
                    title: '提交现场处理记录',
                    content: (
                      <Input.TextArea
                        onChange={(e) => {
                          e.target.value = stripSpaces(e.target.value);
                          feedback = e.target.value;
                        }}
                      />
                    ),
                    onOk: () =>
                      act(
                        `/api/work-orders/${record.id}/submit`,
                        { feedback, version: record.version },
                        refresh,
                      ),
                  });
                } else
                  void act(
                    `/api/work-orders/${record.id}/${operation}`,
                    { assignee: record.assignee, approved: true, version: record.version },
                    refresh,
                  );
              }}
            >
              {operation === 'assign'
                ? '指派'
                : operation === 'start'
                  ? '开始处理'
                  : operation === 'submit'
                    ? '提交复核'
                    : '复核关闭'}
            </Button>
          )
        );
      },
    };
  return null;
}
