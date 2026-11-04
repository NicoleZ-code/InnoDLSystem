import type { ResourceConfig } from '../../components/ResourcePage';
import { type ResourceContext } from '../../router/resource-context';
/** 定义topology领域的维护表单和业务动作。
 * @param context 共享目录、操作函数和路由上下文。
 * @returns 当前路由的页面定义，未匹配时返回 null。
 */
export function configureTopology(context: ResourceContext): ResourceConfig | null {
  const { path } = context;
  if (path === '/topology/graph')
    return {
      title: '电气连接与开关状态',
      description: '独立电气连接表；OPEN 和 UNKNOWN 不参与供电路径追踪',
      endpoint: '/api/topology/edges',
      canEdit: true,
      columns: [
        { title: '连接编码', dataIndex: 'id' },
        { title: '电源节点', dataIndex: 'fromNodeId' },
        { title: '受电节点', dataIndex: 'toNodeId' },
        { title: '线路', dataIndex: 'lineId' },
        { title: '开关状态', dataIndex: 'state' },
      ],
      fields: [
        {
          name: 'state',
          label: '开关状态',
          type: 'select',
          options: ['CLOSED', 'OPEN', 'UNKNOWN'].map((value) => ({ label: value, value })),
        },
      ],
    };
  return null;
}
