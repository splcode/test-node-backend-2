import "@picocss/pico/css/pico.min.css";
import { api } from "./api";
import { ApiError } from "./ApiClient";
import type { SampleListResponse } from "@contracts";

const app = document.querySelector("#app")!;

function renderError(message: string): void {
  const p = document.createElement("p");
  p.setAttribute("role", "alert");
  p.textContent = message;
  app.replaceChildren(p);
}

try {
  const response = await api.get<SampleListResponse>("sample");
  const samples = response?.data ?? [];

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
} catch (error) {
  renderError(
    error instanceof ApiError
      ? `Could not load samples: ${error.status} ${error.statusText}.`
      : "Could not load samples. Is the API running?",
  );
  console.error(error);
}
