import type { ResourceConfig } from '../../components/ResourcePage';
import { type ResourceContext } from '../../router/resource-context';
/** 定义system领域的维护表单和业务动作。
 * @param context 共享目录、操作函数和路由上下文。
 * @returns 当前路由的页面定义，未匹配时返回 null。
 */
export function configureSystem(context: ResourceContext): ResourceConfig | null {
  const { path, base } = context;
  if (path === '/system/users')
    return {
      ...base,
      title: '用户管理',
      description: '账户密码加盐存储，后端按角色与数据范围重新鉴权',
      endpoint: '/api/users',
      canCreate: true,
      canEdit: true,
      editMethod: 'PATCH',
      prepare: (record) => ({
        ...record,
        regionIdsText: ((record.regionIds as string[]) ?? []).join(','),
      }),
      transform: (values, editing) =>
        editing
          ? {
              role: values.role,
              regionIds: String(values.regionIdsText ?? '')
                .split(',')
                .map((id) => id.trim())
                .filter(Boolean),
            }
          : { username: values.username, password: values.password, role: values.role },
      columns: [
        { title: '用户名', dataIndex: 'username' },
        { title: '角色', dataIndex: 'role' },
      ],
      fields: [
        { name: 'username', label: '用户名' },
        {
          name: 'password',
          label: '初始密码（新建时至少 12 位，编辑时忽略）',
          type: 'password',
          required: false,
        },
        { name: 'regionIdsText', label: '区域授权编码（逗号分隔，留空表示全域）', required: false },
        {
          name: 'role',
          label: '角色',
          type: 'select',
          initial: 'viewer',
          options: [
            { label: '超级管理员', value: 'admin' },
            { label: '保电管理员', value: 'protection_manager' },
            { label: '运维主管', value: 'supervisor' },
            { label: '运维人员', value: 'operator' },
            { label: '指挥大屏用户', value: 'viewer' },
          ],
        },
      ],
    };
  if (path === '/system/roles')
    return {
      ...base,
      title: '角色权限',
      description: '角色功能权限由后端执行，不依赖菜单隐藏',
      endpoint: '/api/roles',
      columns: [...base.columns, { title: '授权权限', dataIndex: 'permissions' }],
      canEdit: true,
      editSuffix: '/permissions',
      prepare: (record) => ({ permissionsText: (record.permissions as string[]).join(',') }),
      fields: [{ name: 'permissionsText', label: '功能权限（逗号分隔）', type: 'textarea' }],
      transform: (values) => ({
        permissions: String(values.permissionsText)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      }),
    };
  if (path === '/system/audit')
    return {
      title: '操作审计',
      description: '保留业务操作、状态变化和操作者的追踪记录',
      endpoint: '/api/audit',
      columns: [
        { title: '操作', dataIndex: 'action' },
        { title: '资源', dataIndex: 'entityId' },
        { title: '摘要', dataIndex: 'details' },
        {
          title: '发生时间',
          dataIndex: 'timestamp',
          render: (v) => new Date(Number(v)).toLocaleString('zh-CN'),
        },
      ],
      fields: [],
    };
  return null;
}
