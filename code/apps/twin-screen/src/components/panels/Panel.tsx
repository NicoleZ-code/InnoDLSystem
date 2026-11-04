import styled from 'styled-components';
import type { ReactNode } from 'react';
const Frame = styled.section`
  position: relative;
  padding: 18px 18px 15px;
  border: 1px solid rgba(102, 196, 206, 0.13);
  background: linear-gradient(115deg, rgba(15, 43, 57, 0.94), rgba(8, 29, 43, 0.78));
  box-shadow: 0 8px 30px #00121b24;
  backdrop-filter: blur(12px);
  &::before {
    content: '';
    position: absolute;
    left: -1px;
    top: -1px;
    width: 16px;
    height: 2px;
    background: #4e9b9e;
  }
`;
/** 通用监控分组容器。
 * @param props 标题、英文副标题、工具区与内容。
 * @param props.title 中文业务标题。
 * @param props.subtitle 可选英文副标题。
 * @param props.action 可选标题工具区。
 * @param props.children 业务内容节点。
 * @param props.className 可选样式类名。
 * @returns 带装饰边框的业务面板。
 */
export function Panel(props: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Frame className={props.className}>
      <div className="panel-heading">
        <h2>
          <i />
          {props.title}
        </h2>
        {props.action ?? <span>{props.subtitle}</span>}
      </div>
      {props.children}
    </Frame>
  );
}
