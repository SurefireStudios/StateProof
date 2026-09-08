## What

<!-- One or two sentences. What does this change, and where? -->

## Why

<!-- The problem this solves, or the issue it closes. `Closes #123` if there is one. -->

## How it was verified

<!-- Tick what you ran. `pnpm final:verify` covers all of them. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm benchmark:validate` and `pnpm benchmark:validate-hard`
- [ ] `pnpm reproduce` still prints `RESULT: PASSED`
- [ ] `pnpm scan:secrets` is clean
- [ ] New or changed behaviour has a test

## Frozen surfaces

<!-- Prompts, benchmark fixtures, pinned artifacts and scoring code are the record of a completed evaluation. -->

- [ ] This change does **not** touch `prompts/`, `benchmarks/`, `artifacts/`, `submission/` or scoring code.
- [ ] Or: it does, the change is a new versioned run, and the changelog entry links its artifacts.

## Notes for the reviewer

<!-- Anything non-obvious. Screenshots for product or dashboard changes. -->
