-- Wrapped in a transaction so the whole migration applies atomically
-- (postgrator does not wrap migrations itself). Postgres has transactional DDL.
BEGIN;

CREATE TABLE sample (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sample (name, description) VALUES
  ('Alpha',   'The first sample item.'),
  ('Bravo',   'The second sample item.'),
  ('Charlie', 'The third sample item.'),
  ('Delta',   'The fourth sample item.'),
  ('Echo',    'The fifth sample item.');

COMMIT;
