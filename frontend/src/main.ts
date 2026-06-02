import "@picocss/pico/css/pico.min.css";
import type { SampleListResponse } from "@contracts";

const res = await fetch("/api/v1/sample");
const { data } = (await res.json()) as SampleListResponse;

const app = document.querySelector("#app")!;
app.replaceChildren(
  ...data.map((sample) => {
    const article = document.createElement("article");
    const h3 = document.createElement("h3");
    h3.textContent = sample.name;
    const p = document.createElement("p");
    p.textContent = sample.description;
    article.append(h3, p);
    return article;
  }),
);
