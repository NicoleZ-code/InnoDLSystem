import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const pool=new Pool({connectionString:process.env.DATABASE_URL ?? 'postgresql://localhost:5432/innodl_system'});
const client=await pool.connect();
try {
 await client.query('BEGIN');
 await client.query(readFileSync(new URL('./demo.sql',import.meta.url),'utf8'));
 await client.query('COMMIT');
 console.info('扩展演示数据已写入；已有数据保留。运行中的后台可刷新，大屏重新加载目录。');
} catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();await pool.end();}
