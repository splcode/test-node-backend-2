/**
 * Small, strongly-typed fetch client.
 *
 * JSON responses are parsed with a reviver that turns ISO-8601 strings into
 * `Date` objects, so a contract typed `createdAt: Date` is true at runtime.
 * Heads up: the reviver matches any ISO-shaped string, including a bare
 * 4-digit year like "2024" — tighten `ISO_8601` if your API sends such values
 * as plain strings.
 */

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Values sent as a query string (GET/HEAD/DELETE) or a JSON body. */
export type RequestData = Record<string, unknown>;

/** A path segment, a ready-made URL, or the trailing data bag. */
export type RequestArg = string | number | URL | RequestData;

/** A value, or a (possibly async) function producing one — resolved per request. */
export type MaybeAsync<T> = T | (() => T | Promise<T>);

export interface ApiClientOptions {
  /** Resolved against each request's path. Value or (async) function. */
  baseUrl?: MaybeAsync<string>;
  /** Merged into every request's headers. Value or (async) function. */
  defaultHeaders?: MaybeAsync<Record<string, string>>;
  /** Merged into every request's query/body. */
  defaultRequestData?: RequestData;
}

interface ApiClientEventMap {
  fetchsuccess: CustomEvent<void>;
  fetcherror: ErrorEvent;
  notokresponse: CustomEvent<Response>;
}

const ISO_8601 =
  /^\d{4}(-\d\d(-\d\d(T\d\d:\d\d(:\d\d)?(\.\d+)?(([+-]\d\d:\d\d)|Z)?)?)?)?$/i;

function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value === "string" && ISO_8601.test(value)) {
    return new Date(value);
  }
  return value;
}

function parseJSONWithDates<T>(text: string): T {
  return JSON.parse(text, reviveDates) as T;
}

function shouldParseJson(res: Response, text: string): boolean {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return true;
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

async function resolveMaybe<T>(value: MaybeAsync<T>): Promise<T> {
  return typeof value === "function"
    ? await (value as () => T | Promise<T>)()
    : value;
}

/** Best-effort read of an error response body, for `ApiError.body`. */
async function readBodySafely(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text.trim()) return undefined;
    return shouldParseJson(res, text) ? parseJSONWithDates(text) : text;
  } catch {
    return undefined;
  }
}

/** Thrown for non-2xx responses; carries the response and any parsed body. */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly response: Response;
  readonly body: unknown;

  constructor(response: Response, body: unknown) {
    super(`${response.status} ${response.statusText}`);
    this.name = "ApiError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.response = response;
    this.body = body;
  }
}

export default class ApiClient extends EventTarget {
  baseUrl: MaybeAsync<string>;
  defaultHeaders: MaybeAsync<Record<string, string>>;
  defaultRequestData: RequestData;

  constructor(options: ApiClientOptions = {}) {
    super();
    this.baseUrl = options.baseUrl ?? "";
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.defaultRequestData = options.defaultRequestData ?? {};
  }

  // Typed event subscription; the string overload mirrors the EventTarget base.
  addEventListener<K extends keyof ApiClientEventMap>(
    type: K,
    listener: (event: ApiClientEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: unknown,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options,
    );
  }

  async request<T = unknown>(
    method: HttpMethod,
    ...args: RequestArg[]
  ): Promise<T> {
    const requestData: RequestData = { ...this.defaultRequestData };

    // A trailing plain object (not a URL) is request data, not a path segment.
    const last = args[args.length - 1];
    if (typeof last === "object" && last !== null && !(last instanceof URL)) {
      Object.assign(requestData, args.pop() as RequestData);
    }

    // Treat the base as a directory (ensure a trailing slash) so that
    // `new URL("sample", base)` appends instead of replacing the last segment.
    const base = await resolveMaybe(this.baseUrl);
    const url =
      args[0] instanceof URL
        ? args[0]
        : new URL(
            (args as Array<string | number>)
              .map((segment) => encodeURIComponent(segment))
              .join("/"),
            base && !base.endsWith("/") ? `${base}/` : base,
          );

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(await resolveMaybe(this.defaultHeaders)),
    };
    const init: RequestInit = { method, headers };

    if (Object.keys(requestData).length > 0) {
      if (method === "GET" || method === "HEAD" || method === "DELETE") {
        for (const [key, value] of Object.entries(requestData)) {
          url.searchParams.set(key, String(value));
        }
      } else {
        init.body = JSON.stringify(requestData);
        headers["Content-Type"] = "application/json";
      }
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (error) {
      this.dispatchEvent(
        new ErrorEvent("fetcherror", {
          error,
          message: "An underlying error occurred while making an API fetch call.",
        }),
      );
      throw error;
    }

    this.dispatchEvent(new CustomEvent("fetchsuccess"));

    if (!res.ok) {
      this.dispatchEvent(new CustomEvent("notokresponse", { detail: res }));
      throw new ApiError(res, await readBodySafely(res));
    }

    // No content to parse.
    if (res.status === 202 || res.status === 204 || method === "HEAD") {
      return undefined as T;
    }

    const text = await res.text();
    if (!text.trim()) return undefined as T;

    return shouldParseJson(res, text)
      ? parseJSONWithDates<T>(text)
      : (text as T);
  }

  get<T = unknown>(...args: RequestArg[]): Promise<T> {
    return this.request<T>("GET", ...args);
  }
  head<T = unknown>(...args: RequestArg[]): Promise<T> {
    return this.request<T>("HEAD", ...args);
  }
  post<T = unknown>(...args: RequestArg[]): Promise<T> {
    return this.request<T>("POST", ...args);
  }
  put<T = unknown>(...args: RequestArg[]): Promise<T> {
    return this.request<T>("PUT", ...args);
  }
  patch<T = unknown>(...args: RequestArg[]): Promise<T> {
    return this.request<T>("PATCH", ...args);
  }
  delete<T = unknown>(...args: RequestArg[]): Promise<T> {
    return this.request<T>("DELETE", ...args);
  }
}
