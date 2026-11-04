import { Tag } from 'antd';
import type { ResourceConfig } from '../../components/ResourcePage';
import {
  id,
  name,
  typeOptions,
  statusNames,
  type ResourceContext,
} from '../../router/resource-context';
/** 定义assets领域的维护表单和业务动作。
 * @param context 共享目录、操作函数和路由上下文。
 * @returns 当前路由的页面定义，未匹配时返回 null。
 */
export function configureAssets(context: ResourceContext): ResourceConfig | null {
  const { path, catalog, base, assetOptions } = context;
  if (['/assets/stations', '/assets/equipment'].includes(path))
    return {
      ...base,
      title: path.includes('stations') ? '变电站与场所台账' : '电力设备台账',
      description: '统一设备编码、所属区域和空间位置，保存后大屏自动同步',
      endpoint: '/api/assets',
      canCreate: true,
      canEdit: true,
      deleteEndpoint: '/api/assets',
      columns: [
        ...base.columns,
        { title: '类别', dataIndex: 'type' },
        { title: '电压 kV', dataIndex: 'voltage' },
        { title: '区域', dataIndex: 'region' },
        {
          title: '状态',
          dataIndex: 'status',
          render: (v) => <Tag color="green">{statusNames[String(v)] ?? String(v)}</Tag>,
        },
      ],
      fields: [
        id,
        name,
        {
          name: 'type',
          label: '资产类别',
          type: 'select',
          options: typeOptions,
          initial: 'substation',
        },
        {
          name: 'region',
          label: '所属区域',
          type: 'select',
          options: catalog.regions.map((r) => ({ label: r.name, value: r.id })),
          initial: 'core',
        },
        { name: 'longitude', label: '经度', type: 'number', initial: 121.302 },
        { name: 'latitude', label: '纬度', type: 'number', initial: 31.188 },
        { name: 'height', label: '高度（米）', type: 'number', initial: 20 },
        { name: 'voltage', label: '电压（kV）', type: 'number', initial: 110 },
        { name: 'capacity', label: '容量（MVA）', type: 'number', initial: 160 },
      ],
      transform: (values, editing) => ({
        ...Object.fromEntries(
          Object.entries(values).filter(
            ([key]) => !['longitude', 'latitude', 'height'].includes(key),
          ),
        ),
        position: [
          values.longitude ?? (editing?.position as number[])?.[0],
          values.latitude ?? (editing?.position as number[])?.[1],
          values.height ?? (editing?.position as number[])?.[2],
        ],
        status: editing?.status ?? 'normal',
      }),
    };
  if (path === '/assets/areas')
    return {
      ...base,
      title: '保障区域',
      description: '维护保障范围及区域层级',
      endpoint: '/api/areas',
      canCreate: true,
      canEdit: true,
      fields: [
        id,
        name,
        {
          name: 'parentId',
          label: '上级区域',
          required: false,
          type: 'select',
          options: catalog.regions.map((r) => ({ label: r.name, value: r.id })),
        },
      ],
    };
  if (path === '/assets/lines')
    return {
      ...base,
      title: path.includes('topology') ? '电网连接关系' : '供电线路台账',
      description: '线路地理表达和拓扑电气连接通过资产 ID 关联',
      endpoint: '/api/power-lines',
      canCreate: true,
      canEdit: true,
      deleteEndpoint: '/api/power-lines',
      columns: [
        ...base.columns,
        { title: '电源端', dataIndex: 'fromId' },
        { title: '受电端', dataIndex: 'toId' },
        { title: '电压 kV', dataIndex: 'voltage' },
      ],
      fields: [
        id,
        name,
        {
          name: 'fromId',
          label: '电源端资产',
          type: 'select',
          options: assetOptions,
          initial: catalog.assets[0]?.id,
        },
        {
          name: 'toId',
          label: '受电端资产',
          type: 'select',
          options: assetOptions,
          initial: catalog.assets[1]?.id,
        },
        {
          name: 'voltage',
          label: '电压（kV）',
          type: 'select',
          initial: 110,
          options: [10, 35, 110, 220, 500].map((v) => ({ label: `${v} kV`, value: v })),
        },
        { name: 'load', label: '演示负载率（%）', type: 'number', initial: 0 },
      ],
      transform: (values) => ({ ...values, status: 'normal' }),
    };
  return null;
}
