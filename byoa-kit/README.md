# byoa-kit — plantilla de plataforma BYOA en un directorio

El kit convierte la secuencia **discovery → skills → API → attestations** en
una plantilla copiable. Un publisher llena `kit.config.json`, edita el
contenido, despliega y firma. Sin tocar el worker a mano (se genera).

## Qué trae

| archivo | rol |
|---|---|
| `kit.config.json` | nombre, descripción, origin y lista de skills de la plataforma |
| `content/*.tool.js` | 3 tools de ejemplo (list/get/create) que corren sandboxeadas en la máquina del consumidor |
| `content/*.SKILL.md` | la pedagogía de cada tool (incluye la REGLA BYOA de aprobación humana) |
| `content/attestations.json` | (opcional) attestations Ed25519 firmadas — si existe, se sirve en well-known |
| `schema.sql` + `seed.json` | tabla genérica `items` + semilla |
| `build.mjs` | genera `worker.mjs`: landing + llms.txt v0.4 (con hashes) + rutas de skills + API CRUD |
| `wrangler.toml` | config de despliegue (D1 + nodejs_compat) |

## Monetización: vende el acceso a tu tool de escritura

`kit.config.json` → bloque `monetize` (activado por defecto):

```json
"monetize": { "enabled": true, "tool": "create_item", "price": 19, "uses": 25, "days": 30 }
```

Con `enabled: true`, el worker generado **gatea `create_item`** tras una
licencia de creador:

1. El agente llama `create_item` sin token → `{ok:false, needs_payment:true}`.
2. El agente llama `buy_creator_access` con el email del humano → paylink.
3. **El humano paga** ($19 / 25 creaciones / 30 días — simulado hasta conectar
   Stripe) y la página del paylink le muestra el `license_token`.
4. El agente crea con `{access_token}` → cada creación decrementa `uses_left`.

`buy_creator_access` y `check_license` son gratis; la lectura también. Para
desactivar: `"enabled": false` y quita esas 2 skills de la lista (el build
regenera el worker libre). La tabla `licenses` vive en `schema.sql`.

## Los 7 pasos (de cero a plataforma attestada)

```bash
# 0. scaffoldea tu plataforma desde el kit
node scripts/byoa-init.mjs mi-tienda
cd mi-tienda

# 1. edita kit.config.json (nombre, origin, skills) y content/ (tools + SKILL.md)
#    REGLA: toda tool que escribe en el mundo real lleva SKILL.md con aprobación humana.

# 2. crea la base D1 y pega el id en wrangler.toml
npx wrangler d1 create mi-tienda-db
node build.mjs                      # genera worker.mjs con hashes reales

# 3. aplica schema + seed (local o remoto)
npx wrangler d1 execute mi-tienda-db --remote -c wrangler.toml --file schema.sql

# 4. despliega
npx wrangler deploy -c wrangler.toml

# 5. firma las attestations (necesita .attester-key.json; keygen solo la crea si no existe)
node scripts/attest.mjs sign https://mi-tienda.rckflr.workers.dev --all 2027-12-31 \
  > content/attestations.json
node build.mjs && npx wrangler deploy -c wrangler.toml   # re-despliega con well-known

# 6. registra tu clave publica como reviewer en el gateway
#    (wrangler-gateway.toml -> REVIEWERS -> "human:tu-nombre": {"public_key": "..."} )
#    y redeploya el gateway.

# 7. verifica el veredicto del gateway en enforcing
node scripts/verify-shop-attest.mjs   # patrón: gateway real + registro real + origin vivo
```

## Los invariantes que el kit preserva

1. **Discovery estático con hashes**: el llms.txt lista cada skill con su
   `tool_sha256` — el consumidor verifica antes de ejecutar. Los hashes se
   calculan del contenido REAL en `build.mjs`, nunca a mano.
2. **Read/write split explícito**: las tools de lectura son públicas; las de
   escritura documentan la aprobación humana en su SKILL.md.
3. **El worker es generado**: editar `worker.mjs` a mano se pierde en el
   próximo build. Toda la lógica vive en `build.mjs` (template) y `content/`.
4. **Attestations opcionales pero de primera clase**: basta soltar
   `content/attestations.json` para que el origin las sirva en
   `/.well-known/agent-skills/attestations.json`.

## Ejemplos reales construidos con este patrón

- `../shop/` — e-commerce (catálogo + órdenes idempotentes + paylink simulado)
- `../studio/` — deploys efímeros en Cloudflare con capability del host
- `../bookstore/` — el bookstore original con attestations