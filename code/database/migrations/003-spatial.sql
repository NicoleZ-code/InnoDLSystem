-- 仅在 PostGIS 可用时执行；普通 PostgreSQL 保留标量坐标降级路径。
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS location geometry(Point,4326);
CREATE INDEX IF NOT EXISTS assets_location_gist ON assets USING gist(location);
CREATE OR REPLACE FUNCTION sync_asset_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude,NEW.latitude),4326);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS assets_location_sync ON assets;
CREATE TRIGGER assets_location_sync BEFORE INSERT OR UPDATE OF longitude,latitude ON assets FOR EACH ROW EXECUTE FUNCTION sync_asset_location();
UPDATE assets SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE location IS NULL;
