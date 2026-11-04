import { telemetryAt } from '@innodl/shared-utils';
// 独立采集适配器样例输出 NDJSON，不再启动绕过认证的第二套 API。
const count = Math.min(3600, Number(process.env.SAMPLES ?? 90));
for (let tick=0; tick<count; tick++) {
 process.stdout.write(`${JSON.stringify({source:'simulator',quality:'SIMULATED',...telemetryAt(tick)})}\n`);
}
