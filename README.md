# px-reflect

A small local tool for copying selected traces from one Phoenix instance into another.

## Run

```bash
bun install
bun dev
```

Open the printed local URL, configure the source and target Phoenix instances, load traces, select traces, stage spans, then reflect them into the target project.

## Phoenix API Usage

The Bun server proxies Phoenix requests so the browser does not need direct CORS access:

- `GET /v1/projects/{project_identifier}/traces` loads recent source traces.
- `GET /v1/projects/{project_identifier}/spans?trace_id=...` loads spans for selected traces.
- `POST /v1/projects/{project_identifier}/spans` inserts those spans into the target project.

API keys are sent as `Authorization: Bearer <key>`, matching `@arizeai/phoenix-client`.
