import { serve } from "bun";
import index from "./index.html";

type PhoenixConnection = {
  baseUrl: string;
  apiKey?: string;
  project: string;
};

type TraceSummary = {
  id: string;
  trace_id: string;
  start_time: string;
  end_time: string;
  token_count_total?: number;
  spans?: unknown[];
};

type Span = {
  id?: string;
  name: string;
  context: {
    trace_id: string;
    span_id: string;
  };
  span_kind: string;
  parent_id?: string | null;
  start_time: string;
  end_time: string;
  status_code: string;
  status_message?: string;
  attributes?: Record<string, unknown>;
  events?: unknown[];
};

type LoadTracesRequest = {
  source: PhoenixConnection;
  limit?: number;
  startTime?: string;
  endTime?: string;
};

type LoadSpansRequest = {
  source: PhoenixConnection;
  traceIds: string[];
};

type ReflectRequest = {
  target: PhoenixConnection;
  spans: Span[];
};

const jsonHeaders = { "content-type": "application/json" };
const isProduction = process.env.NODE_ENV === "production";

function resolvePort() {
  const envPort = process.env.PORT;

  if (envPort) {
    const parsed = Number(envPort);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    throw new Error(`Invalid PORT: ${envPort}`);
  }

  return isProduction ? 3000 : 0;
}

function phoenixHeaders(apiKey?: string) {
  return {
    accept: "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

function phoenixUrl(baseUrl: string, path: string, query?: Record<string, string | string[] | number | undefined>) {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function readJson<T>(req: Request) {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error("Expected a JSON request body");
  }
}

async function phoenixFetch(baseUrl: string, path: string, options: RequestInit & { query?: Record<string, string | string[] | number | undefined> }) {
  const url = phoenixUrl(baseUrl, path, options.query);
  const response = await fetch(url, options);
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") && text ? JSON.parse(text) : text;

  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`);
  }

  return body;
}

function requireConnection(connection: PhoenixConnection, label: string) {
  if (!connection?.baseUrl) throw new Error(`${label} Phoenix URL is required`);
  if (!connection?.project) throw new Error(`${label} project is required`);
}

function publicSpan(span: Span): Span {
  const { id, ...rest } = span;
  return rest;
}

const server = serve({
  port: resolvePort(),
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/traces": async req => {
      try {
        const { source, limit = 25, startTime, endTime } = await readJson<LoadTracesRequest>(req);
        requireConnection(source, "Source");
        const project = encodeURIComponent(source.project);
        const data = await phoenixFetch(source.baseUrl, `/v1/projects/${project}/traces`, {
          method: "GET",
          headers: phoenixHeaders(source.apiKey),
          query: {
            limit,
            start_time: startTime,
            end_time: endTime,
            sort: "start_time",
            order: "desc",
          },
        });

        return Response.json({ traces: (data?.data ?? []) as TraceSummary[], nextCursor: data?.next_cursor ?? null });
      } catch (error) {
        return Response.json({ error: String(error instanceof Error ? error.message : error) }, { status: 400 });
      }
    },

    "/api/spans": async req => {
      try {
        const { source, traceIds } = await readJson<LoadSpansRequest>(req);
        requireConnection(source, "Source");
        if (!traceIds?.length) throw new Error("Select at least one trace");

        const project = encodeURIComponent(source.project);
        const data = await phoenixFetch(source.baseUrl, `/v1/projects/${project}/spans`, {
          method: "GET",
          headers: phoenixHeaders(source.apiKey),
          query: { limit: 1000, trace_id: traceIds },
        });

        return Response.json({ spans: (data?.data ?? []) as Span[], nextCursor: data?.next_cursor ?? null });
      } catch (error) {
        return Response.json({ error: String(error instanceof Error ? error.message : error) }, { status: 400 });
      }
    },

    "/api/reflect": async req => {
      try {
        const { target, spans } = await readJson<ReflectRequest>(req);
        requireConnection(target, "Target");
        if (!spans?.length) throw new Error("No spans to reflect");

        const project = encodeURIComponent(target.project);
        const result = await phoenixFetch(target.baseUrl, `/v1/projects/${project}/spans`, {
          method: "POST",
          headers: { ...phoenixHeaders(target.apiKey), "content-type": "application/json" },
          body: JSON.stringify({ data: spans.map(publicSpan) }),
        });

        return Response.json(result);
      } catch (error) {
        return Response.json({ error: String(error instanceof Error ? error.message : error) }, { status: 400, headers: jsonHeaders });
      }
    },
  },

  development: !isProduction && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
