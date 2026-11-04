import { type Telemetry } from '@innodl/power-types';
import { lineStatus, filterCatalogAssets } from '@innodl/shared-utils';
import { useStore } from '../../stores/scene.store';
import { X } from 'lucide-react';
const basePositions: Record<string, [number, number]> = {
  'station-d': [80, 70],
  'station-e': [280, 70],
  'station-a': [100, 180],
  'station-c': [300, 180],
  'station-b': [300, 285],
  venue: [100, 285],
  transport: [340, 390],
  hotel: [80, 390],
};

/** 节点文字字号（SVG 用户单位），与全站最小字号 12px 保持一致。 */
const NODE_FONT_SIZE = 12;

/** 节点框左右内边距合计，避免文字贴边。 */
const NODE_PADDING = 24;

/** 节点框最小宽度，短名称沿用原有尺寸。 */
const NODE_MIN_WIDTH = 90;

/**
 * 按资产名称估算节点框宽度，中文按整字宽、其他字符按 0.6 字宽累加。
 * @param name 资产名称。
 * @returns 节点框宽度，不小于 NODE_MIN_WIDTH。
 */
function nodeWidth(name: string): number {
  const textWidth = [...name].reduce(
    (total, char) => total + (/[\u3400-\u9fff]/.test(char) ? NODE_FONT_SIZE : NODE_FONT_SIZE * 0.6),
    0,
  );
  return Math.max(NODE_MIN_WIDTH, textWidth + NODE_PADDING);
}

/** 节点框的几何范围，用于电压标签避让。 */
type NodeBox = { left: number; top: number; right: number; bottom: number };

/**
 * 计算电压标签的基线 y，若默认位置压到节点框则上移，仍冲突时移到框下方。
 * @param centerX 标签水平中心。
 * @param baseline 默认基线（连线中点上方 10）。
 * @param label 标签文本，用于估算文字宽度。
 * @param boxes 所有节点框范围。
 * @returns 不与节点框相交的基线 y。
 */
function voltageLabelY(centerX: number, baseline: number, label: string, boxes: NodeBox[]): number {
  const halfWidth = (label.length * NODE_FONT_SIZE * 0.6) / 2;
  const collides = (y: number): NodeBox | undefined =>
    boxes.find(
      (box) =>
        centerX - halfWidth < box.right &&
        centerX + halfWidth > box.left &&
        y - NODE_FONT_SIZE < box.bottom &&
        y + 2 > box.top,
    );
  const hit = collides(baseline);
  if (!hit) {
    return baseline;
  }
  const above = hit.top - 6;
  return collides(above) ? hit.bottom + NODE_FONT_SIZE + 4 : above;
}
/** 供电单线图与地图共用资产、线路 ID。
 * @param props 当前遥测快照。
 * @param props.telemetry 供节点和线路状态联动的遥测数据。
 * @returns 可键盘操作、可与地图联动的 SVG 接线图。
 */
export function Topology(props: { telemetry: Telemetry }) {
  const state = useStore();
  const { assets, lines } = state.catalog;
  const positions: Record<string, [number, number]> = Object.fromEntries(
    assets.map((asset, index) => [
      asset.id,
      basePositions[asset.id] ?? [70 + (index % 3) * 130, 470 + Math.floor(index / 3) * 80],
    ]),
  );
  const height = Math.max(450, ...Object.values(positions).map((position) => position[1] + 50));
  const widths: Record<string, number> = Object.fromEntries(
    assets.map((asset) => [asset.id, nodeWidth(asset.name)]),
  );
  // 视口宽度随最右侧节点自适应，避免长名称把节点框挤出绘图区。
  const diagramWidth = Math.max(
    420,
    ...assets.map((asset) => positions[asset.id][0] + widths[asset.id] / 2 + 12),
  );
  const boxes: NodeBox[] = assets.map((asset) => {
    const [x, y] = positions[asset.id];
    const half = widths[asset.id] / 2;
    return { left: x - half, top: y - 16, right: x + half, bottom: y + 16 };
  });
  const visibleIds = filterCatalogAssets(assets, state.region, state.category).map((a) => a.id);
  return (
    <div className="topology-panel">
      <div className="panel-heading">
        <h2>
          <i />
          供电一次接线图
        </h2>
        <button
          aria-label="关闭接线图"
          onClick={() => state.set({ topology: false })}
        >
          <X size={16} />
        </button>
      </div>
      <div className="topology-caption">双路电源 · 多级保障 · 资产联动</div>
      <svg
        className="topology-diagram"
        viewBox={`0 0 ${diagramWidth} ${height}`}
        preserveAspectRatio="xMidYMin meet"
        aria-label="供电单线图"
      >
        {lines.map((line) => {
          const a = positions[line.fromId];
          const b = positions[line.toId];
          const show =
            state.voltages.includes(line.voltage) &&
            visibleIds.includes(line.fromId) &&
            visibleIds.includes(line.toId);
          return (
            <g
              key={line.id}
              opacity={show ? 1 : 0.12}
              role="button"
              tabIndex={0}
              aria-label={line.name}
              onClick={() => state.select(line.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') state.select(line.id);
              }}
            >
              <path
                d={`M${a[0]} ${a[1] + 18} V${(a[1] + b[1]) / 2} H${b[0]} V${b[1] - 18}`}
                fill="none"
                stroke={lineStatus(line, props.telemetry) === 'normal' ? '#26e6a0' : '#f8bf58'}
                strokeWidth={state.selected === line.id ? 5 : 2}
                style={{ pointerEvents: 'stroke' }}
              />
              <path
                d={`M${a[0]} ${a[1] + 18} V${(a[1] + b[1]) / 2} H${b[0]} V${b[1] - 18}`}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
              />
            </g>
          );
        })}
        {assets.map((asset) => {
          const [x, y] = positions[asset.id];
          return (
            <g
              key={asset.id}
              role="button"
              tabIndex={0}
              aria-label={asset.name}
              onClick={() => state.select(asset.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') state.select(asset.id);
              }}
              opacity={visibleIds.includes(asset.id) ? 1 : 0.2}
            >
              <rect
                x={x - widths[asset.id] / 2}
                y={y - 16}
                width={widths[asset.id]}
                height="32"
                rx="3"
                fill={state.selected === asset.id ? '#165e59' : '#102d3b'}
                stroke={state.selected === asset.id ? '#26e6a0' : '#46626c'}
              />
              <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                fill="#e2f1f4"
                fontSize={NODE_FONT_SIZE}
              >
                {asset.name}
              </text>
            </g>
          );
        })}
        {lines.map((line) => {
          const a = positions[line.fromId];
          const b = positions[line.toId];
          const show =
            state.voltages.includes(line.voltage) &&
            visibleIds.includes(line.fromId) &&
            visibleIds.includes(line.toId);
          return (
            <text
              key={`voltage-${line.id}`}
              x={(a[0] + b[0]) / 2}
              y={voltageLabelY(
                (a[0] + b[0]) / 2,
                (a[1] + b[1]) / 2 - 10,
                `${line.voltage}kV`,
                boxes,
              )}
              textAnchor="middle"
              fill="#a8c4ce"
              fontSize="12"
              opacity={show ? 1 : 0.12}
              stroke="#0a2636"
              strokeWidth="3"
              paintOrder="stroke"
              style={{ pointerEvents: 'none' }}
            >
              {line.voltage}kV
            </text>
          );
        })}
      </svg>
      <p>点击节点或线路，联动右侧资产详情</p>
    </div>
  );
}
