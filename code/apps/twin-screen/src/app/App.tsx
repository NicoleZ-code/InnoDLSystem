import { useTwinRoute } from '../hooks/useTwinRoute';
import { Suspense, lazy, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  Cpu,
  Expand,
  Eye,
  Focus,
  Hotel,
  Layers3,
  Maximize,
  Network,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Route,
  ShieldCheck,
  TrainFront,
  Unplug,
  X,
  Zap,
} from 'lucide-react';
import { type AssetType, type SceneMode } from '@innodl/power-types';
import { filterCatalogAssets, assetStatus } from '@innodl/shared-utils';
import { useStore } from '../stores/scene.store';
import { useSceneData, useSimulation } from '../hooks/useSceneData';
import { Panel } from '../components/panels/Panel';
import { Gauge, LoadChart } from '../components/charts/Charts';
import { Topology } from '../components/scene-ui/Topology';
import { Login } from '../pages/overview/Login';
import { OperationsPanel } from '../components/panels/OperationsPanel';
const CityScene = lazy(() => import('../engine/CityScene'));
const EquipmentScene = lazy(() => import('../engine/EquipmentScene'));
const modes: { id: SceneMode; name: string; en: string }[] = [
  { id: 'city', name: '全景态势', en: 'OVERVIEW' },
  { id: 'grid', name: '电网运行', en: 'POWER GRID' },
  { id: 'venue', name: '重点保电', en: 'PROTECTION' },
  { id: 'equipment', name: '设备监测', en: 'EQUIPMENT' },
];
const categories = [
  { type: 'venue', name: '国家会展中心', en: 'Exhibition center', icon: Building2 },
  { type: 'hotel', name: '接待酒店', en: 'Reception hotels', icon: Hotel },
  { type: 'transport', name: '交通枢纽', en: 'Transport hubs', icon: TrainFront },
  { type: 'substation', name: '变电站', en: 'Substations', icon: Zap },
] as const;
const componentNames: Record<string, string> = {
  cabinet: '柜体外壳',
  door: '前柜门',
  meter: '智能仪表',
  breaker: '真空断路器',
  busbar: '铜排母线',
  handle: '柜门把手',
  floor: '设备基座',
};
/** 大屏业务入口，三维与统计共用同一业务快照。
 * @returns 完整的供电保障监控界面。
 */
