# TAREA29 — Firmar y publicar atestaciones de las skills legítimas (3 publishers)

**Modo:** advisory (el gateway NO se tocó ni se redeployó; `REVIEWERS` en
`wrangler-gateway.toml` ya tenía la clave pública del attester `human:mauricio`).
**Attester:** `human:mauricio` (clave existente en `.attester-key.json`, gitignored;
**no** se corrió `keygen`). **valid_until:** `2027-07-02` (mismo que las existentes).
**signed_on:** `2026-07-03` (UTC del momento de firma; las dos preexistentes de
docs-site llevaban `2026-07-02`).

> Prerrequisito para activar enforcing más adelante SIN excluir skills legítimas.
> En esta tarea **no** se activó enforcing.

---

## 1. Atestaciones emitidas

Firma Ed25519 con `scripts/attest.mjs sign <origin> <skill> 2027-07-02`. El
`tool_sha256` se leyó del `llms.txt` de **producción** (el mismo hash que sirve
cada worker, calculado por `build.mjs` sobre los bytes exactos del `tool.js`).

### demo-site (`https://llmstxt-demo-site.rckflr.workers.dev`) — 2 skills

```json
[
  {
    "origin": "https://llmstxt-demo-site.rckflr.workers.dev",
    "skill": "sum_numbers",
    "tool_sha256": "58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e",
    "attester": "human:mauricio",
    "signed_on": "2026-07-03",
    "valid_until": "2027-07-02",
    "signature": "a7CyF4vk6uq8tutTrhnY53H79hysUOgQ4mxzwhCfb/OL8FqZl0K1DJglBOXfRYCEuJ7rMohGLYHYluQmgyxbDA=="
  },
  {
    "origin": "https://llmstxt-demo-site.rckflr.workers.dev",
    "skill": "server_time",
    "tool_sha256": "5b9255eca41a95cc0cf38322dc973062133e1ce1e757da8cab8fdeb16ec934f5",
    "attester": "human:mauricio",
    "signed_on": "2026-07-03",
    "valid_until": "2027-07-02",
    "signature": "hPOetTcpK87g6rGKwgMqYmXEMEedj9tWhAR/GSRm3B+y0jJHZRaq1kHTvq0mbgEnNys/1aTukQD4OGslidGkCA=="
  }
]
```

### bookstore (`https://llmstxt-bookstore.rckflr.workers.dev`) — 4 skills legítimas

```json
[
  {
    "origin": "https://llmstxt-bookstore.rckflr.workers.dev",
    "skill": "search_catalog",
    "tool_sha256": "d1220dcd2dd6b6c57b363edbfc2f0f620457cc98d2cc087baa3c7ef45782f175",
    "attester": "human:mauricio",
    "signed_on": "2026-07-03",
    "valid_until": "2027-07-02",
    "signature": "h0eVe5H/bk9nNCBholq2+6vDD1j+bn2G8HLmQOCEZjki9Jh/aO5EMUsXxsno8KnTRxpkg+mGpXUDxrxkerUGCg=="
  },
  {
    "origin": "https://llmstxt-bookstore.rckflr.workers.dev",
    "skill": "get_book",
    "tool_sha256": "1b9a78f984ba5bf66450b422b23d151e37139dd05330b73f1b0bd42ae2b8b2ca",
    "attester": "human:mauricio",
    "signed_on": "2026-07-03",
    "valid_until": "2027-07-02",
    "signature": "FXnfAiAoUpV8ERvpxMBZi0AlBrX32UWTtyxCYQm7EfNep8Fy6Tw1OKVjkkcIsmaAaSON9agcqG8D21+ovvPFBQ=="
  },
  {
    "origin": "https://llmstxt-bookstore.rckflr.workers.dev",
    "skill": "stock_report",
    "tool_sha256": "86b166f2e9ec95112a18ec6bd4a12b2e5ee707137bace0366c74114a42e99b1f",
    "attester": "human:mauricio",
    "signed_on": "2026-07-03",
    "valid_until": "2027-07-02",
    "signature": "5Pr2f25gXzoAhbRviLZy6pcxIkdxyEzVV/b3ToDZabDZ4UQnfv7pi+wKevo7uA382d5qWzruQuBwXY3ipBBVCA=="
  },
  {
    "origin": "https://llmstxt-bookstore.rckflr.workers.dev",
    "skill": "create_order",
    "tool_sha256": "a7dbdf120c6bff98e3cfd601e784bcf591c1a897559e902046c2ca88f650b3f1",
    "attester": "human:mauricio",
    "signed_on": "2026-07-03",
    "valid_until": "2027-07-02",
    "signature": "tZ1TzqOnx8z+Gf8oECKgLZkUjBRfmYBlTOCIt7FqB++D4WhW96HWq6pCcAZ0NqbfAYQCkG2HH3bIoNDvtMXZDw=="
  }
]
```

**No firmadas (a propósito):** `corrupt_skill` (fixture de hash mismatch → el
gateway la excluye y no aparece en `tools/list`) y `busy_loop` (fixture de
interrupt → debe quedar `unattested`).

