# StateProof — submission package

| | |
| --- | --- |
| Archive | `release/stateproof-submission-final.zip` |
| SHA-256 | `e7ee1e458bf9a2f345e939a7fda0a634758bd2e9ac1360760522053b00eb86dd` |
| Size | 1.15 MB (1205014 bytes) |
| Files | 562 |
| Source commit | `087fa903f0afa4f364fe65f509d253eec96b7333` |
| Built on | win32 10.0.26200 (x64), Node v20.10.0, pnpm 8.12.0 |

## What is inside

The include list is `git archive` at the source commit — every tracked file,
and nothing untracked — plus both prebuilt surfaces so the package runs
without a build step.

- `.env.example`
- `.gitattributes`
- `.gitignore`
- `CLAUDE.md`
- `FINAL_SUBMISSION_CHECKLIST.md`
- `IMPROVEMENT_CHANGELOG.md`
- `LICENSE`
- `PREEXISTING_WORK.md`
- `README.md`
- `REPRODUCTION.md`
- `SUBMISSION.md`
- `apps`
- `artifacts`
- `benchmarks`
- `docs`
- `package.json`
- `packages`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `prompts`
- `release`
- `samples`
- `scripts`
- `submission`
- `tsconfig.base.json`
- `tsconfig.json`
- `vitest.config.ts`

Prebuilt dashboard: 20 file(s).
Prebuilt product: client.js, index.html, logo.svg, styles.css.
Sample run package: included.

## What is excluded

- .env
- .env - Copy.example
- node_modules
- release/
- temporary clean-checkout directories
- .claude/ local settings
- untracked files of any kind (git archive is the include list)

## How this package was proved

It was extracted into a fresh temporary directory outside the source tree,
with `STATEPROOF_ANTHROPIC_API_KEY` and `ANTHROPIC_API_KEY` removed from the
environment, and the whole offline workflow was run there:

| Step | Result | Duration |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | passed | 3.6 s |
| `pnpm typecheck` | passed | 5.3 s |
| `pnpm test` | FAILED | 14.8 s |

Install took 3.6 s.

**RESULT: FAILED**

## Verifying the archive

```bash
sha256sum -c stateproof-submission-final.sha256
```

Then extract it and follow `docs/judge-quick-start.md`.
