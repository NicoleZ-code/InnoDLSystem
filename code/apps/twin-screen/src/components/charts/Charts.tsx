/** 生成日负荷趋势图及当前时刻游标。
 * @param props 实时负荷率和时间轴位置。
 * @param props.load 当前负荷率，单位百分比。
 * @param props.tick 当前回放秒数。
 * @returns 带渐变填充的 SVG 折线图。
 */
export function LoadChart(props: { load: number; tick: number }) {
  const values = [
    35, 33, 30, 29, 32, 40, 49, 58, 65, 74, 78, 80, 74, 70, 73, 78, 82, 91, 84, 73, 61, 50, 43, 38,
  ];
  const points = values.map((v, i) => `${i * 11.65},${108 - v}`).join(' ');
  const x = ((props.tick % 240) / 240) * 268;
  return (
    <div className="load-chart">
      <div className="chart-key">
        <span>
          <i />
          上海全网
        </span>
        <span>
          <i />
          核心保电区
        </span>
      </div>
      <svg
        viewBox="0 0 280 140"
        role="img"
        aria-label="24小时负荷曲线"
      >
        <defs>
          <linearGradient
            id="load-fill"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              stopColor="#26e6a0"
              stopOpacity=".25"
            />
            <stop
              offset="1"
              stopColor="#26e6a0"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        {[25, 55, 85, 115].map((y, i) => (
          <g key={y}>
            <line
              x1="0"
              x2="270"
              y1={y}
              y2={y}
              stroke="#28434e"
              strokeDasharray="2 4"
            />
            <text
              x="0"
              y={y - 5}
              fill="#6b8793"
              fontSize="12"
            >
              {(90 - i * 20).toFixed(0)}%
            </text>
          </g>
        ))}
        <polygon
          points={`0,120 ${points} 268,120`}
          fill="url(#load-fill)"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#26e6a0"
          strokeWidth="2"
        />
        <polyline
          points={values.map((v, i) => `${i * 11.65},${120 - v * 0.65}`).join(' ')}
          fill="none"
          stroke="#329dc1"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <line
          x1={x}
          x2={x}
          y1="15"
          y2="120"
          stroke="#d9fff6"
          opacity=".4"
        />
        {['00:00', '06:00', '12:00', '18:00', '24:00'].map((t, i) => (
          <text
            key={t}
            x={i * 60}
            y="136"
            fill="#6b8793"
            fontSize="12"
          >
            {t}
          </text>
        ))}
      </svg>
      <div className="chart-bottom">
        <span>当前负荷率</span>
        <strong>
          {props.load.toFixed(2)}
          <small>%</small>
        </strong>
      </div>
    </div>
  );
}
/** 绘制关键保障指标环。
 * @param props 环形指标的名称、数值和单位。
 * @param props.name 指标显示名称。
 * @param props.value 已格式化的指标数值。
 * @param props.unit 指标单位，默认百分比。
 * @returns CSS 环形仪表。
 */
export function Gauge(props: { name: string; value: string; unit?: string }) {
  return (
    <div className="gauge-item">
      <div className="gauge">
        <strong>
          {props.value}
          <small>{props.unit ?? '%'}</small>
        </strong>
      </div>
      <span>{props.name}</span>
    </div>
  );
}
