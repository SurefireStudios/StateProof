# StateProof — submission package

| | |
| --- | --- |
| Archive | `release/stateproof-submission-final.zip` |
| SHA-256 | `e11ce89f7b628c883ae6f38bf5b120e36f766c6b76dd580110b4a33ec716cb2e` |
| Size | 1.15 MB (1203871 bytes) |
| Files | 561 |
| Source commit | `9ca7c7c4fa024c0686d744174029de16c33ae746` |
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
| `pnpm install --frozen-lockfile` | passed | 3.1 s |
| `pnpm typecheck` | passed | 4.7 s |
| `pnpm test` | FAILED | 8.8 s |

Install took 3.1 s.

**RESULT: FAILED**

## Verifying the archive

```bash
sha256sum -c stateproof-submission-final.sha256
```

Then extract it and follow `docs/judge-quick-start.md`.
