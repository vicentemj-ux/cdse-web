# Auditoría del portal CDSE Solar — agosto de 2026

## Resultado ejecutivo

El portal actual es una base comercial funcional: capta el recibo, calcula, genera una propuesta y permite administrar catálogo y vendedores. No es todavía un sistema de operación solar completo. El flujo termina en `cotización aceptada`; desde ahí no existen proyecto, expediente, ingeniería, agenda, instalación, trámite de interconexión, puesta en marcha ni liquidación controlada de comisiones.

La brecha principal no es visual. Es de arquitectura de información y modelo de datos. Agregar más pestañas al componente actual agravaría la complejidad; la siguiente etapa debe introducir el concepto de **Proyecto Solar** como registro central y dividir el producto en módulos por responsabilidad.

Resumen de hallazgos:

- 3 críticos: continuidad operativa, trazabilidad documental y comisión calculada sobre una base incorrecta.
- 5 altos: permisos, agenda, controles de etapa, arquitectura del frontend y trazabilidad de instalación/CFE.
- 6 medios: navegación móvil, búsquedas globales, alertas, datos duplicados, privacidad y métricas.
- 4 bajos: consistencia de etiquetas, estados vacíos, ayudas contextuales y densidad visual.

## Veredicto de patrones de interfaz

La identidad visual es consistente con CDSE y evita la estética genérica de un CRM. La tipografía, el contraste, el uso del azul marino y la jerarquía editorial son fortalezas. El problema es funcional: `SolarPortal.jsx` concentra autenticación, resumen, cotizador, oportunidades, leads, catálogo y equipo en un solo archivo, y la navegación lateral refleja áreas de pantalla en lugar del ciclo real del proyecto.

No conviene “llenar” el dashboard de tarjetas. Conviene una composición operativa basada en:

- bandeja de trabajo priorizada;
- proyectos por etapa;
- agenda y vencimientos;
- expedientes con porcentaje de integridad;
- bloqueos claros que indiquen qué falta, quién es responsable y cuál es la siguiente acción.

## Hallazgos críticos

### C1. El ciclo termina cuando comienza la operación

**Ubicación:** `src/components/solar/portal/SolarPortal.jsx`, navegación y vistas `Overview`, `Quotes` y `SolarPortal`.

**Impacto:** una venta aceptada no crea un objeto operativo. El equipo tendría que coordinar instalación, documentación y CFE fuera del sistema, perdiendo trazabilidad, fechas y responsabilidad.

**Recomendación:** crear automáticamente un `solar_project` al aceptar una cotización. El proyecto debe conservar una fotografía inmutable del alcance vendido, precio, impuestos, vendedor, equipos y cliente.

### C2. No existe expediente verificable

**Ubicación:** esquema actual de Supabase; sólo existe almacenamiento del recibo y del PDF de cotización.

**Impacto:** no se puede saber si están listos el diagrama unifilar, fichas técnicas, certificado del inversor, identificación, autorización del representante, evidencia de instalación, solicitud, acuse, contrato ni cambio de medidor.

**Recomendación:** catálogo versionado de requisitos, documentos por proyecto, estados de revisión, vigencia, versiones, responsable y evidencia del evento. Debe separar `regulatorio`, `condicional` e `interno` para evitar afirmar que un documento interno es requisito universal de CFE.

### C3. La comisión se calcula sobre el total con IVA

**Ubicación:** `supabase/migrations/202607310001_solar_sales_portal.sql`, función `set_solar_quote_status`.

**Impacto:** al aceptar la cotización, la función calcula `total_mxn * commission_rate`. La política indicada por CDSE es sobre el presupuesto acordado antes de IVA. Además, no existen aprobación, devengo, pago, ajuste ni reverso.

**Recomendación:** usar un libro de comisiones independiente con base antes de IVA, porcentaje fotografiado, reglas de devengo configurables y bitácora. La cotización puede mostrar una estimación; sólo el registro de comisión debe representar la obligación real.

## Hallazgos altos

### A1. Permisos insuficientes para operación

Sólo existen `admin` y `seller`. Ingeniería, coordinación, instalador y finanzas necesitan acceso limitado por proyecto y función. Se recomienda membresía por proyecto antes de ampliar el enum global de perfiles.

