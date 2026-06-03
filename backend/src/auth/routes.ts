import { Router } from "express";
import type { Request } from "express";
import * as client from "openid-client";
import {
  getOidcConfig,
  mapClaimsToUser,
  safeReturnTo,
  REDIRECT_URI,
  APP_BASE_URL,
  SCOPE,
} from "./oidc.js";

export const authRouter = Router();

// express-session's session methods are callback-based; promisify for async/await.
const regenerate = (req: Request): Promise<void> =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
const save = (req: Request): Promise<void> =>
  new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
const destroy = (req: Request): Promise<void> =>
  new Promise((resolve, reject) => req.session.destroy((err) => (err ? reject(err) : resolve())));

/**
 * GET /auth/login — start the authorization-code + PKCE flow. Stash state, nonce
 * and the PKCE verifier in the session, then redirect the browser to Keycloak.
 */
authRouter.get("/login", async (req, res, next) => {
  try {
    // Already signed in? Skip straight to where they were headed.
    if (req.session.user) {
      res.redirect(safeReturnTo(req.query.returnTo));
      return;
    }
    const config = await getOidcConfig();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

    req.session.oidc = { state, nonce, codeVerifier, returnTo: safeReturnTo(req.query.returnTo) };

    const authUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    // Persist the transaction before redirecting so the cookie reaches the browser.
    await save(req);
    res.redirect(authUrl.href);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /auth/callback — exchange the code for tokens. openid-client verifies
 * state, nonce, PKCE and the ID token signature/audience for us.
 */
authRouter.get("/callback", async (req, res, next) => {
  try {
    const tx = req.session.oidc;
    if (!tx) {
      res.status(400).json({ error: "no login in progress" });
      return;
    }
    const config = await getOidcConfig();
    const currentUrl = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);

    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: tx.codeVerifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
    });

    const claims = tokens.claims();
    if (!claims) {
      res.status(400).json({ error: "no id_token in token response" });
      return;
    }

    const user = mapClaimsToUser(claims as Record<string, unknown>);
    const idToken = tokens.id_token;
    const returnTo = safeReturnTo(tx.returnTo);

    // Rotate the session id on privilege change to defeat session fixation. This
    // also discards the now-spent oidc transaction.
    await regenerate(req);
    req.session.user = user;
    req.session.idToken = idToken;
    await save(req);

    res.redirect(returnTo);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/logout — POST-only so it can't be triggered by a cross-site GET.
 * Clears the local session, then returns the Keycloak end-session URL so the SPA
 * can navigate there top-level and end the Keycloak SSO session too.
 */
authRouter.post("/logout", async (req, res, next) => {
  try {
    const config = await getOidcConfig();
    const idToken = req.session.idToken;

    await destroy(req);
    res.clearCookie("sid", { path: "/" });

    const endSessionUrl = client.buildEndSessionUrl(config, {
      post_logout_redirect_uri: `${APP_BASE_URL}/`,
      ...(idToken ? { id_token_hint: idToken } : {}),
    });

    res.json({ logoutUrl: endSessionUrl.href });
  } catch (err) {
    next(err);
  }
});
