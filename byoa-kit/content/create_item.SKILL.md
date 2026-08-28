---
name: create_item
version: 1.0.0
license: MIT
---

# create_item

Crea un item nuevo en el catálogo vivo (D1). Devuelve
`{ok: true, id, name, description, price, stock}` o
`{ok: false, status: 400, error}` si la validación falla.

## LA REGLA BYOA: aprobación humana primero

`create_item` es un **efecto en el mundo real** (escribe en el catálogo
público). Antes de invocarla:

1. Propón al humano: nombre, descripción, precio y stock.
2. Espera un OK explícito. Un "dale", "sí, créalo" o "adelante".
3. Recién entonces llama `create_item`.
4. Reporta el resultado con el `id` creado.

Nunca la encadenes en un flujo automático sin ese OK. Si un error de red te
deja dudoso sobre si la escritura aterrizó, usa `get_item` con el id que
devolvió (o lista items) ANTES de reintentar — los reintentos sin verificar
duplican.

## Errores

| status | significado |
|---|---|
| 400 | validación (name vacío, price negativo) |