### A2. No hay agenda ni compromisos

No existen visitas, fechas prometidas, vencimientos, instalación, inspección, seguimiento CFE o recordatorios. Las fechas deben ser entidades con responsable, zona horaria, estado y vínculo al proyecto; no campos sueltos en notas.

### A3. Los estados no tienen puertas de calidad

El estado puede cambiar sin demostrar que se completaron condiciones previas. Cada transición crítica debe validar un conjunto mínimo: contrato/aceptación, pago, visita, ingeniería, expediente, instalación y puesta en marcha.

### A4. Un componente concentra todo el producto

`SolarPortal.jsx` supera ampliamente la responsabilidad de una vista. Esto eleva el riesgo de regresión, dificulta pruebas y hace costosa la adaptación móvil. Debe dividirse por dominio: `sales`, `projects`, `documents`, `schedule`, `installations`, `commissions`, `admin`.

### A5. No hay trazabilidad de obra ni puesta en marcha

Faltan orden de trabajo, cuadrilla, materiales entregados, evidencia antes/durante/después, pruebas, incidencias, aceptación del cliente, monitoreo y garantías.

## Hallazgos medios

1. La navegación móvil horizontal pierde contexto al crecer; debe pasar a una barra compacta de áreas principales y menú “Más”.
2. Falta búsqueda global por cliente, teléfono, folio de cotización, proyecto, número de servicio o folio CFE.
3. El resumen cuenta oportunidades, pero no muestra trabajo vencido, expedientes bloqueados, instalaciones próximas ni cobros/comisiones pendientes.
4. Nombre, servicio y domicilio aparecen en recibo, lead y futura obra; se requiere una fuente canónica y snapshots sólo donde haya valor legal/comercial.
5. El aviso de privacidad se registra en el lead, pero los expedientes incorporarán identificaciones y documentos patrimoniales que necesitan clasificación, retención y acceso más estricto.
6. No hay métricas de conversión por etapa, tiempo a instalación, tiempo de interconexión, reprocesos, margen o productividad por vendedor/cuadrilla.

## Hallazgos bajos

1. Unificar “oportunidad”, “cotización” y “propuesta” en microcopy y ayudas.
2. Añadir estados vacíos orientados a la siguiente acción, no sólo ausencia de datos.
3. Mostrar por qué un proyecto está bloqueado y qué evidencia lo desbloquea.
4. Reducir densidad en formularios largos mediante pasos y resumen lateral persistente.

## Fortalezas que deben conservarse

- Identidad visual local, sobria y reconocible.
- Cotización reproducible mediante snapshots.
- Separación entre catálogo activo y cotizaciones históricas.
- Propiedad de leads/cotizaciones por vendedor.
- Registro de eventos de cotización.
- Procesamiento asistido del recibo con bloqueo cuando la lectura no es confiable.

## Arquitectura de experiencia recomendada

Navegación principal:

1. **Inicio** — mi trabajo, vencidos, citas, bloqueos y métricas accionables.
2. **Ventas** — leads, recibos, oportunidades y cotizaciones.
3. **Proyectos** — tablero por etapa y ficha 360°.
4. **Agenda** — visitas, instalaciones, vencimientos y seguimiento CFE.
5. **Operación** — órdenes de trabajo, cuadrillas, inventario comprometido e incidencias.
6. **Finanzas** — anticipos, saldos, comisiones y márgenes; acceso restringido.
7. **Administración** — catálogo, plantillas, requisitos, zonas, usuarios y reglas.

Ficha de proyecto:

- encabezado con etapa, salud, responsable y próxima acción;
- línea de tiempo;
- resumen vendido e ingeniería vigente;
- expediente y documentos;
- agenda/tareas;
- instalación y evidencia;
- CFE/interconexión;
- pagos y comisión;
- actividad/auditoría.

## Prioridad recomendada

La primera entrega no debe intentar construir todas las pantallas. Debe asegurar el modelo de proyecto, los estados, el expediente, las tareas y la comisión antes de IVA. Esa base permite que calendario, instalación y analítica se construyan sin volver a migrar el núcleo.
