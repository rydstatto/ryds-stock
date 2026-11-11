# Ryds Stock

Panel adaptable de demostración para inventario y ventas, construido con Cloudflare Pages Functions y D1.

## Funcionalidades

- Inicio de sesión con dos roles: administrador y vendedor.
- Catálogo de productos con búsqueda, filtros, edición y alertas de stock bajo.
- Registro de ventas con validación de existencias y descuento automático de inventario.
- Historial de movimientos de stock.
- Resumen de ventas, inventario y productos más vendidos.
- Informes filtrados por fecha, con utilidad bruta estimada y exportación CSV.
- Interfaz adaptable a escritorio y móvil.

El vendedor puede consultar información y registrar ventas. Solo el administrador puede crear o editar productos y ajustar existencias. Los permisos se validan en la API, además de ocultar las acciones restringidas en la interfaz.

## Configuración local

1. Instala las dependencias con `npm install`.
2. Crea un archivo `.dev.vars` en la raíz y configura las credenciales:

   ```dotenv
   ADMIN_PASSWORD=define-una-clave-local
   STAFF_USERNAME=vendedor
   STAFF_PASSWORD=define-otra-clave-local
   ```

   `ADMIN_USERNAME` ya está definido en `wrangler.toml`. Para desactivar la cuenta de vendedor, omite ambas variables `STAFF_*`. No compartas ni subas `.dev.vars` al repositorio.
3. Aplica la migración local y ejecuta el sitio:

   ```powershell
   npx wrangler d1 migrations apply agenda-facil-demo --local
   npx wrangler pages dev
   ```

Las credenciales de producción deben configurarse como variables y secretos del entorno de Cloudflare Pages; no guardes contraseñas en `wrangler.toml`.

## Pruebas

Ejecuta `npm test` para las pruebas de validación, permisos y operaciones del catálogo.

> Aplicación de demostración con datos ficticios. No la uses para transacciones ni información real.
