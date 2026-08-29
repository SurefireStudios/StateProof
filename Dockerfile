# StateProof — production image.
#
# One service, one origin: the interactive product, the static evidence
# dashboard it hosts at /evidence/, and the committed artifacts both read.
#
# The image carries no credential and needs none. Live contract compilation is
# off unless STATEPROOF_ENABLE_LIVE_COMPILATION is set, and the demo, the sample
# import, frozen-contract verification, the benchmark and evidence export all
# work without one.

# --- build ------------------------------------------------------------------
FROM node:20.18.1-bookworm-slim AS build
WORKDIR /app

# Corepack pins pnpm to the version this lockfile was written with.
RUN corepack enable && corepack prepare pnpm@8.12.0 --activate

# Manifests first, so a source-only change does not re-resolve dependencies.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/product/package.json apps/product/
COPY packages/agents/package.json packages/agents/
COPY packages/benchmark/package.json packages/benchmark/
COPY packages/core/package.json packages/core/
COPY packages/model-provider/package.json packages/model-provider/
COPY packages/sandbox/package.json packages/sandbox/
COPY packages/submission/package.json packages/submission/
RUN pnpm install --frozen-lockfile

COPY . .

# Both surfaces and the sample package a judge can import in one click.
RUN pnpm product:build \
 && pnpm dashboard:build \
 && pnpm sample:build \
 && pnpm product:server:build

# --- runtime ----------------------------------------------------------------
FROM node:20.18.1-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4180 \
    STATEPROOF_ENABLE_LIVE_COMPILATION=false \
    STATEPROOF_ROOT=/app

# The server is a single bundled file, so no node_modules ship: only the
# built output and the committed data the verifier reads.
COPY --from=build /app/apps/product/dist-server ./apps/product/dist-server
COPY --from=build /app/apps/product/dist       ./apps/product/dist
COPY --from=build /app/apps/dashboard/dist     ./apps/dashboard/dist
COPY --from=build /app/samples                 ./samples

# Read at runtime by the verifier, the benchmark view and the contract bundle.
COPY --from=build /app/benchmarks  ./benchmarks
COPY --from=build /app/artifacts   ./artifacts
COPY --from=build /app/submission  ./submission
COPY --from=build /app/prompts     ./prompts
COPY --from=build /app/package.json ./package.json

# `node` already exists in this image; running as it drops root.
USER node

EXPOSE 4180

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4180)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/product/dist-server/index.js"]
