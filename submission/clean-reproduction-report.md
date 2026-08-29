# Clean-checkout reproduction

**Result: PASSED**

- Commit: `a1b18762120e74a5655ef16f5bebaaf1c74b2eb5` (tag `stateproof-submission-v1`)
- OS: Windows_NT 10.0.26200 (win32/x64)
- Node: v20.10.0
- pnpm: 8.12.0
- Credentials: `STATEPROOF_ANTHROPIC_API_KEY` and `ANTHROPIC_API_KEY` removed from the child environment
- Checkout: fresh `git clone` of HEAD into a temporary directory — no `.env`, no `node_modules`, no prior build output

## Commands

| Command | Result | Duration |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | ok | 2.9 s |
| `pnpm typecheck` | ok | 3.3 s |
| `pnpm test` | ok | 18.3 s |
| `pnpm benchmark:validate` | ok | 1.3 s |
| `pnpm benchmark:validate-hard` | ok | 1.4 s |
| `pnpm reproduce` | ok | 4.0 s |
| `pnpm dashboard:build` | ok | 1.8 s |

## Absolute development paths in the built output

None. The generated site contains no path pointing back at the development machine.

## Pinned canonical prediction hashes

| Run | sha256 |
| --- | --- |
| `RUN-baseline-development-live-20260828T222134Z` | `fe0414685189019dbade76bd2e54d37a` |
| `RUN-baseline-hard-development-live-20260828T233139Z` | `442419e5c27334beb6161b17bfc696b0` |
| `RUN-stateproof-hard-development-live-20260829T004039Z` | `e98c0da07dca72cd6eaea7eab1e5a56b` |
| `RUN-stateproof-hard-development-cold-20260829T013429Z` | `791f62311d44f8e1c4dd16f2238b03f5` |
| `RUN-stateproof-hard-development-cold-20260829T022133Z` | `3d8ef516fa5d6d6bd673fbb87ae2ce49` |
| `RUN-stateproof-hard-development-warm-20260829T022344Z` | `3d8ef516fa5d6d6bd673fbb87ae2ce49` |
| `RUN-stateproof-hard-development-warm-20260829T022354Z` | `3d8ef516fa5d6d6bd673fbb87ae2ce49` |
| `RUN-stateproof-hard-development-warm-20260829T022355Z` | `3d8ef516fa5d6d6bd673fbb87ae2ce49` |
| `RUN-baseline-hard-locked-live-20260829T035909Z` | `1fa2558582a5f85ef740678a57595190` |
| `RUN-stateproof-hard-locked-warm-20260829T040036Z` | `57d9c4fc3157e6655b8b641f82d5f140` |

Report fingerprint: `62320cfeaeac9db5`
