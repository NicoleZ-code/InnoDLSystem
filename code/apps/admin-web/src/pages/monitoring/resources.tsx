import type { ResourceConfig } from '../../components/ResourcePage';
import { id, name, type ResourceContext } from '../../router/resource-context';
/** 定义monitoring领域的维护表单和业务动作。
 * @param context 共享目录、操作函数和路由上下文。
 * @returns 当前路由的页面定义，未匹配时返回 null。
 */
export function configureMonitoring(context: ResourceContext): ResourceConfig | null {
  const { path, base, assetOptions } = context;
  if (path === '/monitoring/points')
    return {
      ...base,
      title: '监测点配置',
      description: '一个资产可绑定多个独立测点，测点类型决定模拟值与规则检测',
      endpoint: '/api/measurement-points',
      canCreate: true,
      canEdit: true,
      columns: [
        ...base.columns,
        { title: '资产', dataIndex: 'assetId' },
        { title: '测量类型', dataIndex: 'metric' },
        { title: '单位', dataIndex: 'unit' },
        { title: '启用', dataIndex: 'enabled' },
      ],
      fields: [
        id,
        name,
        { name: 'assetId', label: '关联资产', type: 'select', options: assetOptions },
        {
          name: 'metric',
          label: '测量类型',
          type: 'select',
          options: ['voltage', 'current', 'temperature', 'load'].map((v) => ({
            label: v,
            value: v,
          })),
          initial: 'temperature',
        },
        { name: 'unit', label: '单位', initial: '°C' },
        { name: 'enabled', label: '启用采集', type: 'switch', initial: true },
      ],
      transform: (v) => ({ ...v, quality: 'simulated' }),
    };
  return null;
}
