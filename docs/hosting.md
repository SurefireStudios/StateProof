# Optional static hosting

The dashboard is a folder of static files. Hosting it is convenient, never
required: `pnpm dashboard:build && pnpm dev` is the supported path, and
reproduction does not depend on a hosted demo existing.

## What gets deployed

`apps/dashboard/dist/` only — nineteen files, all generated from committed
artifacts by `pnpm dashboard:build`. No server, no runtime, no database, no
credential.

## Any static host

```bash
pnpm install
pnpm dashboard:build
# then upload apps/dashboard/dist/ as-is
```

The site uses relative links throughout, so it works from a subdirectory. Links
to raw artifacts (`../../artifacts/...`) resolve only when the repository is
served alongside it — that is why `pnpm dev` serves both, and why a hosted copy
should be treated as a preview rather than the evidence trail.

## GitHub Pages

A workflow is provided but **disabled by default**. It only ever runs the same
build a judge runs locally.

Create `.github/workflows/pages.yml` with the content below, then enable Pages
for the repository (Settings → Pages → Source: GitHub Actions). Delete the file
to disable it again.

```yaml
name: dashboard
on:
  workflow_dispatch:            # manual only; never on push
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 8.12.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20.10.0, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm dashboard:build
      - uses: actions/upload-pages-artifact@v3
        with: { path: apps/dashboard/dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - id: deploy
        uses: actions/deploy-pages@v4
```

It satisfies the constraints that matter:

- **builds only from committed artifacts** — `pnpm dashboard:build` reads the
  pinned registry and nothing else;
- **makes no model call** — the build has no network access to a provider and no
  credential is configured;
- **needs no secret** — `GITHUB_TOKEN` permissions only;
- **mutates no evaluation artifact** — it writes to the Pages artifact, never to
  `artifacts/` or `submission/`;
- **deploys only `apps/dashboard/dist`**.

`workflow_dispatch` is deliberate: a push-triggered deploy would make the hosted
copy drift from whatever a judge has checked out.

## Disabling

Delete `.github/workflows/pages.yml`, or set Settings → Pages → Source to
"None". Nothing else in the repository depends on it.
