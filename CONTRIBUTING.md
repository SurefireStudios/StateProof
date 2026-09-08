# Contributing to StateProof

Thanks for your interest. StateProof is small, strict, and evidence-driven, and
contributions are welcome in that spirit: every change should leave the
repository at least as verifiable as it found it.

## Ground rules

- **Evidence over assertion.** A claim in a doc, a number in a README, a verdict
  in a fixture: each must trace to something in the repository. If you cannot
  point at the artifact, do not make the claim.
- **The frozen evaluation stays frozen.** Prompts under `prompts/`, the
  benchmark fixtures, the pinned artifacts under `artifacts/` and `submission/`,
  and the scoring code are the record of a completed evaluation. Changing any
  of them is a *new* evaluation, not a fix. Open an issue first.
- **Synthetic data only.** Never add real customer data, real credentials, real
  email addresses, or absolute local paths. `pnpm scan:secrets` enforces this and
  runs in CI.
- **Read-only by construction.** The verifier and the product never write to a
  sandbox or perform a consequential action. Keep it that way.

## Getting started

Requirements: Node.js `>=20.10.0` and pnpm `>=8.12.0` (Corepack: `corepack enable`).

```bash
git clone https://github.com/SurefireStudios/StateProof.git
cd StateProof
pnpm install
pnpm typecheck
pnpm test
```

Run the product locally:

```bash
pnpm product:build
pnpm product:dev        # http://localhost:4180/
```

Nothing above needs an API key. See [REPRODUCTION.md](REPRODUCTION.md) for the
full offline workflow and [docs/judge-quick-start.md](docs/judge-quick-start.md)
for a guided tour.

## What to work on

- The [roadmap](docs/roadmap.md) and the open issues labelled
  [`roadmap`](https://github.com/SurefireStudios/StateProof/issues?q=is%3Aissue+is%3Aopen+label%3Aroadmap).
- Issues labelled [`good first issue`](https://github.com/SurefireStudios/StateProof/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
- Anything in [docs/limitations.md](docs/limitations.md) under *What would have
  to be true for this to be production-ready*.

If you want to propose a new benchmark case, use the **Benchmark case** issue
template. Cases are reviewed against the same rules as the existing suite:
one isolated fault per invalid case, gold data kept out of the agent-visible
files, and a deterministic assertion that proves the gold verdict.

## Making a change

1. Fork and branch from `main`.
2. Keep the change bounded. One concern per pull request.
3. Add or update tests. Schemas, assertions, state diffs, scoring and gold
   isolation are all unit-tested; new behaviour should be too.
4. Run the full offline check before opening the pull request:

   ```bash
   pnpm final:verify
   ```

   It runs typecheck, tests, both fixture validators, the credential-free
   reproduction, the artifact-integrity check, both builds, the product tests,
   the secret scan, and a documentation link check.
5. Open the pull request using the template. Say what changed, why, and how you
   verified it.

## Code standards

- TypeScript strict mode. No `any`.
- Every external or model-produced value is validated with Zod at the boundary.
- Small modules with explicit interfaces. Model interpretation and deterministic
  scoring stay in separate packages.
- Prompts live in versioned files and are hashed into run manifests. A changed
  prompt is a new version file, never an edit in place.
- Fixtures use seeded ids and timestamps. Money is a two-decimal string, never a
  float. Events are ordered by gap-free `seq`, never by timestamp.
- Non-obvious decisions go in `docs/decisions/` as a short ADR.

## Commit messages

Conventional prefixes are used but not enforced: `feat:`, `fix:`, `docs:`,
`test:`, `chore:`, `refactor:`, `polish:`. Write the body for the reader who has
to understand the change without the pull request open.

## Reporting bugs and security issues

- Bugs: the **Bug report** issue template.
- Security: see [SECURITY.md](SECURITY.md). Please do not open a public issue
  for a vulnerability.

## Licence

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
