export { UsersModule } from './modules/users/users.module';
export { AuthModule } from './modules/auth/auth.module';
export { ScenesModule } from './modules/scenes/scenes.module';
export { WorkOrdersModule } from './modules/work-orders/work-orders.module';
export { ProtectionModule } from './modules/protection/protection.module';
export { AlarmsModule } from './modules/alarms/alarms.module';
export { TelemetryModule } from './modules/telemetry/telemetry.module';
export { TopologyModule } from './modules/topology/topology.module';
export { AssetsModule } from './modules/assets/assets.module';
import { type DynamicModule } from '@nestjs/common';
/** 用生命周期注册器组装业务模块，路由依赖通过 Nest provider 注入。
 * @param module 领域模块类。
 * @param name 注册器在依赖容器中的标识。
 * @param register 注册业务路由的操作。
 * @returns 可由 Nest 管理生命周期的动态模块。
 */
export function featureModule(
  module: DynamicModule['module'],
  name: string,
  register: () => void | Promise<void>,
): DynamicModule {
  return { module, providers: [{ provide: name, useValue: { onModuleInit: register } }] };
}
