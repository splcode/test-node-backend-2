// API types shared with the frontend (the frontend `import type`s these).

export interface Sample {
  id: number;
  name: string;
  description: string;
  /** Number of bunnies mentally associated with this sample; null if none. */
  bunnyCount: number | null;
  /** ISO-8601 timestamp string. */
  createdAt: string;
}

export interface SampleListResponse {
  data: Sample[];
}