### docs-site (`https://llmstxt-docs.rckflr.workers.dev`) — 3 skills

`search_spec` y `get_doc` **ya estaban firmadas** (conservadas tal cual, con
`signed_on 2026-07-02`). Se **añadió** `list_docs`:

```json
{
  "origin": "https://llmstxt-docs.rckflr.workers.dev",
  "skill": "list_docs",
  "tool_sha256": "17d6175805386a0829012ab088c72ca98058255564a47230903c697432666735",
  "attester": "human:mauricio",
  "signed_on": "2026-07-03",
  "valid_until": "2027-07-02",
  "signature": "hdY0j0SmYg+DKE69rvgdK22FVdzuB1ULbU+PFo0zOALzXvT36aQrIYC49sFlpNLaajqEkyczQDemhIoIek9GCQ=="
}
```

---

## 2. Publicación: archivos + rutas en los workers

Cada `attestations.json` se publica en
`/.well-known/agent-skills/attestations.json` (content-type `application/json`).

- **docs-site:** ya servía esa ruta (`build.mjs` inlinea `content/attestations.json`
  como constante `ATTESTATIONS`). Solo se **añadió** `list_docs` al array
  existente (`docs-site/content/attestations.json`) manteniendo `search_spec` y
  `get_doc`.
- **demo-site** y **bookstore:** **no** servían la ruta. Se añadió
  `content/attestations.json` y se modificó `build.mjs` para (a) leerlo e
  inlinearlo como constante `ATTESTATIONS` y (b) generar la ruta
  `/.well-known/agent-skills/attestations.json` siguiendo el **mismo patrón** que
  sus rutas actuales (`/llms.txt`, `/skills/*`).

Verificación post-build: los tres `worker.mjs` generados contienen la ruta y la
constante `ATTESTATIONS` (`grep` confirmó presencia en `demo-site/worker.mjs`,
`bookstore/worker.mjs`, `docs-site/worker.mjs`).

Archivos tocados (solo publishers): `demo-site/build.mjs`, `demo-site/content/attestations.json`,
`bookstore/build.mjs`, `bookstore/content/attestations.json`, `docs-site/content/attestations.json`
(+ los `worker.mjs`/`wrangler.toml` autogenerados por cada `build.mjs`).

---

## 3. Deploys

Gateway **no** redeployado. Los tres publishers sí:

```
npx wrangler deploy -c demo-site/wrangler.toml
  -> https://llmstxt-demo-site.rckflr.workers.dev  Version b171ba33-6508-4bee-a799-24c7336ed751

npx wrangler deploy -c bookstore/wrangler.toml
  -> https://llmstxt-bookstore.rckflr.workers.dev  Version 196ec4db-bf21-4d86-839f-da09c9755839
  (binding env.DB = D1 bookstore-db)

npx wrangler deploy -c docs-site/wrangler.toml
  -> https://llmstxt-docs.rckflr.workers.dev  Version f69639c0-c0da-4a22-bc9b-9aa285f9d275
```

---

## 4. curl directo de los 3 `attestations.json` en producción

