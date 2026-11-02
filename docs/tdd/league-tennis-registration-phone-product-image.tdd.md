# Reporte TDD — League Tennis Web: teléfono, imagen/categoría de producto, menú y secciones nuevas

- **Fecha:** 2026-11-02 (sesión ampliada)
- **Proyecto:** `league-tennis-web` (Clon local en `/public/league-tennis-web`)
- **Source plan:** No se proporcionó plan; se derivaron los casos de la solicitud del usuario.

## User journeys implementadas

1. **Jornada 1 — Persistencia del teléfono al registrarse**
   - Como jugador, quiero registrar mi número de teléfono, para que la liga pueda gestionarlo.
   - Como administrador, quiero editar el teléfono de una cuenta, para corregir datos de contacto.

2. **Jornada 2 — Imagen y categoría de producto**
   - Como administrador, quiero asignar una imagen (URL) y categoría (libros / ropa) a un producto,
     para que la tienda muestre productos correctos.

3. **Jornada 3 — Secciones de contenido**
   - Como visitante, quiero ver donaciones y reglamento en la landing, para conocer causas y normas.

## Task report

| # | Tarea | Resumen | Validación | Estado |
|---|-------|---------|-----------|--------|
| 1 | Persistencia del teléfono en registro | Campo `phone` en registro, validación, persistencia y devolución en sesión/login/me; edición desde admin. | `npm test` (RED/GREEN) | GREEN |
| 2 | Imagen de producto | `image` en crear/editar producto; admin con preview; tienda renderiza `<img>`. | `npm test` (RED/GREEN) | GREEN |
| 3 | Categorías de producto | `category` (libros / ropa) en crear/editar producto; admin y tienda. | `npm test` (RED/GREEN) | GREEN |
| 4 | Secciones nuevas de landing | Donaciones y Reglamento añadidos a la landing pública. | Revisión estática HTML/CSS | N/A |
| 5 | Main draw | Torneos agrupan partidos por ronda con título "Main draw". | Revisión estática JS | N/A |
| 6 | Menú responsivo + colores admin | Dropdown móvil del navbar; hover de admin corregido. | Revisión manual CSS/JS | N/A |

## Test specification

| # | Qué se garantiza | Test | Tipo | Resultado |
|---|------------------|------|------|-----------|
| 1 | El registro persiste el teléfono y lo devuelve en el usuario de sesión | `test/auth.test.js` / `registration stores the phone number and returns it in the session user` | integration | PASS |
| 2 | El registro rechaza teléfonos sin suficientes dígitos | `test/auth.test.js` / `registration rejects a phone number without enough digits` | integration | PASS |
| 3 | La creación de producto guarda la imagen y la actualización la modifica | `test/products.test.js` / `admin product creation stores the image and updates it later` | integration | PASS |
| 4 | La creación de producto guarda la categoría | `test/products.test.js` / `admin product creation stores the category` | integration | PASS |
| 5 | Regresión: flujo completo de auth/checkout/tournaments intacto | `test/workflows.test.js`, `test/helpers.test.js` | integration/unit | PASS |

## Resultado final

- Comando de validación ejecutado: `npm test` dentro de `/public/league-tennis-web` → **9/9 tests PASS**.
- Cobertura: no definida en el proyecto (`npm run test:coverage` no configurado); se validó con la suite existente.
