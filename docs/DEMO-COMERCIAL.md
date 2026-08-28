# DEMO COMERCIAL — probar el circuito con un agente externo

Guía para probar el modelo comercial de mcpwasm **antes de conectar Stripe**
(pagos simulados: el paylink activa con un clic, no cobra dinero real).

## Qué necesitas

- Un agente con acceso a web/HTTP (Claude Code, Antigravity, Cursor, etc.)
- Tú juegas el rol del HUMANO: el agente te pide aprobación y te pasa los
  paylinks. Tú pagas (clic simulado) y le devuelves el token cuando aplique.
- Nada más: las plataformas están en producción y todo se puede verificar.

---

## Escenario A — Tienda: comprar acceso y crear productos

Pega esto a tu agente:

```text
Eres un agente comercial explorando un marketplace. Tu origen es
https://llmstxt-shop.rckflr.workers.dev

1. Descubre tus capacidades: haz GET a /llms.txt y sigue el protocolo que
   describe (las tools son scripts JS servibles; llámalas vía la API REST
   que cada SKILL.md documenta).
2. Lista el catálogo y enséñame 3 productos.
3. Quiero publicar mis propios productos: descubre cómo se obtiene acceso
   de creador, pídeme mi email si lo necesitas, y entrégame el paylink
   ANTES de continuar. NO avances sin mostrarme el link de pago.
4. (El humano paga el paylink y te pega el license_token que la página
   muestra tras el pago.)
5. Crea 2 productos de ejemplo con mi token y muéstrame la búsqueda que
   los confirma, incluyendo cuántos usos de licencia quedan.
6. Reporta al final: qué herramientas usaste, qué costó cada una y qué
   quedó creado.
```

Checkpoints humanos: **paso 3** (aprobar la compra de $19 y pagar el
paylink), **paso 4** (pegar el token al agente).

## Escenario B — Tienda: comprar un producto

```text
Compra por mí en https://llmstxt-shop.rckflr.workers.dev

1. GET /llms.txt para descubrir las tools.
2. Busca el producto más barato y crea una orden con
   client_order_id "demo-<tu-nombre>" y mi email.
3. Muéstrame el paylink; NO lo pagues hasta que yo lo apruebe.
4. (El humano paga.)
5. Verifica el estado de la orden y repórtame el resultado completo.
```

## Escenario C — Studio: crear, desplegar y reclamar

```text
Voy a probarte como constructor de apps con tu agente. Usa
https://llmstxt-studio.rckflr.workers.dev (descubre con GET /llms.txt).

1. Construye una mini web "carta de un restaurante" (1 archivo, HTML+JS)
   y despliega con create_preview. Dame la URL pública.
2. Enséñame el claim nativo de Cloudflare (claimUrl) y explícame la
   diferencia con claim_preview.
3. Quiero quedármela: llama claim_preview con mi email y muéstrame el
   paylink. NO pagues sin mi aprobación.
4. (El humano paga en la página de claim.)
5. Verifica con preview_status que quedó claimed con mi email y el nuevo
   TTL, y repórtame el estado final.
```

Checkpoints humanos: **paso 3** (aprobar $19 del claim y pagar).

## Verificar lo que hizo el agente (merchant)

Tras las pruebas, revisa el panel en vivo:

```bash
node scripts/merchant-report.mjs
```

Deberías ver: las órdenes nuevas (status `paid` tras tu pago), las licencias
de creador con usos decrementados, y el revenue simulado acumulado. Para el
claim del studio: `GET https://llmstxt-studio.rckflr.workers.dev/preview?sid=<sid>`
muestra `claimed` con tu email.

## Qué NO debe hacer el agente (reglas del protocolo)

- Jamás debe pagar por su cuenta: el paylink es SIEMPRE decisión del humano.
- El `license_token` lo recibe el HUMANO en la página del pago; el agente lo
  recibe del humano, no de la API (la API no lo devuelve — "el que paga, recibe").
- Las credenciales de Cloudflare de los previews nunca salen del worker
  (el agente solo ve `previewUrl` y `claimUrl`).

## Notas técnicas

- Pagos simulados: el botón del paylink confirma en el servidor sin cobrar.
  Al conectar Stripe, este mismo flujo pasa a cobrar de verdad — el playbook
  no cambia.
- El gateway está en modo CLIENTS (enforcing): un agente externo puede
  consumir directamente el origen (`npx -y @rckflr/mcpwasm <origin>`) o con
  token de cliente vía el gateway.
- Cada plataforma anuncia su protocolo en `/llms.txt` y sirve tools+
  SKILL.md con hashes verificables (attestations firmadas).