import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Space,
  Tag,
  App,
  Typography,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { request, requestPage } from '@innodl/api-client';
import { stripSpaces } from '../utils/space';
export interface Field {
  name: string;
  label: string;
  type?: 'date' | 'number' | 'textarea' | 'select' | 'switch' | 'password';
  options?: { label: string; value: string | number }[];
  required?: boolean;
  initial?: unknown;
  disabledOnEdit?: boolean;
}
export interface ResourceConfig {
  title: string;
  description: string;
  endpoint: string;
  fields: Field[];
  columns: {
    title: string;
    dataIndex: string;
    render?: (value: unknown, record: Record<string, unknown>) => React.ReactNode;
  }[];
  canCreate?: boolean;
  canEdit?: boolean;
  deleteEndpoint?: string;
  transform?: (
    values: Record<string, unknown>,
    editing: Record<string, unknown> | null,
  ) => Record<string, unknown>;
  editSuffix?: string;
  prepare?: (record: Record<string, unknown>) => Record<string, unknown>;
  editMethod?: 'PUT' | 'PATCH';
  actions?: (record: Record<string, unknown>, refresh: () => void) => React.ReactNode;
}
/** 统一维护页面，字段、路由和提交映射由业务模块声明。
 * @param props 资源表格与表单配置。
 * @param props.config 当前业务资源的页面定义。
 * @returns 包含查询、编辑、创建和错误反馈的管理页面。
 */
export function ResourcePage(props: { config: ResourceConfig }) {
  const c = props.config;
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [form] = Form.useForm();
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const data = useQuery({
    queryKey: [c.endpoint, pagination, search],
    queryFn: () =>
      requestPage<Record<string, unknown>>(
        `${c.endpoint}?page=${pagination.current}&pageSize=${pagination.pageSize}&q=${encodeURIComponent(search)}`,
      ),
  });
  /** 更新当前资源及工作台缓存。
   * @returns 无返回值，标记关联查询为过期。
   */
  function refresh() {
    void queryClient.invalidateQueries();
  }
  /** 准备编辑或创建表单。
   * @param record 已有数据，null 表示新建。
   * @returns 无返回值，打开模态表单。
   */
  function edit(record: Record<string, unknown> | null) {
    setEditing(record);
    form.resetFields();
    const defaults = Object.fromEntries(
      c.fields.filter((f) => f.initial !== undefined).map((f) => [f.name, f.initial]),
    );
    const position = record?.position as number[] | undefined;
    const destination = record?.destination as
      { lng?: number; lat?: number; height?: number } | undefined;
    form.setFieldsValue({
      ...defaults,
      ...record,
      ...(record && c.prepare ? c.prepare(record) : {}),
      ...(position ? { longitude: position[0], latitude: position[1], height: position[2] } : {}),
      ...(destination
        ? { longitude: destination.lng, latitude: destination.lat, height: destination.height }
        : {}),
      ...(record?.assetIds ? { targetIds: (record.assetIds as string[]).join(',') } : {}),
    });
    setOpen(true);
  }
  /** 提交经过表单校验的业务数据。
   * @returns 完成请求和缓存失效的 Promise。
   */
  async function submit() {
    try {
      const values = await form.validateFields();
      setBusy(true);
      const payload = c.transform ? c.transform(values, editing) : values;
      await request(editing ? `${c.endpoint}/${editing.id}${c.editSuffix ?? ''}` : c.endpoint, {
        method: editing ? (c.editMethod ?? 'PUT') : 'POST',
        body: JSON.stringify(payload),
      });
      setOpen(false);
      refresh();
      void message.success('保存成功');
    } catch (error) {
      if (error instanceof Error) void message.error(error.message);
    } finally {
      setBusy(false);
    }
  }
  const columns = [
    ...c.columns.map((column) => ({
      ...column,
      ellipsis: true,
      render:
        column.render ??
        ((value: unknown) =>
          typeof value === 'boolean' ? (
            <Tag color={value ? 'green' : 'default'}>{value ? '启用' : '停用'}</Tag>
          ) : value === null ? (
            '—'
          ) : typeof value === 'object' ? (
            JSON.stringify(value)
          ) : (
            String(value ?? '—')
          )),
    })),
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_: unknown, record: Record<string, unknown>) => (
        <Space>
          {c.canEdit && (
            <Button
              type="link"
              size="small"
              onClick={() => edit(record)}
            >
              编辑
            </Button>
          )}
          {c.actions?.(record, refresh)}
          {c.deleteEndpoint && (
            <Button
              danger
              type="link"
              size="small"
              onClick={() =>
                Modal.confirm({
                  title: '删除这条业务元数据？',
                  content: '被其他业务引用的资源会由后端拒绝删除。',
                  onOk: async () => {
                    try {
                      await request(`${c.deleteEndpoint}/${record.id}`, { method: 'DELETE' });
                      refresh();
                    } catch (error) {
                      void message.error(String(error));
                    }
                  },
                })
              }
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];
  return (
    <section className="resource-page">
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>{c.title}</Typography.Title>
          <Typography.Text type="secondary">{c.description}</Typography.Text>
        </div>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={refresh}
          >
            刷新
          </Button>
          {c.canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => edit(null)}
            >
              新增
            </Button>
          )}
        </Space>
      </div>
      <div className="table-filter">
        <Input.Search
          placeholder="搜索名称或编码"
          value={search}
          onChange={(e) => {
            setSearch(stripSpaces(e.target.value));
            setPagination((value) => ({ ...value, current: 1 }));
          }}
          allowClear
          style={{ width: 280 }}
        />
        <span>统一资产 ID · 后端持久化</span>
      </div>
      {data.isError && <div className="error-banner">{data.error.message}</div>}
      <Table
        rowKey="id"
        loading={data.isPending}
        dataSource={(data.data?.items ?? []).filter(
          (row) => !search || JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
        )}
        columns={columns}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: data.data?.total ?? 0,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (current, pageSize) => setPagination({ current, pageSize }),
        }}

        scroll={{ x: 850 }}
      />
      <Modal
        title={`${editing ? '编辑' : '新增'}${c.title}`}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        confirmLoading={busy}
        width={640}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          className="resource-form"
        >
          {c.fields.map((field) => (
            <Form.Item
              key={field.name}
              name={field.name}
              label={field.label}
              normalize={stripSpaces}
              getValueProps={
                field.type === 'date'
                  ? (value) => ({
                      value: value
                        ? new Date(
                            Number(value) - new Date(Number(value)).getTimezoneOffset() * 60000,
                          )
                            .toISOString()
                            .slice(0, 16)
                        : '',
                    })
                  : undefined
              }
              getValueFromEvent={
                field.type === 'date'
                  ? (event) => new Date(event.target.value).getTime()
                  : undefined
              }
              valuePropName={field.type === 'switch' ? 'checked' : 'value'}
              rules={[{ required: field.required ?? true, message: `请填写${field.label}` }]}
            >
              {field.type === 'date' ? (
                <Input type="datetime-local" />
              ) : field.type === 'select' ? (
                <Select options={field.options} />
              ) : field.type === 'number' ? (
                <InputNumber style={{ width: '100%' }} />
              ) : field.type === 'textarea' ? (
                <Input.TextArea rows={4} />
              ) : field.type === 'switch' ? (
                <Switch />
              ) : field.type === 'password' ? (
                <Input.Password />
              ) : (
                <Input disabled={!!editing && field.disabledOnEdit} />
              )}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </section>
  );
}
