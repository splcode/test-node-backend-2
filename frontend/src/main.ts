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

/** Compact top bar: who's signed in + a Log in / Log out button. */
function renderAuthbar(user: SessionUser | null): void {
  const button = document.createElement("button");
  button.style.width = "auto";
  if (user) {
    const who = document.createElement("span");
    who.textContent = `Signed in as ${user.name ?? user.email ?? user.sub}  `;
    button.textContent = "Log out";
    button.classList.add("secondary");
    button.addEventListener("click", () => void logout());
    authbar.replaceChildren(who, button);
  } else {
    button.textContent = "Log in";
    button.addEventListener("click", () => login());
    authbar.replaceChildren(button);
  }
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

/** Echo the authorization picture: realm role + per-org membership and roles. */
function identityCard(user: SessionUser): HTMLElement {
  const card = document.createElement("article");

  const header = document.createElement("header");
  header.textContent = "Who am I?";
  card.append(header);

  const realm = document.createElement("p");
  realm.append(document.createTextNode("Realm role: "));
  const realmRoles = user.realmRoles.length ? user.realmRoles.join(", ") : "(none)";
  const kbd = document.createElement("kbd");
  kbd.textContent = realmRoles;
  realm.append(kbd);
  card.append(realm);

  const orgs = Object.values(user.organizations);
  if (orgs.length === 0) {
    const p = document.createElement("p");
    p.textContent = "Not a member of any organization.";
    card.append(p);
    return card;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  for (const h of ["Organization", "Member", "Roles", "Is admin?"]) {
    const th = document.createElement("th");
    th.textContent = h;
    hrow.append(th);
  }
  thead.append(hrow);

  const tbody = document.createElement("tbody");
  for (const org of orgs) {
    const isAdmin = org.roles.includes("admin");
    const row = document.createElement("tr");
    row.append(
      cell(org.name),
      cell("✓"), // present in the claim ⇒ a member
      cell(org.roles.length ? org.roles.join(", ") : "(member)"),
      cell(isAdmin ? "yes" : "no"),
    );
    tbody.append(row);
  }
  table.append(thead, tbody);
  card.append(table);
  return card;
}

function sampleArticles(samples: SampleListResponse["data"]): HTMLElement[] {
  return samples.map((sample) => {
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
  });
}

const user = await fetchMe();
renderAuthbar(user);

if (!user) {
  // Logged out: prompt for login instead of hitting the guarded API.
  const p = document.createElement("p");
  p.textContent = "Log in to view your roles and the samples.";
  app.replaceChildren(p);
} else {
  // Now that we expect to be authenticated, a later 401 (e.g. session expiry)
  // should bounce to login rather than just erroring.
  api.onUnauthorized = () => login();
  try {
    const response = await api.get<SampleListResponse>("sample");
    app.replaceChildren(identityCard(user), ...sampleArticles(response?.data ?? []));
  } catch (error) {
    renderError(
      error instanceof ApiError
        ? `Could not load samples: ${error.status} ${error.statusText}.`
        : "Could not load samples. Is the API running?",
    );
    console.error(error);
  }
}
