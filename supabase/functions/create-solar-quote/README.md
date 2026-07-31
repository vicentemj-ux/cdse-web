# `create-solar-quote`

Edge Function pública para validar el formulario, guardar opcionalmente el recibo,
calcular con la configuración publicada y persistir toda la operación mediante
`create_solar_quote_record`.

## Secretos

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
PUBLIC_SITE_ORIGIN=https://cdse.com.mx
TURNSTILE_SECRET_KEY=opcional-pero-recomendado
```

## Requisitos previos

- migraciones `202607300001` y `202607300002`;
- bucket privado `solar-receipts`;
- una zona activa;
- un panel activo;
- exactamente una configuración con estado `published`;
- CORS limitado a `PUBLIC_SITE_ORIGIN`.

## Formato

Acepta JSON o `multipart/form-data`. Para multipart:

- `payload`: JSON serializado;
- `receipt`: PDF/JPG/PNG/WebP de hasta 10 MB.

El navegador nunca envía precios, horas sol o watts de panel. La función obtiene
esos valores de la configuración publicada para impedir manipulación.
