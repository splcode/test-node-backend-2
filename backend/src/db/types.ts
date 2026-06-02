import type { ColumnType, Generated } from "kysely";

/**
 * Hand-written Kysely schema — the source of truth for query typing.
 * Keep this in sync with the SQL migrations by hand for now.
 * (Swap to `kysely-codegen` later to generate this file from the live DB.)
 */
export interface Database {
  sample: SampleTable;
}

export interface SampleTable {
  id: Generated<number>;
  name: string;
  description: string;
  /** select as Date; insert optional (DB defaults to now()); never updated. */
  created_at: ColumnType<Date, string | undefined, never>;
}
