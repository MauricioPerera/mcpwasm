# TAREA34 — README CI documentation

## What changed

Only `README.md` was modified (plus this new report). Three edits:

1. **Status badge** added at the top, immediately after the title line
   (`# mcpwasm — Static MCP`), standard GitHub Actions badge format linking to
   the `ci.yml` workflow runs.
2. **`## CI` section** inserted between `## Repository layout` and
   `## Development notes`. Brief prose (10 lines) covering: what the workflow
   runs (the four suites — `npm test`, `npm run spike`, `npm run gateway`,
   `npm run memspike` — each with its own build), when (push and pull_request
   to `main`), the environment (`ubuntu-latest`, Node 22, `npm ci` with cache,
   15 min timeout), and the network warning: the `gateway` and `memspike`
   suites reach the deployed production workers (`*.rckflr.workers.dev`) over
   the public internet, so CI depends on those workers being up.
3. **`## Repository layout`** gained one row for
   `.github/workflows/ci.yml`, in the same table style as the existing entries.

Style copied from `## Development notes` / `## Quick start`: sober technical
English, no marketing, no Spanish. `.github/workflows/ci.yml` was not touched.

## Definition of done — real outputs

```
===1a: ^## CI===
432:## CI

===1b: all ^## ===
27:## Why
50:## Architecture
115:## The executable-skill line in `llms.txt`
152:## Origin memory (search over static content)
165:## Skills
192:## Skill attestations (advisory)
256:## Quick start
325:## Security model (honest)
401:## Repository layout
432:## CI
443:## Development notes
```

`## CI` has exactly 1 hit (line 432) and sits between `## Repository layout`
(401) and `## Development notes` (443).

```
===2: badge.svg===
3:[![CI](https://github.com/MauricioPerera/mcpwasm/actions/workflows/ci.yml/badge.svg)](https://github.com/MauricioPerera/mcpwasm/actions/workflows/ci.yml)
```

1 hit, on line 3 (within the first 5 lines).

```
===3: ci.yml===
3:[![CI](https://github.com/MauricioPerera/mcpwasm/actions/workflows/ci.yml/badge.svg)](https://github.com/MauricioPerera/mcpwasm/actions/workflows/ci.yml)
430:| `.github/workflows/ci.yml` | GitHub Actions CI: runs the four suites (test/spike/gateway/memspike) on push and pull_request to `main`. |
434:The workflow in `.github/workflows/ci.yml` runs the four suites — `npm test`,
```

`ci.yml` appears in the badge (3), in `## Repository layout` (430), and in the
`## CI` section (434).

```
===4a: memspike (CI section lines 435, 438)===
435:`npm run spike`, `npm run gateway`, `npm run memspike` — each preceded by its
438:15 minutes. The `gateway` and `memspike` suites reach the deployed

===4b: production workers===
439:production workers (`*.rckflr.workers.dev`) over the public internet, so CI
```

The CI section names all four suites (`test`/`spike`/`gateway`/`memspike`) and
the production-workers network warning is present.

```
===5: spanish===
grep -n "suites verdes\|despliegue\|flujo de trabajo" README.md || echo SIN_MENCIONES
SIN_MENCIONES
```

No Spanish introduced.

```
===6: git status --porcelain===
 M README.md
 M mem-snapshot-sha.json
?? TAREA34-REPORT.md
```

`mem-snapshot-sha.json` was already modified in the working tree at session
start (pre-existing, not touched by this task). The task touched only
`README.md` (modified) and `TAREA34-REPORT.md` (new). No commit or push was
made.

## Trade-offs

- The CI prose was wrapped so the literal phrase "production workers" lands on
  a single line (it originally wrapped across two lines, which a single-line
  `grep` would miss). This is purely a line-break choice; the wording is
  unchanged.
- The badge points at `MauricioPerera/mcpwasm` per the spec; it renders green
  only once GitHub has run the workflow on the default branch and the badge
  cache populates (independent of this change).