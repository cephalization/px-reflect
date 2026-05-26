import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, RefreshCcw, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import "./index.css";

type PhoenixConnection = {
  baseUrl: string;
  apiKey: string;
  project: string;
};

type TraceSummary = {
  id: string;
  trace_id: string;
  start_time: string;
  end_time: string;
  token_count_total?: number;
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

const defaultSource: PhoenixConnection = {
  baseUrl: "http://localhost:6006",
  apiKey: "",
  project: "default",
};

const defaultTarget: PhoenixConnection = {
  baseUrl: "http://localhost:6007",
  apiKey: "",
  project: "default",
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `${response.status} ${response.statusText}`);
  return data as T;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });
}

function durationMs(trace: TraceSummary) {
  const start = new Date(trace.start_time).valueOf();
  const end = new Date(trace.end_time).valueOf();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

function shortId(id: string) {
  return id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id;
}

export function App() {
  const [source, setSource] = useState(defaultSource);
  const [target, setTarget] = useState(defaultTarget);
  const [limit, setLimit] = useState(25);
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [spans, setSpans] = useState<Span[]>([]);
  const [status, setStatus] = useState("Configure both Phoenix instances, load traces, select rows, then reflect.");
  const [loading, setLoading] = useState(false);

  const selectedTraceIds = selectedIds
    .map(id => traces.find(trace => trace.id === id)?.trace_id)
    .filter((id): id is string => Boolean(id));
  const selectedSpans = spans.filter(span => selectedTraceIds.includes(span.context.trace_id));

  const updateConnection = (side: "source" | "target", field: keyof PhoenixConnection, value: string) => {
    const setConnection = side === "source" ? setSource : setTarget;
    setConnection(current => ({ ...current, [field]: value }));
  };

  const loadTraces = async (event?: FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setStatus("Loading traces from source Phoenix...");
    try {
      const data = await postJson<{ traces: TraceSummary[] }>("/api/traces", { source, limit });
      setTraces(data.traces);
      setSelectedIds([]);
      setSpans([]);
      setStatus(`Loaded ${data.traces.length} traces from ${source.baseUrl}.`);
    } catch (error) {
      setStatus(String(error instanceof Error ? error.message : error));
    } finally {
      setLoading(false);
    }
  };

  const toggleTrace = (id: string) => {
    setSelectedIds(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));
  };

  const selectAll = () => {
    setSelectedIds(current => (current.length === traces.length ? [] : traces.map(trace => trace.id)));
  };

  const loadSelectedSpans = async () => {
    setLoading(true);
    setStatus("Fetching spans for selected traces...");
    try {
      const data = await postJson<{ spans: Span[] }>("/api/spans", { source, traceIds: selectedTraceIds });
      setSpans(data.spans);
      setStatus(`Ready to reflect ${data.spans.length} spans from ${selectedTraceIds.length} traces.`);
    } catch (error) {
      setStatus(String(error instanceof Error ? error.message : error));
    } finally {
      setLoading(false);
    }
  };

  const reflect = async () => {
    setLoading(true);
    setStatus("Reflecting selected spans into target Phoenix...");
    try {
      const data = await postJson<{ total_received?: number; total_queued?: number }>("/api/reflect", {
        target,
        spans: selectedSpans,
      });
      setStatus(`Reflected ${data.total_queued ?? selectedSpans.length} of ${data.total_received ?? selectedSpans.length} spans into ${target.baseUrl}.`);
    } catch (error) {
      setStatus(String(error instanceof Error ? error.message : error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="isolate min-h-dvh w-full bg-background">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15">
                <ArrowRight className="size-5 text-primary" />
              </div>
              <span className="font-mono text-sm tracking-wide text-muted-foreground">Phoenix Reflector</span>
            </div>
            <h1 className="max-w-[20ch] text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Pick traces here. Recreate them there.
            </h1>
            <p className="max-w-xl text-pretty text-base text-muted-foreground">
              Load recent traces from one Phoenix instance, inspect the selected span payloads, and POST those spans into another Phoenix project.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground lg:w-80">
            {status}
          </div>
        </header>

        {/* Connection form */}
        <form onSubmit={loadTraces} className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
            <ConnectionCard title="Source" description="Phoenix instance to read from" connection={source} side="source" onChange={updateConnection} />
            <div className="hidden items-center justify-center lg:flex">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ArrowRight className="size-5" />
              </div>
            </div>
            <ConnectionCard title="Target" description="Phoenix instance to write into" connection={target} side="target" onChange={updateConnection} />
          </div>

          {/* Actions bar */}
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end sm:p-5">
            <div className="grid gap-2 sm:w-32">
              <Label htmlFor="limit">Trace limit</Label>
              <Input id="limit" min={1} max={200} type="number" value={limit} onChange={event => setLimit(Number(event.target.value))} />
            </div>
            <div className="flex flex-1 flex-wrap gap-3">
              <Button type="submit" disabled={loading}>
                <Search className="size-4" />
                Load traces
              </Button>
              <Button type="button" variant="secondary" disabled={loading || selectedIds.length === 0} onClick={loadSelectedSpans}>
                <RefreshCcw className="size-4" />
                Stage selected
              </Button>
              <Button type="button" variant="outline" disabled={loading || selectedSpans.length === 0} onClick={reflect}>
                Reflect {selectedSpans.length || ""} spans
              </Button>
            </div>
          </div>
        </form>

        {/* Main content */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* Traces list */}
          <Card>
            <CardHeader className="border-b border-border">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Source Traces</CardTitle>
                  <CardDescription>
                    {selectedIds.length > 0 ? `${selectedIds.length} of ${traces.length} selected` : `${traces.length} traces`}
                  </CardDescription>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={selectAll} disabled={traces.length === 0}>
                  {selectedIds.length === traces.length && traces.length > 0 ? "Clear all" : "Select all"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[520px] overflow-auto">
                {traces.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">No traces loaded yet.</div>
                ) : (
                  <ul role="list" className="divide-y divide-border">
                    {traces.map(trace => {
                      const selected = selectedIds.includes(trace.id);
                      const duration = durationMs(trace);
                      return (
                        <li key={trace.id}>
                          <button
                            type="button"
                            onClick={() => toggleTrace(trace.id)}
                            className={`grid w-full gap-2 px-5 py-4 text-left transition-colors hover:bg-accent/50 ${selected ? "bg-primary/8" : ""}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className={`font-mono text-sm tabular-nums ${selected ? "text-primary" : "text-foreground"}`}>
                                {shortId(trace.trace_id)}
                              </span>
                              <span className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                                {duration == null ? "unknown" : `${duration.toLocaleString()} ms`}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                              <span>{formatDate(trace.start_time)}</span>
                              {trace.token_count_total != null && (
                                <span className="tabular-nums">{trace.token_count_total.toLocaleString()} tokens</span>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Payload preview */}
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle>Reflection Payload</CardTitle>
              <CardDescription>{selectedSpans.length} staged spans</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                readOnly
                value={selectedSpans.length ? JSON.stringify(selectedSpans, null, 2) : "Stage selected spans to preview the payload."}
                className="min-h-[460px] resize-y bg-muted/50 font-mono text-sm"
              />
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}

function ConnectionCard({
  title,
  description,
  connection,
  side,
  onChange,
}: {
  title: string;
  description: string;
  connection: PhoenixConnection;
  side: "source" | "target";
  onChange: (side: "source" | "target", field: keyof PhoenixConnection, value: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${side}-url`}>Phoenix URL</Label>
          <Input id={`${side}-url`} value={connection.baseUrl} onChange={event => onChange(side, "baseUrl", event.target.value)} placeholder="http://localhost:6006" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${side}-project`}>Project</Label>
          <Input id={`${side}-project`} value={connection.project} onChange={event => onChange(side, "project", event.target.value)} placeholder="default" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${side}-api-key`}>API key</Label>
          <Input
            id={`${side}-api-key`}
            type="password"
            value={connection.apiKey}
            onChange={event => onChange(side, "apiKey", event.target.value)}
            placeholder="Optional bearer token"
          />
        </div>
      </CardContent>
    </Card>
  );
}

export default App;
