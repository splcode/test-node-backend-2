import * as jose from "jose";
import type { Request, Response, NextFunction } from "express";
import { getOidcConfig } from "./oidc.js";

const issuer = process.env.OIDC_ISSUER;
const audience = process.env.OIDC_AUDIENCE ?? "app-api";

if (!issuer) {
  throw new Error("OIDC_ISSUER must be set.");
}

/** A validated machine-client principal extracted from a bearer access token. */
export interface BearerPrincipal {
  /** Token subject — the service account user id for a client-credentials token. */
  sub: string;
  /** Authorized party / client id that the token was issued to. */
  clientId?: string;
  /** OAuth scopes granted on the token. */
  scopes: string[];
  /** The full verified JWT payload, for anything else a handler needs. */
  claims: jose.JWTPayload;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by the bearer guard when the request authenticated with a token. */
      bearer?: BearerPrincipal;
    }
  }
}

// Build the remote JWK Set lazily from the discovered jwks_uri. jose fetches and
// caches the keys and handles key rotation / cooldown internally.
let jwks: ReturnType<typeof jose.createRemoteJWKSet> | undefined;
async function getJwks(): Promise<ReturnType<typeof jose.createRemoteJWKSet>> {
  if (!jwks) {
    const jwksUri = (await getOidcConfig()).serverMetadata().jwks_uri;
    if (!jwksUri) {
      throw new Error("Authorization server metadata has no jwks_uri.");
    }
    jwks = jose.createRemoteJWKSet(new URL(jwksUri));
  }
  return jwks;
}

/** Verify a bearer access token's signature, issuer and audience. Throws on failure. */
export async function verifyBearer(token: string): Promise<BearerPrincipal> {
  const { payload } = await jose.jwtVerify(token, await getJwks(), { issuer, audience });
  return {
    sub: String(payload.sub),
    clientId:
      typeof payload.azp === "string"
        ? payload.azp
        : typeof payload.client_id === "string"
          ? payload.client_id
          : undefined,
    scopes: typeof payload.scope === "string" ? payload.scope.split(" ") : [],
    claims: payload,
  };
}

function bearerToken(req: Request): string | undefined {
  const header = req.get("authorization");
  if (header && header.slice(0, 7).toLowerCase() === "bearer ") {
    return header.slice(7).trim();
  }
  return undefined;
}

/** True when the request carries a bearer token (used to relax CSRF — see csrf.ts). */
export function hasBearer(req: Request): boolean {
  return bearerToken(req) !== undefined;
}

/** Machine-only guard: require a valid bearer token. */
export async function requireBearer(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    req.bearer = await verifyBearer(token);
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}

/**
 * Browser-or-machine guard for /api/v1: allow a session (browser BFF) OR a valid
 * bearer token (machine client). Session is checked first so the common browser
 * path never touches the JWKS.
 */
export async function requireSessionOrBearer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.session?.user) {
    next();
    return;
  }
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    req.bearer = await verifyBearer(token);
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}
