# Contexto del Proyecto CDSE

Documento breve para retomar el proyecto en futuras sesiones sin volver a inferir el contexto desde cero.

## Resumen

- Proyecto: sitio web de CDSE, Centro de Soluciones Electronicas.
- Negocio: reparacion y venta de computadoras, celulares y consolas/videojuegos.
- Ubicacion: Los Mochis, Sinaloa, Mexico.
- Objetivo principal: generar contactos y cotizaciones, con WhatsApp como CTA principal.

## Stack Actual

- Astro 5.5+
- Tailwind CSS 3.4+
- React 19 para islas interactivas
- Proyecto en `type: module`
- Scripts principales: `npm run dev`, `npm run build`, `npm run preview`

## Estructura

- `src/pages/`: rutas del sitio
- `src/components/`: componentes de Astro
- `src/layouts/`: layouts base
- `src/styles/`: estilos globales
- `public/`: activos estaticos

## Rutas Conocidas

- `/`: pagina principal
- `/solar`: landing SEO y cotizador preliminar de paneles solares
- `/privacidad`: aviso de privacidad
- `/ubicacion`: pagina de ubicacion

## Piezas Clave

- `BaseLayout.astro`: define metadata SEO, Open Graph, Twitter Card y footer/header globales.
- `Header.astro`: encabezado con busqueda, navegacion y menu movil.
- `Footer.astro`: enlaces, datos de contacto y credito de Taller Cloud.
- `Hero.astro`, `ServicesGrid.astro`, `TrustSignals.astro`, `ViralTechShowcase.astro`, `ProductShowcase.astro`: secciones de contenido de la home.

## Criterios de Diseno

- Enfoque corporativo y tecnologico.
- Paleta principal: azul electrico, teal, marino oscuro y grises claros.
- Tipografia base: Inter.
- Prioridad a rendimiento, SEO y experiencia mobile-first.

## Integraciones y Contenido

- El sitio usa un boton flotante de WhatsApp para conversion.
- El producto solar usa un cotizador React de tres pasos: inmueble/zona/panel, recibo o historial manual y datos de contacto.
- El motor compartido de calculo vive en `supabase/functions/_shared/calculator.mjs`; se prueba desde `tests/solar-calculator.test.mjs`.
- La interpretacion del texto extraido de recibos CFE vive en `supabase/functions/_shared/cfe-receipt-parser.mjs`. El caso real de referencia debe producir 2,819 kWh anuales desde el periodo vigente y los cinco bimestres anteriores.
- El backend previsto usa Supabase (Edge Function, base de datos y bucket privado). Mientras `PUBLIC_SOLAR_QUOTE_ENDPOINT` no este configurado, `/solar` funciona como vista previa local y no afirma guardar el lead.
- Las potencias iniciales evaluadas son 550 W, 590 W y 630 W. Los precios son internos y admiten configuracion por panel instalado o por watt.
- El catalogo de productos esta pensado para conectarse a `tallercloud.net`.
- Parte del contenido usa datos de demostracion o placeholders hasta integrar fuentes reales.

## Notas Para Futuras Sesiones

- Revisar siempre que los cambios mantengan el enfoque SEO-first.
- Evitar introducir JavaScript innecesario en paginas que pueden ser estaticas.
- Mantener consistencia con el lenguaje visual actual del sitio.
- La fase 2 del producto solar parte del analisis en `docs/ANALISIS_COTIZACIONES_SOLARES_COMPETENCIA.md`: estructura familiar tipo historial CFE, jerarquia ejecutiva, calculos trazables y validaciones que bloqueen cifras incompatibles.
- Si se agregan nuevas rutas o componentes, actualizar este archivo para conservar el contexto.
