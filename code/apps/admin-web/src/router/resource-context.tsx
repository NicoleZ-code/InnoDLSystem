import type { SceneCatalog } from '@innodl/power-types';
import type { ResourceConfig, Field } from '../components/ResourcePage';
export const id: Field = { name: 'id', label: '唯一编码', disabledOnEdit: true };
export const name: Field = { name: 'name', label: '名称' };
export const typeOptions = [
  { label: '变电站', value: 'substation' },
  {label:'开关柜',value:'switchgear'},
  {label:'变压器',value:'transformer'},
  {label:'传感器',value:'sensor'},
  {label:'馈线设备',value:'feeder'},
  { label: '场馆', value: 'venue' },
  { label: '接待酒店', value: 'hotel' },
  { label: '交通枢纽', value: 'transport' },
];
export const statusNames: Record<string, string> = {
  normal: '正常',
  attention: '关注',
  alarm: '异常',
  draft: '草稿',
  active: '进行中',
  completed: '已归档',
  pending: '待分派',
  assigned: '已指派',
  processing: '处理中',
  resolved: '待复核',
  closed: '已关闭',
  published: '已发布',
};
export interface ResourceContext {
  path: string;
  catalog: SceneCatalog;
  base: Pick<ResourceConfig, 'columns' | 'fields'>;
  assetOptions: { label: string; value: string }[];
  act: (url: string, body: Record<string, unknown>, refresh: () => void) => Promise<void>;
}
