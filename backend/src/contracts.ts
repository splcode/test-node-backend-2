export interface Sample {
  id: number;
  name: string;
  description: string;
  /** Number of bunnies mentally associated with this sample; null if none. */
  bunnyCount: number | null;
  /** ISO-8601 on the wire; the API client revives it to a Date on receipt. */
  createdAt: Date;
}

export interface SampleListResponse {
  data: Sample[];
}
