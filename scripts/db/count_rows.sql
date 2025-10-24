CREATE TEMP TABLE rowcounts(schema_name text, table_name text, row_count bigint);  -- default preserves rows

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema NOT IN ('pg_catalog','information_schema')
  LOOP
    EXECUTE format(
      'INSERT INTO rowcounts SELECT %L, %L, COUNT(*) FROM %I.%I',
      r.table_schema, r.table_name, r.table_schema, r.table_name
    );
  END LOOP;
END $$;

SELECT schema_name, table_name, row_count
FROM rowcounts
ORDER BY row_count DESC;

DROP TABLE rowcounts;
