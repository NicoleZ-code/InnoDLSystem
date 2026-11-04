import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, statSync, existsSync, createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { Client as MinioClient } from 'minio';
import { idSchema } from '../../common/schemas';
import { response } from '../../common/response';
import { DomainError } from '../../repositories/repository';
/** 注册模型上传、资产绑定、场景图层、镜头和版本发布。
 * @param app HTTP 应用。
 * @param pool PostgreSQL 元数据存储。
 * @param onPublish 发布后推送新目录的回调。
 * @returns 完成模型存储配置及路由注册的 Promise。
 */
export async function registerSceneRoutes(
  app: FastifyInstance,
  pool: Pool,
  onPublish: () => Promise<void>,
) {
  const storage = resolve('data/models');
  mkdirSync(storage, { recursive: true });
  const signingKey = randomBytes(32);
  const bucket = process.env.MINIO_BUCKET ?? 'innodl-models';
  const minio = process.env.MINIO_ENDPOINT
    ? new MinioClient({
        endPoint: process.env.MINIO_ENDPOINT,
        port: Number(process.env.MINIO_PORT ?? 9000),
        useSSL: process.env.MINIO_SSL === 'true',
        accessKey: process.env.MINIO_ACCESS_KEY ?? '',
        secretKey: process.env.MINIO_SECRET_KEY ?? '',
      })
    : undefined;
  if (minio && !(await minio.bucketExists(bucket))) await minio.makeBucket(bucket);
  /** 生成短期本地上传签名。
   * @param id 服务端生成的模型 ID。
   * @param expires 签名到期时间。
   * @returns HMAC-SHA256 签名。
   */
  function sign(id: string, expires: number) {
    return createHmac('sha256', signingKey).update(`${id}:${expires}`).digest('hex');
  }
  app.addContentTypeParser('model/gltf-binary', { parseAs: 'buffer' }, (_request, body, done) =>
    done(null, body),
  );
  app.get('/api/v1/scene-models', async (request) =>
    response((await pool.query('SELECT * FROM scene_models ORDER BY name')).rows, request.id),
  );
  app.post('/api/v1/scene-models/upload-url', async (request) => {
    const body = z
      .strictObject({
        name: z
          .string()
          .min(1)
          .max(150)
          .regex(/\.glb$/i),
        size: z
          .number()
          .int()
          .min(12)
          .max(50 * 1024 * 1024),
      })
      .parse(request.body);
    const id = randomUUID();
    const expires = Date.now() + 300000;
    const key = `uploads/${id}.glb`;
    const fileKey = minio ? key : `/models/uploaded/${id}.glb`;
    await pool.query("INSERT INTO scene_models VALUES($1,$2,$3,'glb',$4,'pending')", [
      id,
      body.name,
      fileKey,
      body.size,
    ]);
    const url = `/api/v1/model-upload/${id}?expires=${expires}&signature=${sign(id, expires)}`;
    return response({ id, url, expiresAt: expires }, request.id);
  });
  app.put('/api/v1/model-upload/:id', { bodyLimit: 50 * 1024 * 1024 }, async (request) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const query = z
      .object({ expires: z.coerce.number().int(), signature: z.string().regex(/^[0-9a-f]{64}$/) })
      .parse(request.query);
    if (
      query.expires < Date.now() ||
      !timingSafeEqual(
        Buffer.from(query.signature, 'hex'),
        Buffer.from(sign(id, query.expires), 'hex'),
      )
    )
      throw new DomainError(403, 'INVALID_UPLOAD_SIGNATURE', '上传地址已过期或签名无效');
    const row = (
      await pool.query("SELECT size FROM scene_models WHERE id=$1 AND status='pending'", [id])
    ).rows[0];
    const bytes = request.body;
    if (
      !row ||
      !Buffer.isBuffer(bytes) ||
      bytes.length !== Number(row.size) ||
      bytes.length < 12 ||
      bytes.readUInt32LE(0) !== 0x46546c67 ||
      bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length
    )
      throw new DomainError(400, 'INVALID_GLB', '文件大小或 GLB 格式无效');
    if (minio)
      await minio.putObject(bucket, `uploads/${id}.glb`, bytes, bytes.length, {
        'Content-Type': 'model/gltf-binary',
      });
    else writeFileSync(resolve(storage, `${id}.glb`), bytes, { flag: 'wx', mode: 0o600 });
    return response({ uploaded: id }, request.id);
  });
  app.post('/api/v1/scene-models/:id/complete', async (request) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const row = (await pool.query('SELECT * FROM scene_models WHERE id=$1', [id])).rows[0];
    if (!row) throw new DomainError(404, 'NOT_FOUND', '模型不存在');
    if (row.status === 'uploaded') return response(row, request.id);
    if (minio) {
      const stat = await minio.statObject(bucket, row.file_key);
      if (stat.size !== Number(row.size))
        throw new DomainError(400, 'SIZE_MISMATCH', '对象大小与上传登记不一致');
      const stream = await minio.getPartialObject(bucket, row.file_key, 0, 12);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const header = Buffer.concat(chunks);
      if (
        header.length < 12 ||
        header.readUInt32LE(0) !== 0x46546c67 ||
        header.readUInt32LE(4) !== 2 ||
        header.readUInt32LE(8) !== Number(row.size)
      )
        throw new DomainError(400, 'INVALID_GLB', '模型格式无效');
    } else if (
      !existsSync(resolve(storage, `${id}.glb`)) ||
      statSync(resolve(storage, `${id}.glb`)).size !== Number(row.size)
    )
      throw new DomainError(400, 'UPLOAD_INCOMPLETE', '尚未收到完整模型文件');
    await pool.query("UPDATE scene_models SET status='uploaded' WHERE id=$1", [id]);
    return response({ ...row, status: 'uploaded' }, request.id);
  });
  app.get('/models/uploaded/:file', async (request, reply) => {
    const file = z
      .string()
      .regex(/^[a-zA-Z0-9_-]+\.glb$/)
      .parse((request.params as { file: string }).file);
    const id = file.slice(0, -4);
    const row = (
      await pool.query(
        "SELECT * FROM scene_models WHERE id=$1 AND status IN('uploaded','published')",
        [id],
      )
    ).rows[0];
    if (!row) throw new DomainError(404, 'NOT_FOUND', '模型不存在');
    if (minio) {
      return reply.type('model/gltf-binary').send(await minio.getObject(bucket, row.file_key));
    }
    return reply.type('model/gltf-binary').send(createReadStream(resolve(storage, file)));
  });
  app.get('/api/v1/model-bindings', async (request) =>
    response(
      (
        await pool.query(
          'SELECT scene_id AS "sceneId",asset_id AS "assetId",model_id AS "modelId",transform FROM scene_bindings ORDER BY scene_id,asset_id',
        )
      ).rows,
      request.id,
    ),
  );
  app.get('/api/v1/scenes/:id', async (request) => {
    const id = (request.params as { id: string }).id;
    const row =
      (await pool.query('SELECT value FROM app_state WHERE key=$1', [`published-scene-${id}`]))
        .rows[0]?.value ?? (await pool.query('SELECT * FROM scenes WHERE id=$1', [id])).rows[0];
    if (!row) throw new DomainError(404, 'NOT_FOUND', '场景不存在');
    return response(row, request.id);
  });
  app.get('/api/v1/scenes', async (request) =>
    response((await pool.query('SELECT * FROM scenes ORDER BY id')).rows, request.id),
  );
  app.get('/api/v1/scenes/:id/layers', async (request) =>
    response(
      (
        await pool.query('SELECT * FROM scene_layers WHERE scene_id=$1', [
          (request.params as { id: string }).id,
        ])
      ).rows,
      request.id,
    ),
  );
  app.get('/api/v1/scenes/:id/objects', async (request) =>
    response(
      (
        await pool.query(
          `SELECT b.asset_id AS "assetId",b.model_id AS "modelId",b.transform,CASE WHEN m.file_key LIKE 'uploads/%' THEN '/models/uploaded/'||m.id||'.glb' ELSE m.file_key END AS "modelUri" FROM scene_bindings b JOIN scene_models m ON m.id=b.model_id WHERE scene_id=$1`,
          [(request.params as { id: string }).id],
        )
      ).rows,
      request.id,
    ),
  );
  app.get('/api/v1/scenes/:id/cameras', async (request) =>
    response(
      (
        await pool.query('SELECT * FROM camera_presets WHERE scene_id=$1', [
          (request.params as { id: string }).id,
        ])
      ).rows,
      request.id,
    ),
  );
  app.get('/api/v1/camera-presets', async (request) =>
    response(
      (
        await pool.query(
          'SELECT id,scene_id AS "sceneId",name,destination,orientation,duration FROM camera_presets ORDER BY id',
        )
      ).rows,
      request.id,
    ),
  );
  const camera = z.strictObject({
    id: idSchema,
    sceneId: idSchema,
    name: z.string().min(1).max(100),
    destination: z.strictObject({
      lng: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
      height: z.number().min(1).max(100000),
    }),
    orientation: z.strictObject({
      heading: z.number(),
      pitch: z.number().min(-90).max(0),
      roll: z.number(),
    }),
    duration: z.number().min(0).max(30),
  });
  app.post('/api/v1/camera-presets', async (request, reply) => {
    const c = camera.parse(request.body);
    await pool.query('INSERT INTO camera_presets VALUES($1,$2,$3,$4,$5,$6)', [
      c.id,
      c.sceneId,
      c.name,
      c.destination,
      c.orientation,
      c.duration,
    ]);
    return reply.code(201).send(response(c, request.id));
  });
  app.put('/api/v1/camera-presets/:id', async (request) => {
    const c = camera.parse(request.body);
    if (c.id !== (request.params as { id: string }).id)
      throw new DomainError(400, 'ID_MISMATCH', '镜头 ID 不一致');
    const result = await pool.query(
      'UPDATE camera_presets SET scene_id=$1,name=$2,destination=$3,orientation=$4,duration=$5 WHERE id=$6',
      [c.sceneId, c.name, c.destination, c.orientation, c.duration, c.id],
    );
    if (!result.rowCount) throw new DomainError(404, 'NOT_FOUND', '镜头不存在');
    return response(c, request.id);
  });
  app.put('/api/v1/scenes/:id/bindings', async (request) => {
    const sceneId = (request.params as { id: string }).id;
    const body = z
      .strictObject({
        bindings: z
          .array(
            z.strictObject({
              assetId: idSchema,
              modelId: idSchema,
              transform: z.record(z.string(), z.unknown()).default({}),
            }),
          )
          .max(1000),
      })
      .parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!(await client.query('SELECT id FROM scenes WHERE id=$1', [sceneId])).rowCount)
        throw new DomainError(404, 'NOT_FOUND', '场景不存在');
      for (const binding of body.bindings) {
        const model = (
          await client.query(
            "SELECT id FROM scene_models WHERE id=$1 AND status IN('uploaded','published')",
            [binding.modelId],
          )
        ).rows[0];
        if (!model) throw new DomainError(422, 'INVALID_MODEL', '模型不存在或尚未完成上传');
        await client.query(
          'INSERT INTO scene_bindings VALUES($1,$2,$3,$4) ON CONFLICT(scene_id,asset_id) DO UPDATE SET model_id=excluded.model_id,transform=excluded.transform',
          [sceneId, binding.assetId, binding.modelId, binding.transform],
        );
      }
      await client.query('COMMIT');
      return response(body, request.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  app.post('/api/v1/scenes/:id/publish', async (request) => {
    const id = (request.params as { id: string }).id;
    const client = await pool.connect();
    let published;
    try {
      await client.query('BEGIN');
      const row = await client.query(
        'UPDATE scenes SET revision=revision+1 WHERE id=$1 RETURNING *',
        [id],
      );
      if (!row.rowCount) throw new DomainError(404, 'NOT_FOUND', '场景不存在');
      const bindings = (
        await client.query(
          `SELECT b.asset_id AS "assetId",CASE WHEN m.file_key LIKE 'uploads/%' THEN '/models/uploaded/'||m.id||'.glb' ELSE m.file_key END AS "modelUri",b.transform FROM scene_bindings b JOIN scene_models m ON m.id=b.model_id WHERE b.scene_id=$1`,
          [id],
        )
      ).rows;
      published = { ...row.rows[0], bindings };
      await client.query(
        'INSERT INTO app_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        [`published-scene-${id}`, published],
      );
      await client.query(
        "UPDATE app_state SET value=to_jsonb((value::text)::integer+1) WHERE key='revision'",
      );
      await client.query(
        'INSERT INTO audit_log(action,entity_id,timestamp,details) VALUES($1,$2,$3,$4)',
        ['scene.published', id, Date.now(), `发布版本 ${published.revision}`],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await onPublish();
    return response(published, request.id);
  });
}
