# StateProof — submission package

| | |
| --- | --- |
| Archive | `release/stateproof-submission-final.zip` |
| SHA-256 | `d5835f202e103da70755677a1a2b59b10961e4d4628ccad8573bc7d0f5b0b5c9` |
| Size | 1.15 MB (1205219 bytes) |
| Files | 562 |
| Source commit | `4e0cfb27784a0c2481a7f1d67523f3cfaa07f272` |
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
| `pnpm install --frozen-lockfile` | passed | 3.2 s |
| `pnpm typecheck` | passed | 4.7 s |
| `pnpm test` | passed | 14.4 s |
| `pnpm benchmark:validate` | passed | 1.3 s |
| `pnpm benchmark:validate-hard` | passed | 1.4 s |
| `pnpm reproduce` | FAILED | 3.5 s |

Install took 3.2 s.

**RESULT: FAILED**

## Verifying the archive

```bash
sha256sum -c stateproof-submission-final.sha256
```

Then extract it and follow `docs/judge-quick-start.md`.
