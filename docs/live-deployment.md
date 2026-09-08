# Live deployment

**Evidence dashboard, live:** <https://surefirestudios.github.io/StateProof/>

The static evidence dashboard is published by GitHub Pages from
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) on every push
to `main`. It is a pure function from the pinned artifacts to HTML, and the
build fails rather than renders if any pinned artifact has changed, so the
published page cannot show a number the repository does not back.

**Interactive product:** currently not hosted. The previous public instance ran
on a Railway trial that has ended. Two ways to get one:

- **Locally, in thirty seconds.** `pnpm install && pnpm product:build && pnpm product:dev`,
  then <http://localhost:4180/>. Identical to the hosted behaviour.
- **On Render's free tier, in one click.** [`render.yaml`](../render.yaml) is a
  Render Blueprint: *New → Blueprint → select this repository*. Render builds the
  Dockerfile, injects `PORT`, probes `/healthz` and redeploys on push. The
  free plan spins the service down after about fifteen idle minutes and wakes it
  on the next request, which is harmless because nothing persists by design.
  Add no environment variable other than the one the blueprint sets.

Whichever host runs it, StateProof deploys as **one service on one origin**: the
interactive product, the static evidence dashboard it hosts at `/evidence/`,
and the committed artifacts both read.

The public deployment has **no Anthropic API key and needs none**. Do not add
one.

## Architecture

```text
one container
├── node apps/product/dist-server/index.js     the server, bundled — no tsx
├── apps/product/dist/                         the client bundle and shell
├── apps/dashboard/dist/                       the evidence dashboard, served at /evidence/
├── benchmarks/  artifacts/  submission/       what the verifier and benchmark view read
└── samples/                                   the one-click sample run package
```

| Route | What it is |
| --- | --- |
| `/` | The product home: the worked example, the measured result, the actions |
| `/demo` | The verification demo (`PBH-B03`) |
| `/import` | The import workflow; `/import?sample` preloads the committed sample |
| `/benchmark` | Development, locked and combined results |
| `/runs/<id>` | The run inspector for a verification in this session |
| `/evidence/` | The static evidence dashboard (`/dashboard/` redirects here) |
| `/healthz` | Readiness |

Everything the deployment serves is deterministic: the verifier is code, the
numbers come from committed artifacts, and no route calls a model.

## Production scripts

```bash
pnpm product:build          # client bundle + shell  -> apps/product/dist
pnpm dashboard:build        # evidence dashboard     -> apps/dashboard/dist
pnpm sample:build           # sample run package     -> samples/
pnpm product:server:build   # server bundle          -> apps/product/dist-server
pnpm product:start          # node dist-server/index.js   (no tsx, no watch)
pnpm deploy:verify          # build, boot, exercise every public route, stop
```

`product:start` runs `node` on a single bundled file. There is no TypeScript
loader in the image.

## Environment variables

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `PORT` | no | `4180` | Railway sets this; the server reads it |
| `HOST` | no | `0.0.0.0` | Binding to localhost in a container serves nobody |
| `STATEPROOF_ENABLE_LIVE_COMPILATION` | no | `false` | Leave false in public |
| `STATEPROOF_ROOT` | no | resolved | Where the committed data lives; the image sets `/app` |
| `STATEPROOF_MAX_BODY_BYTES` | no | `12582912` | Request body ceiling |
| `STATEPROOF_MAX_CONCURRENT_JOBS` | no | `4` | Simultaneous imports/verifications |
| `STATEPROOF_RATE_LIMIT_PER_MINUTE` | no | `30` | Per-IP, on the expensive routes |

**No API credential should be configured.** `STATEPROOF_ANTHROPIC_API_KEY` is
not required, not read when live compilation is off, and must not be set on the
public deployment. `ANTHROPIC_API_KEY` is never read anywhere in this
repository.

With live compilation off the model provider is never imported, so no client is
constructed and no credential is looked at.

## Railway (previous host)

The original public instance ran on Railway from
[`railway.json`](../railway.json), which sets the Dockerfile builder,
`/healthz` as the health check and an on-failure restart policy. The trial has
ended and the service holds no deployment. To use Railway again:

```text
Railway → New Project → Deploy from GitHub Repo
Choose SurefireStudios/StateProof
Railway detects the root Dockerfile
Variables → add STATEPROOF_ENABLE_LIVE_COMPILATION = false
Deploy
Settings → Networking → Generate Domain
```

Add no other variable. `PORT` is injected by Railway.

## Any other Docker host

```bash
docker build -t stateproof:submission .
docker run --rm -p 4180:4180 \
  -e PORT=4180 \
  -e HOST=0.0.0.0 \
  -e STATEPROOF_ENABLE_LIVE_COMPILATION=false \
  stateproof:submission
```

The image pins Node 20.18.1 and pnpm 8.12.0 through Corepack, installs from
`pnpm-lock.yaml`, builds both surfaces, ships only the built output plus the
committed data, runs as the non-root `node` user, and carries its own health
check. `.dockerignore` keeps `.env` and every copy of it, `node_modules`,
`release/` and all build output out of the context.

## Public-demo limitations

- **Imported runs are ephemeral.** They live in memory with a TTL — 30 minutes
  for an import, an hour for a verified run — and are lost on restart or
  redeploy. Nothing a visitor uploads is written to disk, ever.
- Verified runs are capped at 200 per process; the oldest are evicted first.
- The expensive routes are rate-limited per IP, capped in concurrency, and
  refuse cross-origin requests.
- Uploads are capped at 8 MB per file, 12 MB per request, 64 archive entries and
  32 MB of expansion, with 500 trajectory events per run.
- Only the refund-operations domain validates. An import naming another
  collection is rejected rather than verified against rules that do not apply.
- Live contract compilation is disabled, so a run whose task matches none of the
  three frozen contracts cannot be verified on the public instance. Run it
  locally with your own key if you need that.

## Rollback

Railway keeps previous deployments:

```text
Deployments → the last good deployment → ⋯ → Redeploy
```

Or roll the source back and let the push redeploy:

```bash
git revert <bad-commit>
git push origin main
```

The evaluation artifacts are immutable and are not touched by any deployment, so
a rollback can never change a reported number.

## Removing the deployment after judging

```text
Settings → Danger → Delete Service
Settings → Danger → Delete Project
```

If a custom domain was configured, delete the `CNAME` record too. Nothing
outside Railway holds state: there is no database, no bucket and no queue.
