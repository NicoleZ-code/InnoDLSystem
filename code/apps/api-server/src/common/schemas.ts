import { z } from 'zod';
export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const regionSchema = idSchema;
export const statusSchema = z.enum(['normal', 'attention', 'alarm']);
export const assetSchema = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1).max(100),
  type: z.enum(['venue', 'substation', 'transport', 'hotel', 'switchgear', 'transformer', 'sensor', 'feeder']),
  region: regionSchema,
  position: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-500).max(10000),
  ]),
  voltage: z.number().positive().max(2000),
  capacity: z.number().positive().max(100000),
  status: statusSchema,
});
export const lineSchema = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1).max(100),
  fromId: idSchema,
  toId: idSchema,
  voltage: z.number().positive().max(2000),
  status: statusSchema,
  load: z.number().min(0).max(200),
});
export const filterSchema = z.object({
  regionId: regionSchema.optional(),
  type: assetSchema.shape.type.optional(),
  voltageKv: z.coerce.number().positive().optional(),
});
export const tickSchema = z.coerce.number().int().min(0).max(10000000);
export const controlSchema = z
  .strictObject({ playing: z.boolean().optional(), tick: tickSchema.optional() })
  .refine((value) => value.playing !== undefined || value.tick !== undefined, {
    message: '至少提供 playing 或 tick',
  });
export const historySchema = z
  .object({
    assetId: idSchema.optional(),
    fromTick: tickSchema.default(0),
    toTick: tickSchema.default(10000000),
    limit: z.coerce.number().int().min(1).max(3600).default(180),
  })
  .refine((query) => query.fromTick <= query.toTick, { message: 'fromTick 不能大于 toTick' });
