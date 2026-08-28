---
name: buy_creator_access
version: 1.0.0
license: MIT
---

# buy_creator_access

Inicia la compra de una **licencia de creador** para crear items en la
plataforma: $19 por 25 creaciones, 30 días de vigencia (configurable en
`kit.config.json` → `monetize`). La tool es gratis; lo que vende es el acceso
a `create_item`.

## Flujo

1. Pide el email del humano.
2. Llama la tool → `payment_url` (paylink, absolutizada al origin de la
   plataforma).
3. El humano paga en el paylink (simulado en este demo — sin dinero real).
4. La página del paylink muestra el **license_token** tras el pago.
5. El humano te da el token → ya puedes usar `create_item`.

## Reglas

- El pago del paylink es del HUMANO: nunca lo ejecutes por tu cuenta salvo
  petición explícita.
- El token NO viene en la respuesta de esta tool — vive en la página de pago
  que ve el humano (por diseño: el que paga, recibe).