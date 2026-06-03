import ApiClient from "./ApiClient";

// Base for all calls. Same-origin in prod; in dev Vite proxies /api to Express.
// Double-submit CSRF: the backend hands us a readable XSRF-TOKEN cookie and the
// client echoes it in X-XSRF-TOKEN on mutations (matches backend `auth/csrf.ts`).
export const api = new ApiClient({
  baseUrl: new URL("/api/v1/", window.location.origin).href,
  xsrfCookieName: "XSRF-TOKEN",
  xsrfHeaderName: "X-XSRF-TOKEN",
});

/** Send the browser through the BFF login, returning here afterwards. */
export function login(returnTo: string = window.location.pathname): void {
  window.location.assign(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}

/**
 * POST /auth/logout (CSRF-safe), then navigate to the Keycloak end-session URL it
 * returns so the SSO session ends too and we land back on the logged-out home.
 */
export async function logout(): Promise<void> {
  // A URL object is used verbatim by the client (it bypasses the /api/v1 base).
  const res = await api.post<{ logoutUrl: string }>(
    new URL("/auth/logout", window.location.origin),
  );
  window.location.assign(res?.logoutUrl ?? "/");
}
