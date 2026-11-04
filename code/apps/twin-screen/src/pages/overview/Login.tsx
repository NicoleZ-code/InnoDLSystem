import { useState, type FormEvent } from 'react';
import { request } from '@innodl/api-client';
/** 三维大屏的统一登录入口。
 * @param props 登录成功后的数据重新加载回调。
 * @param props.onSuccess 登录成功时执行。
 * @returns 用户名、密码与错误反馈表单。
 */
export function Login(props: { onSuccess: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** 提交登录信息，浏览器内保存短期令牌。
   * @param event 表单提交事件。
   * @returns 登录完成的 Promise。
   */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const result = await request<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: data.get('username'), password: data.get('password') }),
      });
      sessionStorage.setItem('innodl-token', result.token);
      props.onSuccess();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="twin-login">
      <form onSubmit={(event) => void submit(event)}>
        <span>INNO POWER · DIGITAL TWIN</span>
        <h1>全景智慧供电保障系统</h1>
        <p>登录统一账户，进入实时三维指挥大屏</p>
        <label>
          用户名
          <input
            name="username"
            defaultValue="admin"
            autoComplete="username"
            required
          />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button
          type="submit"
          disabled={busy}
        >
          {busy ? '正在登录…' : '登录指挥大屏'}
        </button>
        <small>与综合业务后台共享账户、角色及资产数据。</small>
      </form>
    </div>
  );
}
