import { useQuery } from '@tanstack/react-query';
import { Card, Table, Button, Typography, Statistic, Row, Col, Space } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { request } from '@innodl/api-client';
interface Report {
  generatedAt: number;
  events: Record<string, unknown>[];
  assetCount: number;
  lineCount: number;
  alarmCount: number;
  closedOrders: number;
  openOrders: number;
}
/** 汇总可导出的保电业务报告。
 * @returns 统计指标、活动表与 JSON 报告下载入口。
 */
export function ReportsPage() {
  const report = useQuery({
    queryKey: ['protection-report'],
    queryFn: () => request<Report>('/api/reports/protection'),
  });
  /** 下载当前后端生成的保电报告。
   * @returns 无返回值，触发浏览器文件下载。
   */
  function download() {
    if (!report.data) return;
    const blob = new Blob([JSON.stringify(report.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '保电活动报告.json';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>保电活动报告</Typography.Title>
          <Typography.Text type="secondary">
            基于当前活动、告警和工单留痕的服务端汇总
          </Typography.Text>
        </div>
        <Space>
          <Button onClick={() => void report.refetch()}>重新生成</Button>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={download}
            disabled={!report.data}
          >
            导出报告
          </Button>
        </Space>
      </div>
      {report.isError && <p className="error-banner">{report.error.message}</p>}
      <Row gutter={20}>
        {[
          { name: '保障资产', key: 'assetCount' },
          { name: '供电线路', key: 'lineCount' },
          { name: '历史告警', key: 'alarmCount' },
          { name: '已闭环工单', key: 'closedOrders' },
        ].map((item) => (
          <Col
            span={6}
            key={item.key}
          >
            <Card>
              <Statistic
                title={item.name}
                value={Number(report.data?.[item.key as keyof Report] ?? 0)}
              />
            </Card>
          </Col>
        ))}
      </Row>
      <Card
        title="保电活动明细"
        style={{ marginTop: 22 }}
      >
        <Table
          rowKey="id"
          loading={report.isPending}
          dataSource={report.data?.events ?? []}
          columns={[
            { title: '活动名称', dataIndex: 'name' },
            { title: '保障级别', dataIndex: 'level' },
            { title: '状态', dataIndex: 'status' },
            { title: '保障对象', dataIndex: 'assetCount' },
          ]}
        />
      </Card>
    </>
  );
}
