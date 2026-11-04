import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Layout,
  Menu,
  Button,
  Space,
  Tag,
  Avatar,
  Form,
  Input,
  Card,
  Alert,
  App as AntApp,
  Typography,
  Spin,
} from 'antd';
import { LogoutOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { menuGroups } from '../layouts/navigation';
import { stripSpaces } from '../utils/space';
import { fetchScene, request } from '@innodl/api-client';
import type { SessionUser } from '@innodl/power-types';
import { Dashboard } from '../pages/assets/Dashboard';
import { Monitoring } from '../pages/monitoring/Monitoring';
import { Topology } from '../pages/topology/Topology';
import { ResourcePage } from '../components/ResourcePage';
import { resourceConfig } from '../router/resources';
import { ModelsPage } from '../pages/scenes/ModelsPage';
import { ReportsPage } from '../pages/protection/ReportsPage';
/** 独立综合业务后台，统一登录、路由与资源查询。
 * @returns 登录页或含全部方案 B 管理模块的后台框架。
 */
export function App() {
  const [token, setToken] = useState(sessionStorage.getItem('innodl-token'));
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { message } = AntApp.useApp();
  const user = useQuery({
    queryKey: ['current-user', token],
    queryFn: () => request<SessionUser>('/api/auth/me'),
    retry: false,
    enabled: !!token,
  });
  const catalog = useQuery({
    queryKey: ['admin-catalog'],
    queryFn: fetchScene,
    enabled: !!user.data,
    refetchInterval: 10000,
  });
  useEffect(() => {
    if (location.pathname === '/') navigate('/dashboard', { replace: true });
  }, [location.pathname, navigate]);
  /** 登录并建立后端会话。
   * @param values 用户输入的用户名与密码。
   * @param values.username 登录账户。
   * @param values.password 登录密码。
   * @returns 登录完成的 Promise。
   */
  async function login(values: { username: string; password: string }) {
    setLoginBusy(true);
    setLoginError('');
    try {
      const result = await request<{ token: string; user: SessionUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      sessionStorage.setItem('innodl-token', result.token);
      setToken(result.token);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoginBusy(false);
    }
  }
  /** 退出当前会话并清空浏览器缓存。
   * @returns 完成退出和缓存清理的 Promise。
   */
  async function logout() {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      sessionStorage.removeItem('innodl-token');
      setToken(null);
      client.clear();
    }
  }
  if (!token || user.isError)
    return (
      <div className="login-page">
        <div className="login-story">
          <div className="login-brand">
            <ThunderboltOutlined /> INNO POWER
          </div>
          <h1>
            让电力保障，
            <br />
            全景可见。
          </h1>
          <p>
            全景智慧电力保障系统
            <br />
            综合业务管理平台
          </p>
          <span>ASSETS · MONITORING · PROTECTION</span>
        </div>
        <Card className="login-card">
          <Tag color="cyan">中国国际进口博览会 · 电力保障</Tag>
          <Typography.Title level={2}>登录业务工作台</Typography.Title>
          <p>使用平台账户进入统一资产与保电管理中心</p>
          <Form
            layout="vertical"
            onFinish={(values) => void login(values)}
            initialValues={{ username: 'admin' }}
          >
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true }]}
              normalize={stripSpaces}
            >
              <Input
                size="large"
                autoComplete="username"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true }]}
              normalize={stripSpaces}
            >
              <Input.Password
                size="large"
                autoComplete="current-password"
              />
            </Form.Item>
            {loginError && (
              <Alert
                title={loginError}
                type="error"
                showIcon
              />
            )}
            <Button
              block
              size="large"
              htmlType="submit"
              type="primary"
              loading={loginBusy}
              style={{ marginTop: 20 }}
            >
              登录平台
            </Button>
          </Form>
          <small>首次管理员凭据位于后端 data/bootstrap-admin.txt，或由环境变量配置。</small>
        </Card>
      </div>
    );
  if (!user.data || !catalog.data)
    return (
      <div className="admin-loading">
        <Spin
          size="large"
          tip="正在加载统一业务数据"
        />
        {catalog.isError && (
          <Alert
            type="error"
            title={catalog.error.message}
          />
        )}
      </div>
    );
  const config = resourceConfig(location.pathname, catalog.data, (text) => void message.info(text));
  const content =
    location.pathname === '/dashboard' ? (
      <Dashboard />
    ) : location.pathname === '/monitoring/realtime' ? (
      <Monitoring />
    ) : location.pathname === '/monitoring/history' ? (
      <Monitoring history />
    ) : location.pathname === '/topology/paths' ? (
      <Topology catalog={catalog.data} />
    ) : location.pathname === '/scenes/models' ? (
      <ModelsPage catalog={catalog.data} />
    ) : location.pathname === '/reports/protection' ? (
      <ReportsPage />
    ) : config ? (
      <ResourcePage
        key={location.pathname}
        config={config}
      />
    ) : (
      <Alert
        type="info"
        title="请选择左侧业务模块"
      />
    );
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        width={232}
        theme="dark"
        className="admin-sidebar"
      >
        <div className="admin-logo">
          <ThunderboltOutlined />
          <div>
            <b>智慧供电保障</b>
            <span>INNO POWER PLATFORM</span>
          </div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={['assets', 'protection']}
          items={menuGroups}
          onClick={({ key }) => navigate(key)}
        />
        <div className="sidebar-foot">
          <span />
          统一业务后端 · 在线服务
        </div>
      </Layout.Sider>
      <Layout className="admin-main">
        <Layout.Header className="admin-header">
          <div className="header-context">
            上海进博会<span>/</span>综合业务管理平台
          </div>
          <Space size={18}>
            <Tag color="cyan">模拟数据环境</Tag>
            <Avatar
              size={30}
              style={{ background: '#e5f2f1', color: '#087f8c' }}
            >
              {user.data.username.slice(0, 1).toUpperCase()}
            </Avatar>
            <span>{user.data.username}</span>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => void logout()}
            >
              退出
            </Button>
          </Space>
        </Layout.Header>
        <Layout.Content className="admin-content">{content}</Layout.Content>
        <Layout.Footer className="admin-footer">
          全景智慧电力保障系统 · 统一资产与业务协同平台<span>演示数据 · 辅助监视与决策</span>
        </Layout.Footer>
      </Layout>
    </Layout>
  );
}
