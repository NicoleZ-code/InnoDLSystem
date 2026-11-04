import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Form, Select, Upload, Table, Tag, App, Typography, Space } from 'antd';
import { UploadOutlined, DeploymentUnitOutlined } from '@ant-design/icons';
import { request } from '@innodl/api-client';
import type { SceneCatalog } from '@innodl/power-types';
import { stripSpaces } from '../../utils/space';
interface Model {
  id: string;
  name: string;
  file_key: string;
  format: string;
  size: number;
  status: string;
}
/** 模型资源上传与场景资产绑定。
 * @param props 统一资产目录。
 * @param props.catalog 可绑定资产清单。
 * @returns 已授权模型上传和数据驱动绑定页面。
 */
export function ModelsPage(props: { catalog: SceneCatalog }) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const [assetSearch, setAssetSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const models = useQuery({
    queryKey: ['scene-models'],
    queryFn: () => request<Model[]>('/api/scene-models'),
  });
  const bindings = useQuery({
    queryKey: ['model-bindings'],
    queryFn: () => request<Record<string, unknown>[]>('/api/model-bindings'),
  });
  /** 按服务端分配地址上传单个 GLB，完成后登记元数据。
   * @param file 待上传 GLB 文件。
   * @returns false，阻止 Upload 组件另行发送文件。
   */
  async function upload(file: File) {
    setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith('.glb')) throw Error('首期支持 GLB 二进制模型');
      const signed = await request<{ id: string; url: string }>('/api/scene-models/upload-url', {
        method: 'POST',
        body: JSON.stringify({ name: file.name, size: file.size }),
      });
      const response = await fetch(signed.url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': 'model/gltf-binary' },
      });
      if (!response.ok) throw Error('模型文件上传失败');
      await request(`/api/scene-models/${signed.id}/complete`, { method: 'POST', body: '{}' });
      await client.invalidateQueries({ queryKey: ['scene-models'] });
      void message.success('模型上传完成');
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
    return false;
  }
  /** 保存场景、资产和模型的独立关联。
   * @param values 绑定表单值。
   * @param values.sceneId 目标场景。
   * @param values.assetId 资产 ID。
   * @param values.modelId 模型资源 ID。
   * @returns 完成绑定保存的 Promise。
   */
  async function bind(values: { sceneId: string; assetId: string; modelId: string }) {
    try {
      await request(`/api/scenes/${values.sceneId}/bindings`, {
        method: 'PUT',
        body: JSON.stringify({
          bindings: [
            { assetId: values.assetId, modelId: values.modelId, transform: { scale: [1, 1, 1] } },
          ],
        }),
      });
      await client.invalidateQueries({ queryKey: ['model-bindings'] });
      void message.success('资产模型绑定已保存');
    } catch (error) {
      void message.error(String(error));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>模型资源与资产绑定</Typography.Title>
          <Typography.Text type="secondary">
            模型文件、业务台账、场景配置独立管理，通过 assetId 关联
          </Typography.Text>
        </div>
        <Upload
          accept=".glb"
          showUploadList={false}
          beforeUpload={(file) => upload(file)}
        >
          <Button
            type="primary"
            icon={<UploadOutlined />}
            loading={busy}
          >
            上传 GLB 模型
          </Button>
        </Upload>
      </div>
      <div className="models-grid">
        <Card
          title={
            <Space>
              <DeploymentUnitOutlined />
              模型资源
            </Space>
          }
        >
          <Table
            rowKey="id"
            size="small"
            dataSource={models.data ?? []}
            pagination={false}
            columns={[
              { title: '名称', dataIndex: 'name' },
              {
                title: '格式',
                dataIndex: 'format',
                render: (v: string) => <Tag>{v.toUpperCase()}</Tag>,
              },
              { title: '状态', dataIndex: 'status' },
            ]}
          />
        </Card>
        <Card title="建立资产绑定">
          <Form
            layout="vertical"
            onFinish={(values) => void bind(values)}
          >
            <Form.Item
              name="sceneId"
              label="场景"
              rules={[{ required: true }]}
              normalize={stripSpaces}
            >
              <Select
                options={['city', 'venue', 'grid', 'equipment'].map((id) => ({
                  label: id,
                  value: id,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="assetId"
              label="业务资产"
              rules={[{ required: true }]}
              normalize={stripSpaces}
            >
              <Select
                showSearch
                searchValue={assetSearch}
                onSearch={(value) => setAssetSearch(stripSpaces(value))}
                onChange={() => setAssetSearch('')}
                optionFilterProp="label"
                options={props.catalog.assets.map((a) => ({ label: a.name, value: a.id }))}
              />
            </Form.Item>
            <Form.Item
              name="modelId"
              label="模型资源"
              rules={[{ required: true }]}
              normalize={stripSpaces}
            >
              <Select options={models.data?.map((m) => ({ label: m.name, value: m.id }))} />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
            >
              保存绑定
            </Button>
          </Form>
        </Card>
      </div>
      <Card
        title="场景绑定记录"
        style={{ marginTop: 22 }}
      >
        <Table
          rowKey={(row) => `${row.sceneId}-${row.assetId}`}
          dataSource={bindings.data ?? []}
          columns={[
            { title: '场景', dataIndex: 'sceneId' },
            { title: '资产', dataIndex: 'assetId' },
            { title: '模型', dataIndex: 'modelId' },
            {
              title: '空间变换',
              dataIndex: 'transform',
              render: (v: unknown) => JSON.stringify(v),
            },
          ]}
        />
      </Card>
    </>
  );
}
