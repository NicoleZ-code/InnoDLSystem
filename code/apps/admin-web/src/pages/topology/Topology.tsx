import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Select, Button, Space, Tag, Typography, Alert } from 'antd';
import { request } from '@innodl/api-client';
import type { SceneCatalog } from '@innodl/power-types';
/** 根据电气连接和开关状态查询供电路径及影响范围。
 * @param props 当前统一目录。
 * @param props.catalog 资产和供电线路目录。
 * @returns 上下游分析和拓扑查询界面。
 */
export function Topology(props: { catalog: SceneCatalog }) {
  const [assetId, setAssetId] = useState('venue');
  const [direction, setDirection] = useState('upstream');
  const result = useQuery({
    queryKey: ['trace', assetId, direction],
    queryFn: () =>
      request<{ assetIds: string[]; lineIds: string[] }>(
        `/api/topology/trace?assetId=${assetId}&direction=${direction}`,
      ),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>供电路径与影响分析</Typography.Title>
          <Typography.Text type="secondary">
            逻辑拓扑独立于地理线路 · 遍历维护 visited 集合处理环网
          </Typography.Text>
        </div>
      </div>
      <Card>
        <Space>
          <Select
            style={{ width: 250 }}
            value={assetId}
            onChange={setAssetId}
            options={props.catalog.assets.map((a) => ({ label: a.name, value: a.id }))}
          />
          <Select
            value={direction}
            style={{ width: 180 }}
            onChange={setDirection}
            options={[
              { label: '上游供电追踪', value: 'upstream' },
              { label: '下游影响范围', value: 'downstream' },
            ]}
          />
          <Button
            type="primary"
            onClick={() => void result.refetch()}
          >
            分析
          </Button>
        </Space>
        <Alert
          style={{ margin: '25px 0' }}
          type="info"
          showIcon
          title="基于模拟拓扑的辅助分析，不作为现场倒闸或设备控制依据"
        />
        <div className="path-nodes">
          {result.data?.assetIds.map((id, index) => (
            <div key={id}>
              <span>{index === 0 ? '起点' : '关联'}</span>
              <b>{props.catalog.assets.find((a) => a.id === id)?.name ?? id}</b>
              <small>{id}</small>
            </div>
          ))}
        </div>
        <Typography.Title level={5}>关联线路</Typography.Title>
        {result.data?.lineIds.map((id) => (
          <Tag
            key={id}
            color="cyan"
          >
            {props.catalog.lines.find((l) => l.id === id)?.name ?? id}
          </Tag>
        ))}
        {result.isError && (
          <Alert
            type="error"
            title={result.error.message}
          />
        )}
      </Card>
    </>
  );
}
