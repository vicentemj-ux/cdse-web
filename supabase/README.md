# Supabase — CDSE Solar

La migración inicial crea el núcleo de leads, recibos, consumos, catálogos,
configuración versionada, cotizaciones y seguimiento.

## Antes de aplicarla

1. Crear o seleccionar el proyecto Supabase de producción.
2. Vincular el CLI local con `supabase link`.
3. Revisar los datos comerciales pendientes en
   `docs/COTIZADOR_SOLAR_FASE_1.md`.
4. Ejecutar la migración primero en un proyecto de desarrollo.
5. Crear el primer usuario mediante Supabase Auth.
6. Insertar manualmente su UUID en `public.solar_admins`.

## Seguridad

Las tablas de leads, recibos y cotizaciones no aceptan acceso anónimo directo.
El alta pública debe pasar por una Edge Function que:

- valide y normalice campos;
- limite tamaño y tipo del recibo;
- aplique rate limiting y protección anti-spam;
- inserte lead, recibo, periodos y cotización en una transacción;
- nunca entregue rutas privadas de Storage sin URL firmada y caducidad.

La clave `service_role` sólo pertenece en secretos de servidor.

## Pendiente para la integración

- Edge Function `create-solar-quote`;
- bucket privado `solar-receipts`;
- bucket privado `solar-quotes`;
- políticas de Storage;
- semilla de zonas, equipos y configuración aprobada;
- generación de PDF;
- notificación al equipo de ventas.

## Portal privado de ventas

La migración `202607310001_solar_sales_portal.sql` agrega:

- perfiles con roles `admin` y `seller`;
- propiedad del lead, recibo y cotización por vendedor;
- comisión individual congelada en cada folio;
- precios instalados por panel, promociones y paquetes;
- almacenamiento privado de recibos;
- cálculo y persistencia atómica desde `seller_create_solar_quote`;
- actualización auditada de estados con `set_solar_quote_status`.

El portal vive en `/solar/app`. Para activarlo se requieren
`PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` en Vercel.

Después de enlazar el proyecto:

```bash
supabase db push
supabase functions deploy create-solar-quote
supabase functions deploy manage-solar-seller
```

La primera cuenta de Auth se convierte una sola vez en administrador mediante
el botón de inicialización del portal. Los vendedores posteriores se crean
desde la sección **Vendedores**.
