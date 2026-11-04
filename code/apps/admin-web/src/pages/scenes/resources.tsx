import { Button } from 'antd';
import type { ResourceConfig } from '../../components/ResourcePage';
import { id, name, type ResourceContext } from '../../router/resource-context';
/** 定义scenes领域的维护表单和业务动作。
 * @param context 共享目录、操作函数和路由上下文。
 * @returns 当前路由的页面定义，未匹配时返回 null。
 */
export function configureScenes(context: ResourceContext): ResourceConfig | null {
  const { path, base, act } = context;
  if (path === '/scenes')
    return {
      ...base,
      title: '三维场景管理',
      description: '管理场景配置与发布版本，未发布草稿不影响大屏',
      endpoint: '/api/scene-configurations',
      columns: [
        ...base.columns,
        { title: '场景模式', dataIndex: 'mode' },
        { title: '修订版本', dataIndex: 'revision' },
      ],
      canEdit: true,
      prepare: (record) => ({ configurationText: JSON.stringify(record.configuration, null, 2) }),
      fields: [
        { name: 'name', label: '场景名称' },
        { name: 'configurationText', label: '场景配置 JSON', type: 'textarea' },
      ],
      transform: (values) => ({
        name: values.name,
        configuration: JSON.parse(String(values.configurationText)),
      }),
      actions: (r, refresh) => (
        <Button
          size="small"
          onClick={() => void act(`/api/scenes/${r.id}/publish`, {}, refresh)}
        >
          发布
        </Button>
      ),
    };
  if (path === '/scenes/cameras')
    return {
      ...base,
      title: '镜头预设',
      description: '以数据定义镜头位置、朝向和过渡时长',
      endpoint: '/api/camera-presets',
      canCreate: true,
      canEdit: true,
      fields: [
        id,
        name,
        {
          name: 'sceneId',
          label: '场景',
          type: 'select',
          options: ['city', 'grid', 'venue', 'equipment'].map((v) => ({ label: v, value: v })),
        },
        { name: 'longitude', label: '经度', type: 'number', initial: 121.302 },
        { name: 'latitude', label: '纬度', type: 'number', initial: 31.188 },
        { name: 'height', label: '高度', type: 'number', initial: 2000 },
        { name: 'duration', label: '飞行时间（秒）', type: 'number', initial: 2 },
      ],
      transform: (v) => ({
        id: v.id,
        name: v.name,
        sceneId: v.sceneId,
        destination: { lng: v.longitude, lat: v.latitude, height: v.height },
        orientation: { heading: 15, pitch: -48, roll: 0 },
        duration: v.duration,
      }),
    };
  return null;
}
