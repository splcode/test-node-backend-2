import "@picocss/pico/css/pico.min.css";
import { api } from "./api";
import type { SampleListResponse } from "@contracts";

const { data } = await api.get<SampleListResponse>("sample");

const app = document.querySelector("#app")!;
app.replaceChildren(
  ...data.map((sample) => {
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
