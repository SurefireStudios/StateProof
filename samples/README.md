# Sample run package

`stateproof-sample-run.zip` is a ready-made agent-run package for the product's
import screen, so a reviewer can try the import workflow without assembling seven
files by hand.

```bash
pnpm product:dev     # then: http://localhost:4180/#/import
```

The import screen offers it as a download; you can also upload this file
directly.

## What is in it

Six files, and only six — the ones an agent could itself have seen:

```text
task.json
tool-registry.json
initial-state.json
trajectory.jsonl
final-state.json
final-response.txt
```

It carries **no gold contract, no gold verdict, no case metadata, no split
label, no credential and no local path**. It is built by
`scripts/build-sample-package.ts` through `loadAgentVisibleCase`, the same
gold-isolated loader the evaluation uses, which cannot reach the gold files in
the first place. Three tests check the archive's contents independently of that.

## Which case

`PBH-A01`, a **development** case — never a locked one — from
PhantomBench-Hard-12. It is deliberately not the demo case: it uses a different
task template and resolves to a different frozen contract, so importing it shows
a second, independent verification rather than a repeat of the demo.

It verifies to **PASS** on four requirements, with zero model calls.

## Rebuilding it

```bash
pnpm sample:build
```

The archive is stored uncompressed, so its bytes are a direct function of its
contents: the same fixtures always produce the same file, and a reviewer can diff
it.

Regenerating it is safe and changes nothing about the evaluation — the fixtures
it reads are frozen.
