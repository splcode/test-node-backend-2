import "@picocss/pico/css/pico.min.css";
import { api, login, logout } from "./api";
import { ApiError } from "./ApiClient";
import type { MeResponse, SampleListResponse, SessionUser } from "@contracts";

const authbar = document.querySelector("#authbar")!;
const app = document.querySelector("#app")!;

function renderError(message: string): void {
  const p = document.createElement("p");
  p.setAttribute("role", "alert");
  p.textContent = message;
  app.replaceChildren(p);
}

/** Probe the session. A 401 means "not logged in" — expected, so swallow it. */
async function fetchMe(): Promise<SessionUser | null> {
  try {
    const res = await api.get<MeResponse>("me");
    return res?.user ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

function renderAuthbar(user: SessionUser | null): void {
  authbar.replaceChildren();
  if (!user) {
    const button = document.createElement("button");
    button.textContent = "Log in";
    button.addEventListener("click", () => login());
    authbar.append(button);
    return;
  }

  const who = document.createElement("span");
  who.textContent = `Signed in as ${user.name ?? user.email ?? user.sub}`;

  // Show the org memberships + roles we mapped out of the token.
  const orgs = document.createElement("small");
  const lines = Object.values(user.organizations).map(
    (org) => `${org.name}: ${org.roles.join(", ") || "no roles"}`,
  );
  orgs.textContent = lines.length ? ` — ${lines.join(" · ")}` : "";

  const out = document.createElement("button");
  out.textContent = "Log out";
  out.classList.add("secondary");
  out.addEventListener("click", () => {
    void logout();
  });

  authbar.append(who, orgs, out);
}

function renderSamples(samples: SampleListResponse["data"]): void {
  app.replaceChildren(
    ...samples.map((sample) => {
      const article = document.createElement("article");
      const h3 = document.createElement("h3");
      h3.textContent = sample.name;
      const p = document.createElement("p");
      p.textContent = sample.description;
      const footer = document.createElement("footer");
      // createdAt is a real Date here, revived by the client.
      footer.textContent = `Added ${sample.createdAt.toLocaleString()}`;
      article.append(h3, p, footer);
      return article;
    }),
  );
}

const user = await fetchMe();
renderAuthbar(user);

if (!user) {
  // Logged out: prompt for login instead of hitting the guarded API.
  const p = document.createElement("p");
  p.textContent = "Log in to view samples.";
  app.replaceChildren(p);
} else {
  // Now that we expect to be authenticated, a later 401 (e.g. session expiry)
  // should bounce to login rather than just erroring.
  api.onUnauthorized = () => login();
  try {
    const response = await api.get<SampleListResponse>("sample");
    renderSamples(response?.data ?? []);
  } catch (error) {
    renderError(
      error instanceof ApiError
        ? `Could not load samples: ${error.status} ${error.statusText}.`
        : "Could not load samples. Is the API running?",
    );
    console.error(error);
  }
}
