import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Select, Typography, Button, Space, Tag } from 'antd';
import * as echarts from 'echarts';
import { request } from '@innodl/api-client';
interface Measurement {
  pointId: string;
  assetId: string;
  metric: string;
  value: number;
  unit: string;
  quality: string;
  timestamp: number;
}
/** 运行监测和历史分析，测点数据来自统一后端。
 * @param props 是否展示历史曲线。
 * @param props.history 历史模式开关。
 * @returns 实时测点表或历史趋势图。
 */
export function Monitoring(props: { history?: boolean }) {
  const [pointId, setPointId] = useState('station-a-temperature');
  const chart = useRef<HTMLDivElement>(null);
  const points = useQuery({
    queryKey: ['monitoring-points'],
    queryFn: () =>
      request<{ id: string; name: string; assetId: string }[]>('/api/measurement-points'),
  });
  const latest = useQuery({
    queryKey: ['measurement-latest'],
    queryFn: () => request<Measurement[]>('/api/telemetry/latest'),
    refetchInterval: 2000,
  });
  const history = useQuery({
    queryKey: ['point-history', pointId],
    queryFn: () =>
      request<{ ts: string; value: number }[]>(`/api/measurement-history?pointId=${pointId}`),
    enabled: !!props.history,
    refetchInterval: 10000,
  });
  useEffect(() => {
    if (!chart.current || !props.history) return;
    const instance = echarts.init(chart.current);
    instance.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: (history.data ?? []).map((p) => new Date(p.ts).toLocaleTimeString('zh-CN')),
      },
      yAxis: { type: 'value' },
      series: [
        {
          type: 'line',
          data: (history.data ?? []).map((p) => p.value),
          showSymbol: false,
          lineStyle: { color: '#087f8c' },
        },
      ],
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(chart.current);
    return () => {
      observer.disconnect();
      instance.dispose();
    };
  }, [history.data, props.history]);
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>
            {props.history ? '历史运行曲线' : '实时运行监测'}
          </Typography.Title>
          <Typography.Text type="secondary">
            按测点独立采集 · 数据质量标记 · 采样时间可追溯
          </Typography.Text>
        </div>
        <Tag color="cyan">服务端模拟采集</Tag>
      </div>
      {props.history ? (
        <Card title="测点趋势">
          <Space style={{ marginBottom: 20 }}>
            <Select
              style={{ width: 360 }}
              value={pointId}
              onChange={setPointId}
              options={points.data?.map((p) => ({
                label: `${p.assetId} · ${p.name}`,
                value: p.id,
              }))}
            />
            <Button onClick={() => void history.refetch()}>刷新历史</Button>
          </Space>
          {history.isError && <p className="error-banner">{history.error.message}</p>}
          <div
            style={{ height: 390 }}
            ref={chart}
          />
        </Card>
      ) : (
        <Table
          rowKey="pointId"
          loading={latest.isPending}
          dataSource={latest.data ?? []}
          columns={[
            { title: '测点', dataIndex: 'pointId' },
            { title: '资产', dataIndex: 'assetId' },
            { title: '类型', dataIndex: 'metric' },
            {
              title: '当前值',
              dataIndex: 'value',
              render: (v: number, r: Measurement) => `${v.toFixed(2)} ${r.unit}`,
            },
            {
              title: '数据质量',
              dataIndex: 'quality',
              render: (v: string) => <Tag color="cyan">{v}</Tag>,
            },
            {
              title: '采样时间',
              dataIndex: 'timestamp',
              render: (v: number) => new Date(v).toLocaleString('zh-CN'),
            },
          ]}
        />
      )}
    </>
  );
}
