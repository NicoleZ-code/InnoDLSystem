import {
  AppstoreOutlined,
  DatabaseOutlined,
  ApartmentOutlined,
  LineChartOutlined,
  SafetyCertificateOutlined,
  AlertOutlined,
  ToolOutlined,
  DeploymentUnitOutlined,
  BarChartOutlined,
  SettingOutlined,
} from '@ant-design/icons';
export const menuGroups = [
  { label: '工作台', icon: <AppstoreOutlined />, key: '/dashboard' },
  {
    label: '电力资产',
    icon: <DatabaseOutlined />,
    key: 'assets',
    children: [
      { label: '保障区域', key: '/assets/areas' },
      { label: '变电站与场所', key: '/assets/stations' },
      { label: '设备台账', key: '/assets/equipment' },
      { label: '供电线路', key: '/assets/lines' },
    ],
  },
  {
    label: '供电拓扑',
    icon: <ApartmentOutlined />,
    key: 'topology',
    children: [
      { label: '连接关系', key: '/topology/graph' },
      { label: '供电路径分析', key: '/topology/paths' },
    ],
  },
  {
    label: '运行监测',
    icon: <LineChartOutlined />,
    key: 'monitoring',
    children: [
      { label: '监测点配置', key: '/monitoring/points' },
      { label: '实时运行状态', key: '/monitoring/realtime' },
      { label: '历史曲线', key: '/monitoring/history' },
    ],
  },
  {
    label: '重点保电',
    icon: <SafetyCertificateOutlined />,
    key: 'protection',
    children: [
      { label: '保电活动与对象', key: '/protection/events' },
      { label: '保障预案', key: '/protection/plans' },
    ],
  },
  {
    label: '告警处置',
    icon: <AlertOutlined />,
    key: 'alarms',
    children: [
      { label: '告警事件', key: '/alarms/events' },
      { label: '阈值规则', key: '/alarms/rules' },
    ],
  },
  { label: '运维工单', icon: <ToolOutlined />, key: '/work-orders' },
  {
    label: '三维场景',
    icon: <DeploymentUnitOutlined />,
    key: 'scenes',
    children: [
      { label: '场景列表', key: '/scenes' },
      { label: '模型与资产绑定', key: '/scenes/models' },
      { label: '镜头预设', key: '/scenes/cameras' },
    ],
  },
  { label: '分析报表', icon: <BarChartOutlined />, key: '/reports/protection' },
  {
    label: '系统管理',
    icon: <SettingOutlined />,
    key: 'system',
    children: [
      { label: '用户管理', key: '/system/users' },
      { label: '角色权限', key: '/system/roles' },
      { label: '操作审计', key: '/system/audit' },
    ],
  },
];
