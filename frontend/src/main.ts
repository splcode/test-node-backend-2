import "@picocss/pico/css/pico.min.css";
import "./style.css";
import type { Sample, SampleListResponse } from "@contracts";

const app = document.querySelector<HTMLElement>("#app");

async function load(): Promise<void> {
  if (!app) return;
  try {
    const res = await fetch("/api/v1/sample");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as SampleListResponse;
    render(body.data);
  } catch (err) {
    app.removeAttribute("aria-busy");
    app.replaceChildren(errorCard(err));
  }
}

function render(samples: Sample[]): void {
  if (!app) return;
  app.removeAttribute("aria-busy");
  if (samples.length === 0) {
    const p = document.createElement("p");
    p.textContent = "No samples yet.";
    app.replaceChildren(p);
    return;
  }
  app.replaceChildren(...samples.map(sampleCard));
}

// Built with the DOM API (textContent) rather than innerHTML to avoid XSS.
function sampleCard(sample: Sample): HTMLElement {
  const article = document.createElement("article");

  const h3 = document.createElement("h3");
  h3.textContent = sample.name;

  const p = document.createElement("p");
  p.textContent = sample.description;

  const small = document.createElement("small");
  small.textContent = new Date(sample.createdAt).toLocaleString();

  article.append(h3, p, small);
  return article;
}

function errorCard(err: unknown): HTMLElement {
  const article = document.createElement("article");
  article.textContent = `Failed to load samples: ${String(err)}`;
  return article;
}

void load();
