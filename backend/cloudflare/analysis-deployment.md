# Demo analysis API connection

The existing Pages site continues to use `HORUBAK_AUTH` and its server-side sessions. The auth Worker checks project ownership and CSRF, streams the uploaded video to a separately hosted Python service, and stores transcript JSON by `(owner_id, project_id)` in the existing SQLite Durable Object. It does not expose the Python token or Gemini key to the browser.

## Server configuration

Configure the following values on `horubak-auth-test` using the existing deployment config `wrangler.auth-test.toml`:

- `ANALYSIS_BASE_URL`: the Python application's public HTTPS **origin**, with no path/query/credentials, for example `https://analysis.example.com`.
- `ANALYSIS_SERVICE_TOKEN`: the same random token (at least 32 characters) configured on the Python application. Store it as a Worker secret.

The Python service itself needs `GEMINI_API_KEY`, model settings, FFmpeg and the dependencies described in `ai-server/deployment.md`. Never configure Gemini credentials in a `VITE_*` value.

Example secret setup, from `backend/`, with values entered interactively:

```powershell
npx wrangler secret put ANALYSIS_BASE_URL --config wrangler.auth-test.toml
npx wrangler secret put ANALYSIS_SERVICE_TOKEN --config wrangler.auth-test.toml
```

The Worker creates `project_transcripts` through its existing additive schema initialization. No account data or project documents are reset. Transcript source revisions are compared with current project metadata, and a changed source invalidates its previous transcript. A successful Python response must include `sourceSha256` alongside `language` and `segments`.

## API contract

- `GET /api/transcripts/projects/:id` returns owned transcript segments, or an empty array when no current transcript exists.
- `POST /api/transcripts/projects/:id/analyze` accepts multipart `file` as the **first** part, with the filename exactly matching the project's `sourceName`. The source must be a file project and at most 60 minutes. The incoming request body is capped at 95 MiB; the browser and Python default upload limit is 90 MiB. The private request timeout is 15 minutes.
- `POST /api/transcripts/projects/:id/context-check?start=...&end=...` accepts JSON `{}` and only allows 30–60 second ranges within the original source. The private timeout is 120 seconds. It forwards stored, owned transcript segments rather than accepting caller-supplied transcript text.
- Segment shape is `{ id, segmentIndex, startSeconds, endSeconds, text }`. All times refer to the original source in seconds.
- Context responses use `{ status: "keep" | "expand" | "review", reason, originalStartSeconds, originalEndSeconds, suggestion: { startSeconds, endSeconds, durationSeconds } | null }`.
- Failures preserve the demo API's `{ code, message }` response shape. An unset service returns HTTP 503. It never substitutes sample transcript data for a failed real request.

Limits are initial demo conditions rather than the full product's upload limits. Original video storage, URL importing, asynchronous distributed jobs and rendering remain separate integrations. Uploads are transient at this API boundary; Python deletes its private temporary files. Additional functional tests were deliberately not run for this change.
