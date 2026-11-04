import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Table, Tag, Button, Typography } from 'antd';
import { ArrowUpOutlined, ThunderboltOutlined } from '@ant-design/icons';
import * as echarts from 'echarts';
import { request } from '@innodl/api-client';
import type { AlarmRecord, Telemetry } from '@innodl/power-types';
/** 管理工作台，从服务端读取统计、实时告警与历史曲线。
 * @returns 工作台指标、趋势图和待处置告警。
 */
export function Dashboard() {
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => request<Record<string, number>>('/api/platform/summary'),
    refetchInterval: 5000,
  });
  const alarms = useQuery({
    queryKey: ['active-alarms'],
    queryFn: () => request<AlarmRecord[]>('/api/alarms?status=active'),
    refetchInterval: 3000,
  });
  const history = useQuery({
    queryKey: ['history'],
    queryFn: () => request<Telemetry[]>('/api/telemetry/history?limit=180'),
    refetchInterval: 10000,
  });
  const chart = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chart.current) return;
    const instance = echarts.init(chart.current);
    const points = history.data ?? [];
    instance.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 25, top: 25, bottom: 30 },
      xAxis: {
        type: 'category',
        data: points.map((p) => `${p.tick}s`),
        axisLine: { lineStyle: { color: '#bdccd0' } },
      },
      yAxis: { type: 'value', name: '负荷率 %', splitLine: { lineStyle: { color: '#edf2f3' } } },
      series: [
        {
          type: 'line',
          smooth: true,
          data: points.map((p) => p.load),
          showSymbol: false,
          lineStyle: { color: '#087f8c', width: 3 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#087f8c33' },
              { offset: 1, color: '#087f8c00' },
            ]),
          },
        },
      ],
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(chart.current);
    return () => {
      observer.disconnect();
      instance.dispose();
    };
  }, [history.data]);
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>供电保障工作台</Typography.Title>
          <Typography.Text type="secondary">统筹资产、运行状态与保电处置任务</Typography.Text>
        </div>
        <Button
          href="http://localhost:5187/twin/overview"
          target="_blank"
          icon={<ThunderboltOutlined />}
        >
          进入三维指挥大屏
        </Button>
      </div>
      <div className="welcome-banner">
        <div>
          <span>第九届中国国际进口博览会</span>
          <h2>全景感知，守护每一度电。</h2>
          <p>统一资产 · 实时监测 · 协同处置</p>
        </div>
        <div className="banner-status">
          <i />
          保障平台运行中<small>数据来源：服务端模拟采集</small>
        </div>
      </div>
      <Row gutter={[18, 18]}>
        {[
          { key: 'assets', name: '保障资产', unit: '处' },
          { key: 'lines', name: '供电线路', unit: '条' },
          { key: 'activities', name: '进行中保电活动', unit: '项' },
          { key: 'openOrders', name: '待闭环工单', unit: '单' },
        ].map((item) => (
          <Col
            span={6}
            key={item.key}
          >
            <Card>
              <Statistic
                title={item.name}
                value={summary.data?.[item.key] ?? 0}
                suffix={item.unit}
              />
              <div className="metric-note">
                <ArrowUpOutlined /> 数据与统一后端同步
              </div>
            </Card>
          </Col>
        ))}
      </Row>
      <Row
        gutter={18}
        style={{ marginTop: 22 }}
      >
        <Col span={15}>
          <Card
            title="运行负荷趋势"
            extra={<Tag color="cyan">历史采样</Tag>}
          >
            <div
              ref={chart}
              style={{ height: 290 }}
            />
          </Card>
        </Col>
        <Col span={9}>
          <Card
            title="当前活动告警"
            extra={
              <Tag color={alarms.data?.length ? 'orange' : 'green'}>
                {alarms.data?.length ?? 0} 条
              </Tag>
            }
          >
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={alarms.data ?? []}
              locale={{ emptyText: '运行平稳，暂无活动告警' }}
              columns={[
                { title: '告警信息', dataIndex: 'message' },
                {
                  title: '级别',
                  dataIndex: 'severity',
                  width: 70,
                  render: () => <Tag color="orange">关注</Tag>,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
