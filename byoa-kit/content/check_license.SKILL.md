---
name: check_license
version: 1.0.0
license: MIT
---

# check_license

Consulta el estado de un token de licencia de creador: plan, creaciones
restantes (`uses_left`), vencimiento. **Gratis** — sin aprobación humana.

## Cuándo usarla

- Antes de `create_item`, para verificar que el token del humano está activo
  y tiene usos disponibles.
- Para decirle al humano cuántas creaciones le quedan.
- Si `create_item` falló con 401/403, para distinguir token inválido de
  licencia agotada.