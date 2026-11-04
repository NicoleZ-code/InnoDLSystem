import { request } from '@innodl/api-client';
import type { SceneCatalog } from '@innodl/power-types';
import type { ResourceConfig } from '../components/ResourcePage';
import { configureAssets } from '../pages/assets/resources';
import { configureTopology } from '../pages/topology/resources';
import { configureMonitoring } from '../pages/monitoring/resources';
import { configureAlarms } from '../pages/alarms/resources';
import { configureProtection } from '../pages/protection/resources';
import { configureWorkOrders } from '../pages/work-orders/resources';
import { configureScenes } from '../pages/scenes/resources';
import { configureSystem } from '../pages/system/resources';
import { id, name } from './resource-context';
/** 构建业务路由对应的表格和表单定义。
 * @param path 当前后台页面路径。
 * @param catalog 后端统一资产目录。
 * @param notify 成功或失败提示回调。
 * @returns 当前页面的业务配置；未配置页面返回 null。
 */
export function resourceConfig(
  path: string,
  catalog: SceneCatalog,
  notify: (text: string) => void,
): ResourceConfig | null {
  const assetOptions = catalog.assets.map((a) => ({ label: a.name, value: a.id }));
  const base: Pick<ResourceConfig, 'columns' | 'fields'> = {
    columns: [
      { title: '编码', dataIndex: 'id' },
      { title: '名称', dataIndex: 'name' },
    ],
    fields: [id, name],
  };
  /** 执行状态流转并刷新业务列表。
   * @param url 后端业务操作地址。
   * @param body 操作参数。
   * @param refresh 请求成功后的刷新回调。
   * @returns 完成业务操作的 Promise。
   */
  async function act(url: string, body: Record<string, unknown>, refresh: () => void) {
    try {
      await request(url, { method: 'POST', body: JSON.stringify(body) });
      refresh();
      notify('操作成功');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }
  const context = { path, catalog, base, assetOptions, act };
  for (const configure of [
    configureAssets,
    configureTopology,
    configureMonitoring,
    configureAlarms,
    configureProtection,
    configureWorkOrders,
    configureScenes,
    configureSystem,
  ]) {
    const result = configure(context);
    if (result) return result;
  }
  return null;
}
