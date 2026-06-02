-- Wrapped in a transaction so the whole migration applies atomically
-- (postgrator does not wrap migrations itself). Postgres has transactional DDL.
BEGIN;

-- Number of bunnies mentally associated with each sample. Nullable on purpose:
-- rows without a strong bunny association fall back to NULL.
ALTER TABLE sample ADD COLUMN bunny_count integer;

UPDATE sample SET bunny_count = 3  WHERE name = 'Alpha';
UPDATE sample SET bunny_count = 7  WHERE name = 'Bravo';
UPDATE sample SET bunny_count = 0  WHERE name = 'Charlie';
UPDATE sample SET bunny_count = 12 WHERE name = 'Delta';
-- Echo intentionally left NULL to exercise the fallback path.

COMMIT;
