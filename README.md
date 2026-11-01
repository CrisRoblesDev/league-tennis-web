# League Tennis Web

Aplicación estática con Cloudflare Pages Functions. Incluye registro e inicio de sesión, perfiles y ranking, torneos mensuales, desafíos, validación de marcadores, administración y pagos/suscripciones con Stripe Checkout.

## Desarrollo local

1. Instala Node.js 20 o posterior.
2. Instala dependencias con `npm install`.
3. Copia `.dev.vars.example` a `.dev.vars` y configura allí los valores reales. No publiques `.dev.vars`.
4. Inicia con `npm run dev` y abre la URL que informa Wrangler.

Cloudflare Pages Functions lee `.dev.vars` durante el desarrollo local; no carga automáticamente `.env`. El `.env.example` solo documenta los nombres de variables. Las claves de Stripe y GitHub no se incluyen en el código del navegador.

## Variables requeridas

| Variable | Uso | Dónde configurarla |
| --- | --- | --- |
| `GITHUB_TOKEN` | Lectura y escritura del repositorio de datos | Secreto |
| `GITHUB_OWNER` | Propietario del repositorio de datos | Variable |
| `GITHUB_REPO` | Repositorio privado para los datos JSON | Variable |
| `GITHUB_BRANCH` | Rama de datos (por defecto `main`) | Variable |
| `SESSION_SECRET` | Firma de cookies de sesión; usar al menos 32 caracteres aleatorios | Secreto |
| `ADMIN_EMAIL` | Email que recibe rol de administración al registrarse | Variable |
| `STRIPE_SECRET_KEY` | Stripe Checkout (usar `sk_test_...` para pruebas) | Secreto |
| `STRIPE_WEBHOOK_SECRET` | Verificación de webhooks de Stripe | Secreto |

El token de GitHub debe tener permisos de lectura y escritura de contenido únicamente en `CrisRoblesDev/league-tennis-web`. Ese repositorio debe permitir crear/actualizar archivos dentro de `data/`; los archivos JSON se inicializan cuando se usan por primera vez, y el catálogo tiene productos de demostración si `data/products.json` todavía no existe. Cada escritura genera un commit en la rama `master`; para evitar que los cambios de datos disparen despliegues, configura el filtro de rutas de Cloudflare Pages para ignorar `data/**` o migra los datos a D1.

Para crear el primer administrador, configura `ADMIN_EMAIL` antes de registrar esa dirección. No se asigna automáticamente el rol de administrador al primer visitante.

## Cloudflare Pages

1. Crea/selecciona el proyecto en **Workers & Pages → Pages → Connect to Git** (no lo crees como Worker de activos estáticos). Configura `master` como rama de producción, deja vacío el comando de compilación y usa `public` como directorio de salida. Cloudflare Pages publica las funciones de `functions/`.
2. En **Settings → Variables and Secrets**, configura las variables requeridas para los entornos Preview y Production. Marca como secretos `GITHUB_TOKEN`, `SESSION_SECRET`, `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`.
3. En producción, crea un webhook de Stripe dirigido a `https://TU-DOMINIO/api/stripe/webhook` y habilita `checkout.session.completed`, `checkout.session.async_payment_succeeded` y `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Despliega desde la integración de Cloudflare Pages o con `npm run deploy`. No uses `wrangler deploy` ni crees un Worker con Static Assets: ese producto solo sirve archivos estáticos y no habilita los ajustes de runtime usados por Pages Functions.

No pegues claves secretas en el chat ni en archivos versionados. Las claves de prueba solo permiten pagos en modo test; los pagos reales requieren credenciales `live` y un webhook de producción.

## Flujos disponibles

- Registro con email y contraseña; contraseñas nuevas usan PBKDF2-HMAC-SHA-256 con 100.000 iteraciones, el máximo admitido por el runtime de Cloudflare Workers. Las cuentas con hashes anteriores compatibles se actualizan al iniciar sesión.
- Sesiones firmadas, con caducidad y cookie HttpOnly.
- Compra de productos y suscripciones mediante Stripe Checkout; el servidor verifica la sesión de Stripe y el webhook mantiene los estados de suscripción.
- El panel de administración muestra métricas, usuarios, pedidos y catálogo. Solo administradores pueden modificar productos o usuarios.
- Inscripción mensual, publicación/aceptación de desafíos y registro/confirmación de resultados. El ranking suma puntos después de que el rival confirma el marcador.

Los datos se guardan en archivos JSON del repositorio GitHub configurado. Esta persistencia es adecuada para pruebas y tráfico bajo; para concurrencia o uso comercial sostenido, migra los datos a Cloudflare D1 antes de operar pagos en producción.