export function App() {
  const state = useStore();
  const changeMode = useTwinRoute();
  const { assets, lines } = state.catalog;
  const telemetry = useSimulation();
  const sceneData = useSceneData();
  const [layerOpen, setLayerOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [operations, setOperations] = useState(false);
  const [alarmOnly, setAlarmOnly] = useState(false);
  const filtered = filterCatalogAssets(assets, state.region, state.category).filter(
    (asset) => !state.protectedIds || state.protectedIds.includes(asset.id),
  );
  const selectedLine = lines.find((line) => line.id === state.selected);
  const selected = assets.find((a) => a.id === state.selected) ??
    assets.find((a) => a.id === selectedLine?.fromId) ??
    assets[0] ?? {
      id: 'none',
      name: '暂无保障对象',
      type: 'venue' as const,
      region: 'shanghai' as const,
      position: [0, 0, 0],
      voltage: 0,
      capacity: 0,
      status: 'normal' as const,
    };
  const visibleAlarms = telemetry.alarms.filter((alarm) =>
    filtered.some((a) => a.id === alarm.assetId),
  );
  const display = filtered.filter((a) => !alarmOnly || assetStatus(a.id, telemetry) !== 'normal');
  const lineCount = lines.filter(
    (l) =>
      state.voltages.includes(l.voltage) &&
      filtered.some((a) => a.id === l.fromId) &&
      filtered.some((a) => a.id === l.toId),
  ).length;
  const time = new Date(telemetry.timestamp).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
  /** 按资源类型筛选并聚焦。
   * @param type 底部资源类别。
   * @returns 无返回值，地图与清单使用同一过滤条件。
   */
  function changeCategory(type: AssetType) {
    const category = state.category === type ? undefined : type;
    const match = filterCatalogAssets(assets, state.region, category)[0];
    state.set({
      category,
      selected: match?.id ?? state.selected,
      mode: type === 'venue' ? 'venue' : state.mode === 'equipment' ? 'city' : state.mode,
    });
  }
  /** 下载当前区域的只读演示快照。
   * @returns 无返回值，浏览器下载 JSON 文件。
   */
  function exportSnapshot() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            isDemoData: true,
            region: state.region,
            assets: filtered,
            telemetry,
            visibleLineCount: lineCount,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '供电保障-演示快照.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }
  /** 切换浏览器全屏。
   * @returns 完成全屏切换的 Promise。
   */
  async function fullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }
  if (sceneData.isError && /登录|权限/.test(sceneData.error.message))
    return <Login onSuccess={() => void sceneData.refetch()} />;
  if (sceneData.isPending || sceneData.isError)
    return (
      <div className="dashboard">
        <div className="scene-loading">
          <div>
            {sceneData.isError
              ? `后端连接失败：${sceneData.error.message}`
              : '正在从后端加载供电保障数据…'}
          </div>
          {sceneData.isError && <button onClick={() => void sceneData.refetch()}>重新连接</button>}
        </div>
      </div>
    );
  return (
    <div className="dashboard">
      <div className="scene-host">
        <Suspense
          fallback={
            <div className="scene-loading">
              <span className="spinner" />
              正在加载三维引擎…
            </div>
          }
        >
          {state.mode === 'equipment' ? (
            <EquipmentScene />
          ) : (
            <CityScene key={state.catalog.revision} />
          )}
        </Suspense>
      </div>
      <div className="scene-vignette" />
      <header className="header">
        <div className="brand">
          <div className="brand-mark">
            <Zap size={24} />
          </div>
          <div>
            <h1>全景智慧供电保障系统</h1>
            <p>PANORAMIC SMART POWER ASSURANCE</p>
          </div>
          <span className="brand-divider" />
          <div className="event-brand">
            中国国际进口博览会<span>CHINA INTERNATIONAL IMPORT EXPO</span>
          </div>
        </div>
        <div className="header-right">
          <button
            className="maintenance-button"
            onClick={() => setOperations(true)}
          >
            数据维护
          </button>
          <span className="live-status">
            <i />
            {state.connection === 'online'
              ? '实时数据已连接'
              : state.connection === 'offline'
                ? '独立离线演示'
                : '连接中断 · 保留最后数据'}
          </span>
          <div className="clock">
            {time}
            <span>2026.11.04 星期三</span>
          </div>
          <div className="weather">
            ☁ <strong>24°</strong>
            <span>上海 · 多云</span>
          </div>
          <button
            className="icon-button"
            aria-label="使用说明"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="全屏显示"
            onClick={fullscreen}
          >
            <Expand size={18} />
          </button>
        </div>
      </header>
      <nav
        className="main-nav"
        aria-label="场景导航"
      >
        <div className="region-select">
          <Compass size={15} />
          <select
            aria-label="选择保障区域"
            value={state.region}
            onChange={(e) =>
              state.set({
                region: e.target.value as typeof state.region,
                category: undefined,
                selected:
                  filterCatalogAssets(assets, e.target.value as typeof state.region)[0]?.id ??
                  'venue',
              })
            }
          >
            {state.catalog.regions.map(({ id, name }) => (
              <option
                key={id}
                value={id}
              >
                {name}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </div>
        <div className="nav-tabs">
          {modes.map((m) => (
            <button
              key={m.id}
              className={state.mode === m.id ? 'active' : ''}
              onClick={() => changeMode(m.id)}
            >
              <span>{m.name}</span>
              <small>{m.en}</small>
            </button>
          ))}
        </div>
        <div className="nav-meta">
          <span className="demo-badge">DEMO</span>演示数据 · 服务端驱动
        </div>
      </nav>
      <aside className="left-panels">
        <Panel
          title="保电运行总览"
          subtitle="OPERATION OVERVIEW"
        >
          <div className="status-strip">
            <ShieldCheck size={18} />
            <div>
              进博保电保障进行中
              <span>
                {state.catalog.regions.find((region) => region.id === state.region)?.name ??
                  state.region}{' '}
                · 多级供电协同保障
              </span>
            </div>
            <span className="status-tag">{visibleAlarms.length ? "关注" : "正常"}</span>
          </div>
          <div className="primary-metrics">
            <div>
              <span>保障对象</span>
              <strong>
                {filtered.length.toString().padStart(2, '0')}
                <small>处</small>
              </strong>
            </div>
            <div>
              <span>在线供电线路</span>
              <strong>
                {lineCount.toString().padStart(2, '0')}
                <small>条</small>
              </strong>
            </div>
          </div>
          <div className="mini-metrics">
            <div>
              <Radio size={14} />
              <span>在线监测</span>
              <b>
                {filtered.length}/{filtered.length}
              </b>
            </div>
            <div>
              <Activity size={14} />
              <span>活动预警</span>
              <b className={visibleAlarms.length ? 'amber' : ''}>
                {visibleAlarms.length.toString().padStart(2, '0')}
              </b>
            </div>
          </div>
        </Panel>
        <Panel
          title="当日负荷趋势"
          subtitle="LOAD TREND"
        >
          <div className="total-load">
            <span>核心保电区用电负荷</span>
            <strong>
              {(80 + telemetry.load * 0.72).toFixed(2)} <small>MW</small>
            </strong>
            <em>
              较昨日 <span>↓ 2.36%</span>
            </em>
          </div>
          <LoadChart
            load={telemetry.load}
            tick={state.tick}
          />
        </Panel>
        <Panel
          title="供电保障指标"
          subtitle="ASSURANCE INDEX"
        >
          <div className="gauges">
            <Gauge
              name="供电可靠率"
              value="99.99"
            />
            <Gauge
              name="电压合格率"
              value="100"
            />
            <Gauge
              name="设备在线率"
              value="100"
            />
          </div>
          <div className="resource-row">
            <span>应急保障队伍</span>
            <b>
              24 <small>支</small>
            </b>
            <span>现场保障人员</span>
            <b>
              286 <small>人</small>
            </b>
          </div>
        </Panel>
        <button
          className="map-locator"
          onClick={state.reset}
          title="返回上海全网"
        >
          <svg
            viewBox="0 0 120 86"
            aria-hidden="true"
          >
            <path
              d="M22 49L32 29 48 35 55 13 74 20 72 37 100 35 92 53 76 61 73 77 52 65 34 69Z"
              fill="#173e49"
              stroke="#59818a"
            />
            <path
              d="M35 52L79 42M56 25L62 69"
              stroke="#2a5b64"
            />
            <circle
              cx="58"
              cy="48"
              r="12"
              fill="none"
              stroke="#26e6a0"
            />
            <circle
              cx="58"
              cy="48"
              r="4"
              fill="#26e6a0"
            />
          </svg>
          <div>
            <b>上海市</b>
            <span>SHANGHAI</span>
            <small>
              <Focus size={11} />
              返回全景
            </small>
          </div>
          <span className="locator-n">N ↑</span>
        </button>
      </aside>
      <div className="scene-title">
        <span className="scene-eyebrow">
          {state.mode === 'equipment' ? 'EQUIPMENT DIGITAL TWIN' : 'SHANGHAI · POWER DIGITAL TWIN'}
        </span>
        <h2>
          {state.mode === 'venue'
            ? '国家会展中心'
            : state.mode === 'equipment'
              ? '配电设备数字孪生'
              : state.mode === 'grid'
                ? '城市电网运行态势'
                : '上海全景保障态势'}
        </h2>
        <p>
          <i />
          {state.mode === 'equipment' ? '独立设备场景 · 部件联动' : '双路电源保障 · 全时状态感知'}
          <span>空间模型为本地演示重建</span>
        </p>
      </div>
      <div className="map-toolbar">
        <button
          aria-label="返回全景"
          title="返回全景"
          onClick={state.reset}
        >
          <RotateCcw size={17} />
        </button>
        <button
          className={layerOpen ? 'active' : ''}
          aria-label="图层管理"
          title="图层管理"
          onClick={() => setLayerOpen(!layerOpen)}
        >
          <Layers3 size={18} />
        </button>
        <button
          aria-label="场馆聚焦"
          title="场馆聚焦"
          onClick={() => changeMode('venue')}
        >
          <Focus size={18} />
        </button>
        <button
          className={state.topology ? 'active' : ''}
          aria-label="供电单线图"
          title="供电单线图"
          onClick={() => state.set({ topology: !state.topology })}
        >
          <Network size={18} />
        </button>
      </div>
      {layerOpen && (
        <div className="layer-popover">
          <div className="panel-heading">
            <h2>图层管理</h2>
            <button
              aria-label="关闭图层管理"
              onClick={() => setLayerOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          {(
            [
              { key: 'buildings', name: '城市建筑与道路' },
              { key: 'labels', name: '资产空间标签' },
              { key: 'boundary', name: '重点保障边界' },
            ] as const
          ).map((item) => (
            <label key={item.key}>
              <input
                type="checkbox"
                checked={state[item.key]}
                onChange={(e) => state.set({ [item.key]: e.target.checked })}
              />
              {item.name}
            </label>
          ))}
          <div className="layer-divider">电压等级</div>
          {[500, 220, 110, 35, 10].map((v) => (
            <label key={v}>
              <input
                type="checkbox"
                checked={state.voltages.includes(v)}
                onChange={() =>
                  state.set({
                    voltages: state.voltages.includes(v)
                      ? state.voltages.filter((n) => n !== v)
                      : [...state.voltages, v],
                  })
                }
              />
              <i className={`voltage-dot v${v}`} />
              {v} kV 线路
            </label>
          ))}
        </div>
      )}
      {state.topology && <Topology telemetry={telemetry} />}
      <aside className="right-panels">
        <Panel
          title={state.mode === 'equipment' ? '设备运行参数' : '保障资源监测'}
          subtitle={state.mode === 'equipment' ? 'EQUIPMENT STATUS' : 'RESOURCE MONITORING'}
          action={<span className="online-dot">实时</span>}
        >
          <div className="asset-heading">
            <div className="asset-symbol">
              {state.mode === 'equipment' ? <Cpu size={25} /> : <Building2 size={25} />}
            </div>
            <div>
              <h3>
                {state.mode === 'equipment'
                  ? '10kV 智能配电柜'
                  : (selectedLine?.name ?? selected.name)}
              </h3>
              <span>
                {state.mode === 'equipment'
                  ? 'SWG-NECC-01'
                  : (selectedLine?.id ?? selected.id).toUpperCase()}{' '}
                ·{' '}
                <i className={assetStatus(selected.id, telemetry) === 'normal' ? 'green' : 'amber'}>
                  {assetStatus(selected.id, telemetry) === 'normal' ? '运行正常' : '温度关注'}
                </i>
              </span>
            </div>
          </div>
          <div className="parameter-grid">
            <div>
              <span>运行电压</span>
              <strong>
                {(state.mode === 'equipment'
                  ? telemetry.voltage
                  : (selectedLine?.voltage ?? selected.voltage)
                ).toFixed(2)}
                <small>kV</small>
              </strong>
            </div>
            <div>
              <span>实时电流</span>
              <strong>
                {telemetry.current.toFixed(1)}
                <small>A</small>
              </strong>
            </div>
            <div>
              <span>负载率</span>
              <strong>
                {(state.mode === 'equipment'
                  ? telemetry.load
                  : (selectedLine?.load ?? telemetry.load)
                ).toFixed(1)}
                <small>%</small>
              </strong>
            </div>
            <div>
              <span>{state.mode === 'equipment' ? '柜内温度' : '额定容量'}</span>
              <strong>
                {state.mode === 'equipment'
                  ? visibleAlarms.length
                    ? '58.6'
                    : '28.6'
                  : selected.capacity}
                <small>{state.mode === 'equipment' ? '°C' : 'MVA'}</small>
              </strong>
            </div>
          </div>
          {state.mode === 'equipment' ? (
            <div className="component-detail">
              <span>当前部件</span>
              <b>{componentNames[state.component] ?? state.component}</b>
              <div className="component-list">
                {['breaker', 'busbar', 'door', 'meter'].map((c) => (
                  <button
                    className={state.component === c ? 'active' : ''}
                    key={c}
                    onClick={() => state.set({ component: c })}
                  >
                    {componentNames[c]}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              className="detail-link"
              onClick={() => changeMode('equipment')}
            >
              进入配电设备数字孪生
              <ChevronRight size={14} />
            </button>
          )}
        </Panel>
        <Panel
          title="保电对象清单"
          subtitle="PROTECTED ASSETS"
          action={
            <button
              className={alarmOnly ? 'text-button amber' : 'text-button'}
              onClick={() => setAlarmOnly(!alarmOnly)}
            >
              {alarmOnly ? '全部对象' : '仅看预警'}
              <ChevronDown size={11} />
            </button>
          }
        >
          <div className="asset-table">
            <div className="table-head">
              <span>保障对象 / 设备名称</span>
              <span>运行状态</span>
            </div>
            {display.length === 0 ? (
              <div className="empty-state">
                <ShieldCheck size={22} />
                当前筛选范围无活动预警
              </div>
            ) : (
              display.map((asset) => (
                <button
                  key={asset.id}
                  className={`asset-row ${state.selected === asset.id ? 'selected' : ''}`}
                  onClick={() => state.select(asset.id)}
                >
                  <span className="row-icon">
                    {asset.type === 'substation' ? (
                      <Zap size={15} />
                    ) : asset.type === 'transport' ? (
                      <TrainFront size={15} />
                    ) : asset.type === 'hotel' ? (
                      <Hotel size={15} />
                    ) : (
                      <Building2 size={15} />
                    )}
                  </span>
                  <span>
                    {asset.name}
                    <small>
                      {asset.voltage} kV · {asset.id.toUpperCase()}
                    </small>
                  </span>
                  <em className={assetStatus(asset.id, telemetry) === 'normal' ? 'green' : 'amber'}>
                    <i />
                    {assetStatus(asset.id, telemetry) === 'normal' ? '正常' : '关注'}
                  </em>
                </button>
              ))
            )}
          </div>
          <div className="table-footer">
            共 {filtered.length} 个保障对象
            <span>{state.connection === 'online' ? '后端已同步' : '连接待恢复'}</span>
          </div>
        </Panel>
        <Panel
          title="动态感知"
          subtitle="LIVE EVENTS"
        >
          <div className="event-item">
            <span className={`event-point ${visibleAlarms.length ? 'warning' : ''}`} />
            <div>
              <time>{time}</time>
              <b>{visibleAlarms[0]?.message ?? '全网供电运行平稳，保障资源全部就绪'}</b>
              <p>
                {visibleAlarms.length
                  ? '演示预警 · 55 秒自动恢复'
                  : '设备状态、线路负荷与保障对象持续监测中'}
              </p>
            </div>
          </div>
          <div className="network-health">
            <span>
              <i />
              {state.connection === 'online' ? '遥测链路在线' : '遥测连接中断'}
            </span>
            <span>{state.connection === 'online' ? 'WebSocket 实时推送' : '连接待恢复'}</span>
          </div>
        </Panel>
      </aside>
      <div className="scene-legend">
        {[500, 220, 110, 35, 10].map((v) => (
          <button
            key={v}
            className={!state.voltages.includes(v) ? 'muted' : ''}
            onClick={() =>
              state.set({
                voltages: state.voltages.includes(v)
                  ? state.voltages.filter((n) => n !== v)
                  : [...state.voltages, v],
              })
            }
          >
            <i className={`v${v}`} />
            {v} kV
          </button>
        ))}
        <span>
          <i className="legend-boundary" />
          重点保障区
        </span>
      </div>
      {state.mode === 'equipment' && (
        <div className="equipment-tools">
          <button onClick={() => changeMode('venue')}>
            <ArrowLeft size={15} />
            返回场馆
          </button>
          <button
            className={state.exploded ? 'active' : ''}
            onClick={() => state.set({ exploded: !state.exploded })}
          >
            <Maximize size={15} />
            分解视图
          </button>
          <button
            className={state.cutaway ? 'active' : ''}
            onClick={() => state.set({ cutaway: !state.cutaway })}
          >
            <Eye size={15} />
            内部剖视
          </button>
        </div>
      )}
      <div className="center-bottom">
        <div className="coordinate">
          <span>
            <Compass size={12} />
            31°11′16.8″N 121°18′07.2″E
          </span>
          <span>WGS84 · {state.mode === 'equipment' ? 'LOCAL ENU' : 'CESIUM 3D'}</span>
        </div>
        <nav
          className="resource-dock"
          aria-label="资源导航"
        >
          <div className="dock-caption">
            <span>保障资源</span>
            <small>RESOURCES</small>
          </div>
          {categories.map((item) => (
            <button
              key={item.type}
              className={state.category === item.type ? 'active' : ''}
              disabled={filterCatalogAssets(assets, state.region, item.type).length === 0}
              onClick={() => changeCategory(item.type)}
            >
              <item.icon size={22} />
              <span>
                {item.name}
                <small>{item.en}</small>
              </span>
              <b>
                {filterCatalogAssets(assets, state.region, item.type)
                  .length.toString()
                  .padStart(2, '0')}
              </b>
            </button>
          ))}
          <button
            className={state.mode === 'grid' ? 'active' : ''}
            onClick={() => changeMode('grid')}
          >
            <Route size={22} />
            <span>
              重要供电线路<small>Power networks</small>
            </span>
            <b>{lineCount.toString().padStart(2, '0')}</b>
          </button>
        </nav>
      </div>
      <footer className="bottom-bar">
        <div>
          <span className="footer-logo">
            <Unplug size={15} />
            POWER DIGITAL TWIN
          </span>
          <span className="footer-separator" />
          上海进博会电力保障 · 本地演示系统
        </div>
        <div className="playback">
          <button
            aria-label={state.playing ? '暂停模拟' : '继续模拟'}
            onClick={() => state.set({ playing: !state.playing })}
          >
            {state.playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <span>{state.playing ? '实时模拟' : '回放暂停'}</span>
          <input
            aria-label="遥测回放时间轴"
            type="range"
            min="0"
            max="180"
            value={state.tick % 181}
            onChange={(e) => state.set({ tick: Number(e.target.value), playing: false })}
          />
          <time>
            {Math.floor(state.tick / 60)
              .toString()
              .padStart(2, '0')}
            :{(state.tick % 60).toString().padStart(2, '0')}
          </time>
          <button
            className={state.tour ? 'tour active' : 'tour'}
            onClick={() => state.set({ tour: !state.tour, playing: true })}
          >
            <Play size={12} />
            {state.tour ? '结束巡演' : '自动巡演'}
          </button>
          <button
            title="导出演示快照"
            aria-label="导出演示快照"
            onClick={exportSnapshot}
          >
            <ArrowDownToLine size={14} />
          </button>
        </div>
      </footer>
      {operations && <OperationsPanel onClose={() => setOperations(false)} />}
      {help && (
        <div
          className="modal-backdrop"
          onClick={() => setHelp(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="系统使用说明"
            className="help-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <h2>系统使用说明</h2>
              <button
                autoFocus
                aria-label="关闭说明"
                onClick={() => setHelp(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              通过顶部导航切换城市、电网、场馆与设备场景。鼠标左键拖动平移，滚轮缩放，按住中键或
              Ctrl + 左键旋转视角。
            </p>
            <p>
              点击地图标注、右侧清单或一次接线图，联动同一资产详情。图层管理和底部资源栏可筛选对象与线路。
            </p>
            <p>
              设备场景支持部件点选、分解和内部剖视。底部可暂停模拟、拖动回放，30–54
              秒将产生温度关注事件，55 秒恢复。
            </p>
            <p>
              自动巡演每 12
              秒切换一个场景。所有地理布局、模型与运行指标均为演示重建，不代表真实电网。
            </p>
            <button
              className="primary-button"
              onClick={() => setHelp(false)}
            >
              开始监测
              <ChevronRight size={15} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