```
$ curl https://llmstxt-demo-site.rckflr.workers.dev/.well-known/agent-skills/attestations.json
[{"origin":"https://llmstxt-demo-site.rckflr.workers.dev","skill":"sum_numbers","tool_sha256":"58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e","attester":"human:mauricio","signed_on":"2026-07-03","valid_until":"2027-07-02","signature":"a7CyF4vk6uq8tutTrhnY53H79hysUgQ4mxzwhCfb/OL8FqZl0K1DJglBOXfRYCEuJ7rMohGLYHYluQmgyxbDA=="},
 {"origin":"https://llmstxt-demo-site.rckflr.workers.dev","skill":"server_time","tool_sha256":"5b9255eca41a95cc0cf38322dc973062133e1ce1e757da8cab8fdeb16ec934f5","attester":"human:mauricio","signed_on":"2026-07-03","valid_until":"2027-07-02","signature":"hPOetTcpK87g6rGKwgMqYmXEMEedj9tWhAR/GSRm3B+y0jJHZRaq1kHTvq0mbgEnNys/1aTukQD4OGslidGkCA=="}]

$ curl https://llmstxt-bookstore.rckflr.workers.dev/.well-known/agent-skills/attestations.json
[{"skill":"search_catalog","tool_sha256":"d1220dcd2dd6b6c57b363edbfc2f0f620457cc98d2cc087baa3c7ef45782f175",...,"signature":"h0eVe5H/bk9nNCBholq2+6vDD1j+bn2G8HLmQOCEZjki9Jh/aO5EMUsXxsno8KnTRxpkg+mGpXUDxrxkerUGCg=="},
 {"skill":"get_book","tool_sha256":"1b9a78f984ba5bf66450b422b23d151e37139dd05330b73f1b0bd42ae2b8b2ca",...,"signature":"FXnfAiAoUpV8ERvpxMBZi0AlBrX32UWTtyxCYQm7EfNep8Fy6Tw1OKVjkkcIsmaAaSON9agcqG8D21+ovvPFBQ=="},
 {"skill":"stock_report","tool_sha256":"86b166f2e9ec95112a18ec6bd4a12b2e5ee707137bace0366c74114a42e99b1f",...,"signature":"5Pr2f25gXzoAhbRviLZy6pcxIkdxyEzVV/b3ToDZabDZ4UQnfv7pi+wKevo7uA382d5qWzruQuBwXY3ipBBVCA=="},
 {"skill":"create_order","tool_sha256":"a7dbdf120c6bff98e3cfd601e784bcf591c1a897559e902046c2ca88f650b3f1",...,"signature":"tZ1TzqOnx8z+Gf8oECKgLZkUjBRfmYBlTOCIt7FqB++D4WhW96HWq6pCcAZ0NqbfAYQCkG2HH3bIoNDvtMXZDw=="}]
(todos con origin https://llmstxt-bookstore.rckflr.workers.dev, attester human:mauricio, signed_on 2026-07-03, valid_until 2027-07-02)

$ curl https://llmstxt-docs.rckflr.workers.dev/.well-known/agent-skills/attestations.json
[{"skill":"search_spec",...,"signed_on":"2026-07-02",...,"signature":"ohpC1s+7keIF/BYUmGTwIwWSxLrH0OVc5zIvfwYl2tyrYh8r/o/dfvmAld/tZmBgJyXPMbKMfy4qoZfPO7ueDA=="},
 {"skill":"get_doc",...,"signed_on":"2026-07-02",...,"signature":"WvlhjJAfQGBYZte4XQDD+C3OpGcyJIoiBPNsNs+vjbDoi0/7jwUhw4NrPfvXRJkYu4mTzWA6dMWTzPzdxvI2CA=="},
 {"skill":"list_docs","tool_sha256":"17d6175805386a0829012ab088c72ca98058255564a47230903c697432666735","signed_on":"2026-07-03","valid_until":"2027-07-02","signature":"hdY0j0SmYg+DKE69rvgdK22FVdzuB1ULbU+PFo0zOALzXvT36aQrIYC49sFlpNLaajqEkyczQDemhIoIek9GCQ=="}]
```

---

## 5. Verificación via gateway (tools/list, modo advisory)

`POST /mcp?origin=<enc>` con `Authorization: Bearer <token>` (token en
`.gateway-token`, no expuesto). Tras los deploys el descubrimiento refrescó
(`x-gw-discovery: miss` en los tres → fetch fresco de `llms.txt` + tool.js +
`attestations.json`, cache TTL 60s).

### demo-site
- Header: `x-gw-attestations: 2attested,0expired,0invalid,0unattested`
- `sum_numbers` → `[attestation: attested]`
- `server_time` → `[attestation: attested]`

### bookstore
- Header: `x-gw-attestations: 4attested,0expired,0invalid,1unattested`
- `search_catalog` → `[attestation: attested]`
- `get_book` → `[attestation: attested]`
- `stock_report` → `[attestation: attested]`
- `create_order` → `[attestation: attested]`
- `busy_loop` → `[attestation: unattested]` (a propósito; fixture de interrupt)
- `corrupt_skill` → **NO aparece** en `tools/list` (excluida por hash mismatch:
  `tool_sha256` declarado `0000…0000` ≠ real `63103f6e…`). Solo 5 tools listadas.

### docs-site
- Header: `x-gw-attestations: 3attested,0expired,0invalid,0unattested`
- `search_spec` → `[attestation: attested]`
- `get_doc` → `[attestation: attested]`
- `list_docs` → `[attestation: attested]`

---

## 6. Sanidad — tool_call real por origin (vía gateway)

- **demo** `sum_numbers(40, 2)` → `{"result":42}` ✓
- **bookstore** `stock_report` → `{"total_titles":52,"total_stock":503,"out_of_stock":12,"top3_by_stock":[...]}` ✓
- **docs** `search_spec(q="tool_sha256", k=3)` → 3 hits (top: `mcpwasm-readme: Skill attestations (advisory)`, score −4.866) ✓

---

## Definición de hecho — cumplimiento

- [x] Atestaciones emitidas (objetos JSON arriba; sin clave privada ni token).
- [x] 3 deploys (demo, bookstore, docs); gateway sin tocar.
- [x] curl de los 3 `attestations.json` en prod (sección 4).
- [x] Verificación via gateway: todas las skills legítimas `attested` + `X-Gw-Attestations` por origin (sección 5).
- [x] Sanidad: tool_call real por origin OK (sección 6).
- [x] No se activó enforcing. No se corrió `keygen`. No se tocaron `worker-gateway.mjs`, `wrangler-gateway.toml`, `host-async.mjs`, `mcp-core*.mjs`, `llmstxt-parse.mjs`, `scripts/**`, `README.md`, `.attester-key.json`.

**Totales attested por origin:** demo-site 2/2 · bookstore 4/4 legítimas (busy_loop unattested a propósito, corrupt_skill excluida) · docs-site 3/3.