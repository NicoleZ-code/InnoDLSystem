import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Save, Trash2 } from 'lucide-react';
import type { Asset, PowerLine } from '@innodl/power-types';
import { useStore } from '../../stores/scene.store';
import {
  acknowledgeAlarm,
  deleteResource,
  fetchAlarms,
  fetchAudit,
  fetchScene,
  saveAsset,
  saveLine,
} from '../../api/client';
const blankAsset: Asset = {
  id: '',
  name: '',
  type: 'substation',
  region: 'core',
  position: [121.302, 31.188, 20],
  voltage: 110,
  capacity: 160,
  status: 'normal',
};
const blankLine: PowerLine = {
  id: '',
  name: '',
  fromId: 'station-a',
  toId: 'venue',
  voltage: 110,
  status: 'normal',
  load: 0,
};
/** 业务数据维护面板，所有操作落到后端并与大屏同步。
 * @param props 关闭面板回调。
 * @param props.onClose 用户关闭维护窗口时执行。
 * @returns 资产、线路、告警处理与审计窗口。
 */
export function OperationsPanel(props: { onClose: () => void }) {
  const { catalog, connection } = useStore();
  const client = useQueryClient();
  const [tab, setTab] = useState<'assets' | 'lines' | 'alarms' | 'audit'>('assets');
  const [asset, setAsset] = useState<Asset>({ ...blankAsset });
  const [line, setLine] = useState<PowerLine>({ ...blankLine });
  const [creating, setCreating] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('已安排现场巡检');
  const alarms = useQuery({
    queryKey: ['alarm-records'],
    queryFn: fetchAlarms,
    enabled: tab === 'alarms',
    refetchInterval: 5000,
  });
  const audit = useQuery({ queryKey: ['audit'], queryFn: fetchAudit, enabled: tab === 'audit' });
  /** 提交元数据变更后重新读取目录和审计，统一反馈结果。
   * @param operation 待执行的后端操作。
   * @returns 完成同步的 Promise。
   */
  async function perform(operation: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await operation();
      const next = await fetchScene();
      useStore.getState().set({ catalog: next });
      client.setQueryData(['scene-assets'], next);
      await client.invalidateQueries({ queryKey: ['alarm-records'] });
      await client.invalidateQueries({ queryKey: ['audit'] });
      setMessage('操作成功，数据已保存至后端');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  /** 提交资产或线路编辑表单。
   * @param event 表单提交事件。
   * @returns 无返回值，启动异步保存与反馈。
   */
  function submit(event: FormEvent) {
    event.preventDefault();
    void perform(() => (tab === 'assets' ? saveAsset(asset, creating) : saveLine(line, creating)));
  }
  return (
    <div className="modal-backdrop">
      <section
        className="operations"
        role="dialog"
        aria-modal="true"
        aria-label="保障数据维护"
      >
        <div className="panel-heading">
          <h2>
            <i />
            保障数据维护
          </h2>
          <button
            aria-label="关闭数据维护"
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="operations-intro">
          资产与线路元数据维护 · 告警处理留痕 · 当前数据来源：演示数据
        </p>
        <nav className="operations-tabs">
          {(
            [
              { id: 'assets', name: '保障资产' },
              { id: 'lines', name: '供电线路' },
              { id: 'alarms', name: '告警处理' },
              { id: 'audit', name: '操作记录' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'active' : ''}
              onClick={() => {
                setTab(item.id);
                setCreating(true);
                setMessage('');
              }}
            >
              {item.name}
            </button>
          ))}
        </nav>
        {(tab === 'assets' || tab === 'lines') && (
          <div className="operations-layout">
            <div className="operations-list">
              <button
                className="new-resource"
                onClick={() => {
                  setCreating(true);
                  setAsset({ ...blankAsset, position: [...blankAsset.position] });
                  setLine({ ...blankLine });
                }}
              >
                <Plus size={14} />
                新增{tab === 'assets' ? '资产' : '线路'}
              </button>
              {tab === 'assets'
                ? catalog.assets.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setAsset({ ...item, position: [...item.position] });
                        setCreating(false);
                      }}
                    >
                      <b>{item.name}</b>
                      <small>{item.id}</small>
                    </button>
                  ))
                : catalog.lines.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setLine({ ...item });
                        setCreating(false);
                      }}
                    >
                      <b>{item.name}</b>
                      <small>{item.voltage} kV</small>
                    </button>
                  ))}
            </div>
            <form onSubmit={submit}>
              <h3>
                {creating ? '新建' : '编辑'}
                {tab === 'assets' ? '保障资产' : '供电线路'}
              </h3>
              <div className="edit-grid">
                <label>
                  唯一标识
                  <input
                    aria-label="资源唯一标识"
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}"
                    disabled={!creating}
                    value={tab === 'assets' ? asset.id : line.id}
                    onChange={(e) =>
                      tab === 'assets'
                        ? setAsset({ ...asset, id: e.target.value })
                        : setLine({ ...line, id: e.target.value })
                    }
                  />
                </label>
                <label>
                  名称
                  <input
                    aria-label="资源名称"
                    required
                    maxLength={100}
                    value={tab === 'assets' ? asset.name : line.name}
                    onChange={(e) =>
                      tab === 'assets'
                        ? setAsset({ ...asset, name: e.target.value })
                        : setLine({ ...line, name: e.target.value })
                    }
                  />
                </label>
                {tab === 'assets' ? (
                  <>
                    <label>
                      资产类别
                      <select
                        value={asset.type}
                        onChange={(e) =>
                          setAsset({ ...asset, type: e.target.value as Asset['type'] })
                        }
                      >
                        <option value="venue">场馆</option>
                        <option value="substation">变电站</option>
                        <option value="transport">交通枢纽</option>
                        <option value="hotel">接待酒店</option>
                      </select>
                    </label>
                    <label>
                      所属区域
                      <select
                        value={asset.region}
                        onChange={(e) =>
                          setAsset({ ...asset, region: e.target.value as Asset['region'] })
                        }
                      >
                        {catalog.regions.map((r) => (
                          <option
                            key={r.id}
                            value={r.id}
                          >
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(['经度', '纬度', '高度（米）'] as const).map((label, index) => (
                      <label key={label}>
                        {label}
                        <input
                          type="number"
                          step="any"
                          required
                          value={asset.position[index]}
                          onChange={(e) => {
                            const position: [number, number, number] = [...asset.position];
                            position[index] = Number(e.target.value);
                            setAsset({ ...asset, position });
                          }}
                        />
                      </label>
                    ))}
                    <label>
                      额定容量（MVA）
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        required
                        value={asset.capacity}
                        onChange={(e) => setAsset({ ...asset, capacity: Number(e.target.value) })}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      供电起点
                      <select
                        value={line.fromId}
                        onChange={(e) => setLine({ ...line, fromId: e.target.value })}
                      >
                        {catalog.assets.map((a) => (
                          <option
                            key={a.id}
                            value={a.id}
                          >
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      供电终点
                      <select
                        value={line.toId}
                        onChange={(e) => setLine({ ...line, toId: e.target.value })}
                      >
                        {catalog.assets.map((a) => (
                          <option
                            key={a.id}
                            value={a.id}
                          >
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      负载率（%）
                      <input
                        type="number"
                        min="0"
                        max="200"
                        step="any"
                        required
                        value={line.load}
                        onChange={(e) => setLine({ ...line, load: Number(e.target.value) })}
                      />
                    </label>
                  </>
                )}
                <label>
                  电压等级（kV）
                  <input
                    type="number"
                    min="0.01"
                    max="2000"
                    step="any"
                    required
                    value={tab === 'assets' ? asset.voltage : line.voltage}
                    onChange={(e) =>
                      tab === 'assets'
                        ? setAsset({ ...asset, voltage: Number(e.target.value) })
                        : setLine({ ...line, voltage: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <div className="edit-actions">
                <button
                  type="submit"
                  disabled={busy || connection !== 'online'}
                >
                  <Save size={14} />
                  {busy ? '保存中…' : '保存'}
                </button>
                {!creating && (
                  <button
                    type="button"
                    className="delete-button"
                    disabled={busy || connection !== 'online'}
                    onClick={() =>
                      void perform(() =>
                        deleteResource(
                          tab === 'assets' ? 'assets' : 'power-lines',
                          tab === 'assets' ? asset.id : line.id,
                        ),
                      ).then(() => setCreating(true))
                    }
                  >
                    <Trash2 size={14} />
                    删除元数据
                  </button>
                )}
              </div>
              <p className="form-hint">
                线路引用中的资产无法删除。操作仅维护演示资源，不下发电网控制指令。
              </p>
            </form>
          </div>
        )}
        {tab === 'alarms' && (
          <div className="operations-records">
            <label className="note-input">
              处理说明
              <input
                aria-label="告警处理说明"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {alarms.isPending ? (
              <p>正在读取告警…</p>
            ) : alarms.isError ? (
              <p role="alert">{alarms.error.message}</p>
            ) : alarms.data.length === 0 ? (
              <p>暂无已采集的告警记录</p>
            ) : (
              alarms.data.map((alarm) => (
                <article key={alarm.id}>
                  <div>
                    <b>{alarm.message}</b>
                    <p>
                      {alarm.status === 'active' ? '活动告警' : '已恢复'} ·{' '}
                      {new Date(alarm.timestamp).toLocaleString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                      })}
                    </p>
                    <small>{alarm.acknowledgedAt ? `已确认：${alarm.note}` : '待人工确认'}</small>
                  </div>
                  <button
                    disabled={!!alarm.acknowledgedAt || busy || !note.trim()}
                    onClick={() => void perform(() => acknowledgeAlarm(alarm.id, note))}
                  >
                    {alarm.acknowledgedAt ? '已确认' : '确认告警'}
                  </button>
                </article>
              ))
            )}
          </div>
        )}
        {tab === 'audit' && (
          <div className="operations-records">
            {audit.isPending ? (
              <p>正在读取操作记录…</p>
            ) : audit.isError ? (
              <p role="alert">{audit.error.message}</p>
            ) : audit.data.length === 0 ? (
              <p>暂无操作记录</p>
            ) : (
              audit.data.map((entry) => (
                <article key={entry.id}>
                  <div>
                    <b>
                      {entry.action} · {entry.entityId}
                    </b>
                    <p>{entry.details}</p>
                  </div>
                  <time>
                    {new Date(entry.timestamp).toLocaleString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                    })}
                  </time>
                </article>
              ))
            )}
          </div>
        )}
        {message && (
          <div
            role="status"
            className="operations-message"
          >
            {message}
          </div>
        )}
      </section>
    </div>
  );
}
