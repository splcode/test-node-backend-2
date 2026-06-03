-- Session store for express-session via connect-pg-simple. This is the table
-- shape connect-pg-simple expects (sid / sess / expire); we create it here via
-- a migration rather than letting the store run DDL at boot, so the schema is
-- versioned alongside everything else and the runtime needs no CREATE rights.
-- Wrapped in a transaction to match the other migrations (postgrator does not
-- wrap them itself; Postgres has transactional DDL).
BEGIN;

CREATE TABLE session (
  sid    varchar      NOT NULL COLLATE "default",
  sess   json         NOT NULL,
  expire timestamp(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
);

-- connect-pg-simple sweeps expired rows by this column; index keeps that cheap.
CREATE INDEX idx_session_expire ON session (expire);

COMMIT;
