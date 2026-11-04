/** 需要移除的空格字符：半角空格、制表符、全角空格；保留换行以便多行文本正常排版。 */
const SPACE_PATTERN = /[ \t\u3000]/g;

/** 仅用于检测是否含空格的非全局版本，避免全局正则的 lastIndex 在多次 test 间残留。 */
const HAS_SPACE = /[ \t\u3000]/;

/** 不接收文本输入的 input 类型：空格键在这些控件上有浏览器原生语义，不做拦截。 */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'file',
  'range',
  'color',
  'image',
  'hidden',
]);

/**
 * 移除输入值中的空格，非字符串值原样返回，供所有表单输入框统一使用。
 * @param value 输入框当前值，可以是字符串、数字或布尔值。
 * @returns 去除空格后的同类型值，非字符串保持不变。
 */
export function stripSpaces<T>(value: T): T {
  return (typeof value === 'string' ? value.replace(SPACE_PATTERN, '') : value) as T;
}

/**
 * 判断事件目标是否落在可编辑的文本输入框内。
 * @param target 事件的 target，通常来自 document 捕获阶段。
 * @returns 命中的 input / textarea 元素；非文本输入或只读控件返回 null。
 */
function textInputOf(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const element = target.closest('input, textarea');
  if (element instanceof HTMLInputElement) {
    if (NON_TEXT_INPUT_TYPES.has(element.type) || element.disabled || element.readOnly) {
      return null;
    }
    return element;
  }
  if (element instanceof HTMLTextAreaElement && !element.disabled && !element.readOnly) {
    return element;
  }
  return null;
}

/**
 * 通过原型 setter 写入 DOM 值，绕过 React 在实例上安装的 value tracker，
 * 使随后派发的 input 事件仍能被 React 识别为一次真实变更。
 * @param input 目标输入框。
 * @param value 清洗后的值。
 * @returns void。
 */
function setNativeValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
}

/**
 * execCommand 不可用时的降级插入：替换选区文本并派发 input 事件。
 * @param input 目标输入框。
 * @param text 不含空格的文本。
 * @returns void。
 */
function fallbackInsert(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.setRangeText(text, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * 在当前光标处插入已去除空格的文本，走浏览器原生输入路径以正常触发 React onChange。
 * @param input 目标输入框。
 * @param text 不含空格的文本，为空时不插入。
 * @returns void。
 */
function insertCleanText(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  if (!text) {
    return;
  }
  if (!document.execCommand('insertText', false, text)) {
    fallbackInsert(input, text);
  }
}

/**
 * 键盘阶段拦截空格键：输入法组合态放行（中文选字依赖空格），其余文本控件直接阻止默认行为。
 * @param event 捕获阶段的 keydown 事件。
 * @returns void。
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) {
    return;
  }
  const isSpaceKey = event.key === ' ' || event.key === 'Spacebar' || event.keyCode === 32;
  if (!isSpaceKey || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (!textInputOf(event.target)) {
    return;
  }
  event.preventDefault();
}

/**
 * 写入 DOM 前拦截含空格的插入，覆盖输入法直接上屏全角空格与自动填充。
 * @param event 捕获阶段的 beforeinput 事件。
 * @returns void。
 */
function onBeforeInput(event: InputEvent): void {
  const data = event.data ?? '';
  if (!data || !HAS_SPACE.test(data)) {
    return;
  }
  const input = textInputOf(event.target);
  if (!input) {
    return;
  }
  const isComposition = event.inputType === 'insertCompositionText';
  const isOnlySpaces = stripSpaces(data) === '';
  // 组合态仅在「整段都是空格」时拦截，避免破坏输入法候选词预览。
  if (isComposition && !isOnlySpaces) {
    return;
  }
  // 粘贴由 paste 事件统一处理，避免两次插入。
  if (event.inputType === 'insertFromPaste') {
    return;
  }
  event.preventDefault();
  if (!isComposition) {
    insertCleanText(input, stripSpaces(data));
  }
}

/**
 * 拦截粘贴含空格的剪贴板内容，插入前先清洗。
 * @param event 捕获阶段的 paste 事件。
 * @returns void。
 */
function onPaste(event: ClipboardEvent): void {
  const input = textInputOf(event.target);
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!input || !text || !HAS_SPACE.test(text)) {
    return;
  }
  event.preventDefault();
  insertCleanText(input, stripSpaces(text));
}

/**
 * 兜底清洗：拖放、脚本赋值、输入法组合结束等绕过按键阶段写入的空格，
 * 在 DOM 值更新时立即移除，并保持光标位置与 React 状态同步。
 * @param event 捕获阶段的 input 事件。
 * @returns void。
 */
function onInput(event: Event): void {
  const input = textInputOf(event.target);
  if (!input || !HAS_SPACE.test(input.value)) {
    return;
  }
  const raw = input.value;
  const caret = input.selectionStart ?? raw.length;
  const removedBeforeCaret = (raw.slice(0, caret).match(SPACE_PATTERN) ?? []).length;
  const clean = stripSpaces(raw);
  setNativeValue(input, clean);
  const position = Math.max(0, Math.min(clean.length, caret - removedBeforeCaret));
  if (input.selectionStart !== null) {
    input.setSelectionRange(position, position);
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * 安装全局空格输入守卫，须在 React 挂载前调用一次；通过 html 上的标记保证 HMR 下不重复注册。
 * @returns void。
 */
export function installSpaceGuard(): void {
  if (document.documentElement.dataset.spaceGuard === 'on') {
    return;
  }
  document.documentElement.dataset.spaceGuard = 'on';
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('beforeinput', (event) => onBeforeInput(event as InputEvent), true);
  document.addEventListener('paste', onPaste, true);
  document.addEventListener('input', onInput, true);
}
