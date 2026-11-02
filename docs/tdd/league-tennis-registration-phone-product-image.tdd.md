# Reporte TDD — League Tennis Web: teléfono en registro, imagen de producto y menú responsivo

- **Fecha:** 2026-11-02
- **Proyecto:** `league-tennis-web` (Clon local en `/public/league-tennis-web`)
- **Source plan:** No se proporcionó plan; se derivaron los casos de la solicitud del usuario.

## User journeys implementadas

1. **Jornada 1 — Persistencia del teléfono al registrarse**
   - Como jugador, quiero registrar mi número de teléfono, para que la liga pueda gestionarlo.
   - Como administrador, quiero editar el teléfono de una cuenta, para corregir datos de contacto.

2. **Jornada 2 — Imagen de producto en la tienda**
   - Como administrador, quiero asignar una imagen (URL) a un producto digital/suscripción,
     para que la tienda la muestre en la landing.

## Task report

| # | Tarea | Resumen | Validación | Estado |
|---|-------|---------|-----------|--------|
| 1 | Guardar teléfono en registro | Se añadió campo `phone` al formulario de registro, validación (>= 7 dígitos) y persistencia en `users.json` vía GitHub; se devuelve en sesión/login/me y se edita desde el panel admin. | `npm test` (RED/GREEN) | GREEN |
| 2 | Imagen de producto | Se acepta `image` en creación (`POST /api/products`) y actualización (`PUT /api/products/[id]`); admin con preview; tienda renderiza `<img>` en la portada. | `npm test` (RED/GREEN) | GREEN |
| 3 | Menú responsivo + colores admin | Navbar móvil: dropdown absoluto bajo el header, cierra al elegir enlace. Admin nav: hover corregido (verde oscuro/fondo claro con texto legible). | Revisión manual de CSS/JS | N/A |

## Test specification

| # | Qué se garantiza | Test | Tipo | Resultado |
|---|------------------|------|------|-----------|
| 1 | El registro persiste el teléfono y lo devuelve en el usuario de sesión | `test/auth.test.js` / `registration stores the phone number and returns it in the session user` | integration | PASS |
| 2 | El registro rechaza teléfonos sin suficientes dígitos | `test/auth.test.js` / `registration rejects a phone number without enough digits` | integration | PASS |
| 3 | La creación de producto guarda la imagen y la actualización la modifica | `test/products.test.js` / `admin product creation stores the image and updates it later` | integration | PASS |
| 4 | Regresión: flujo completo de auth/checkout/tournaments intacto | `test/workflows.test.js`, `test/helpers.test.js` | integration/unit | PASS |

## Resultado final

- Comando de validación ejecutado: `npm test` dentro de `/public/league-tennis-web` → **8/8 tests PASS**.
- Cobertura: no definida en el proyecto (`npm run test:coverage` no configurado); se validó con la suite existente.

## Cobertura y gaps conocidos

- No se ejecutó cobertura (sin script configurado).
- El control de imagen se implementó con campo por URL (más viable con persistencia JSON en GitHub); una carga directa de archivo multipart queda como mejora futura.
- El CSS del menú responsivo fue verificado por revisión; no hay suite de UI automatizada en el proyecto.
