import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('设备 GLB 部件名称唯一，三相铜排可稳定拾取与分解', () => {
  const bytes = readFileSync('apps/twin-screen/public/models/switchgear.glb');
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const names = document.nodes.map((node: { name: string }) => node.name);
  expect(new Set(names).size).toBe(names.length);
  expect(names.filter((name: string) => name.startsWith('busbar-'))).toHaveLength(12);
});
