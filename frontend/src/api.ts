import ApiClient from "./ApiClient";

// Base for all calls. Same-origin in prod; in dev Vite proxies /api to Express.
export const api = new ApiClient({
  baseUrl: new URL("/api/v1/", window.location.origin).href,
});
