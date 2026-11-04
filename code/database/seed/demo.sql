-- 可选扩展验收数据；保留原有台账，demo-* 编码可重复执行。
INSERT INTO assets(id,name,type,region,longitude,latitude,height,voltage,capacity,status)
SELECT 'demo-station-'||n,'演示变电站 '||n,'substation','core',121.25+(n%4)*0.025,31.15+(n/4)*0.02,20,110,160,'normal' FROM generate_series(1,12) n ON CONFLICT(id) DO NOTHING;
INSERT INTO assets(id,name,type,region,longitude,latitude,height,voltage,capacity,status,parent_id)
SELECT 'demo-device-'||n,'演示配电设备 '||n,CASE WHEN n%2=0 THEN 'switchgear' ELSE 'transformer' END,'core',121.25+(n%25)*0.004,31.15+(n/25)*0.004,5,10,2,'normal','demo-station-'||((n-1)%12+1) FROM generate_series(1,300) n ON CONFLICT(id) DO NOTHING;
INSERT INTO power_lines(id,name,from_id,to_id,voltage,status,load)
SELECT 'demo-line-'||n,'演示馈线 '||n,'demo-station-'||((n-1)%12+1),'demo-device-'||n,10,'normal',45 FROM generate_series(1,120) n ON CONFLICT(id) DO NOTHING;
INSERT INTO topology_nodes(id,asset_id,electrical_code) SELECT 'node-'||id,id,'terminal-'||id FROM assets WHERE id LIKE 'demo-%' ON CONFLICT(id) DO NOTHING;
INSERT INTO topology_edges SELECT 'edge-'||id,'node-'||from_id,'node-'||to_id,id,'CLOSED' FROM power_lines WHERE id LIKE 'demo-%' ON CONFLICT(id) DO NOTHING;
INSERT INTO measurement_points(id,asset_id,name,unit,metric,quality)
SELECT 'demo-point-'||n,'demo-device-'||((n-1)%300+1),CASE WHEN n%2=0 THEN '柜内温度' ELSE '运行电压' END,CASE WHEN n%2=0 THEN '°C' ELSE 'kV' END,CASE WHEN n%2=0 THEN 'temperature' ELSE 'voltage' END,'simulated' FROM generate_series(1,800) n ON CONFLICT(id) DO NOTHING;
UPDATE app_state SET value=to_jsonb((value::text)::integer+1) WHERE key='revision';
INSERT INTO audit_log(action,entity_id,timestamp,details) VALUES('demo.seed','demo-dataset',(extract(epoch from clock_timestamp())*1000)::bigint,'扩展演示数据：12 站、300 设备、120 线、800 测点');
