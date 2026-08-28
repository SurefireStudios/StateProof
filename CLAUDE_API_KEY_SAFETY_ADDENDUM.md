# StateProof — API Key Safety Addendum for Gate 2.5

Apply this addendum to the existing Gate 2.5 prompt.

## Change the project credential variable

Do **not** use `ANTHROPIC_API_KEY` for StateProof's own API client while Claude Code is being used to develop the repository.

Use:

```env
STATEPROOF_ANTHROPIC_API_KEY=your_key_here
```

The StateProof Anthropic adapter must read `STATEPROOF_ANTHROPIC_API_KEY` and pass it directly to the Anthropic SDK client as the `apiKey` value.

Do **not**:
- copy it into `process.env.ANTHROPIC_API_KEY`;
- export `ANTHROPIC_API_KEY`;
- put `ANTHROPIC_API_KEY` in `.claude/settings*.json`;
- print either credential value;
- persist either credential value into artifacts.

The missing-credential error should now request `STATEPROOF_ANTHROPIC_API_KEY`.

## Keep Claude Code on subscription auth

Before starting/restarting Claude Code, ensure `ANTHROPIC_API_KEY` is not present in the shell environment.

Windows PowerShell check:

```powershell
if ($env:ANTHROPIC_API_KEY) { Write-Host "ANTHROPIC_API_KEY is set" } else { Write-Host "ANTHROPIC_API_KEY is NOT set" }
```

If it is set:

```powershell
Remove-Item Env:ANTHROPIC_API_KEY
```

Then start/restart Claude Code normally.

## Protect the local secret file from Claude Code

Add or update `.claude/settings.local.json` with a local deny rule:

```json
{
  "permissions": {
    "deny": [
      "Read(.env)",
      "Read(.env.*)"
    ]
  }
}
```

Keep `.claude/settings.local.json` gitignored if it is local-only.

Do not ask Claude Code to inspect, print, grep, cat, echo, or otherwise read `.env`.

The StateProof process may load `.env` itself when the user explicitly runs the benchmark command; Claude Code should not read the file contents.

## `.env.example`

Use only a placeholder:

```env
STATEPROOF_ANTHROPIC_API_KEY=
```

Never include a real key.

## Smoke test / baseline

`pnpm benchmark:smoke-model` and the live baseline may use `STATEPROOF_ANTHROPIC_API_KEY`.

Record only:
- provider;
- model;
- model configuration;
- token usage;
- request outcome.

Never record the key.

All other Gate 2.5 requirements remain unchanged.
