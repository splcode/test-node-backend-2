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

/** One organization membership: the org's display name and the user's roles in it. */
export interface OrgMembership {
  name: string;
  roles: string[];
}

/** Org memberships keyed by Keycloak organization id (mirrors the token claim). */
export type OrgMemberships = Record<string, OrgMembership>;

/** The authenticated principal, as carried in the session and returned by /me. */
export interface SessionUser {
  sub: string;
  email?: string;
  name?: string;
  organizations: OrgMemberships;
}

/** GET /api/v1/me — the current user, or null when there is no session. */
export interface MeResponse {
  user: SessionUser | null;
}
