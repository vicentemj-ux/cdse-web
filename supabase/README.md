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
