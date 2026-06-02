/**
 * Public API contract shared between backend and frontend.
 *
 * PURE TYPES ONLY — no runtime imports. This is what the frontend `import type`s,
 * so the browser bundle can never accidentally pull in Node/Express code.
 * (When a runtime-shared artifact appears — e.g. a zod schema — promote this to
 * a real `shared/` package.)
 */

/** A single sample item as returned by the API (JSON-friendly). */
export interface Sample {
  id: number;
  name: string;
  description: string;
  /** ISO-8601 timestamp string. */
  createdAt: string;
}

/** Response shape of GET /api/v1/sample. */
export interface SampleListResponse {
  data: Sample[];
}
