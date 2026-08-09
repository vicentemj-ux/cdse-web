# CDSE Solar — seguimiento de interconexión CFE

Fecha de corte: 8 de agosto de 2026.

## Propósito

El módulo **Seguimiento CFE** separa el avance real del trámite del estado general del proyecto. Un folio no implica autorización, contrato, cambio de medidor ni interconexión. El caso conserva:

- proyecto, oficina/canal, folio y fecha de ingreso;
- etapa del trámite y parte de la que se espera una acción;
- último contacto y próximo seguimiento;
- referencia interna configurable de 13 o 18 días;
- observaciones y respuestas por ciclo;
- contratos de interconexión y contraprestación;
- serie anterior, serie bidireccional, cita y fecha de cambio;
- fecha de interconexión efectiva y notas.

## Puertas y automatizaciones

- No se puede avanzar de preparación sin folio y fecha de ingreso.
- Una observación crea un ciclo numerado, marca el proyecto en riesgo y asigna la espera a CDSE.
- Al registrar respuesta, la espera cambia a CFE y el evento queda en la bitácora del proyecto.
- “Medidor instalado” exige serie bidireccional y fecha de cambio.
- “Interconectado” exige además fecha efectiva.
- El cierre actualiza el proyecto a `operational`; no elimina pendientes documentales ni evidencia histórica.

El sistema añade al expediente tres requisitos: respuesta/oficio, contrato de interconexión y contrato de contraprestación. Se muestran junto con solicitud, acuse y evidencia de medidor.

## Interpretación de tiempos

El Manual de 2016 señala 13 días cuando no se requiere estudio y 18 cuando se requiere; su tabla los identifica como días hábiles y excluye obra específica y tiempos atribuibles al solicitante. Por eso la aplicación:

- muestra los días transcurridos como días calendario observados;
- guarda 13/18 únicamente como referencia configurable;
- permite una fecha objetivo interna capturada por administración;
- mide por separado cuánto tiempo lleva la espera actual y a quién es atribuible;
- nunca convierte la referencia en promesa comercial automática.

## Precaución de transición normativa

La página vigente de la CNE todavía lista el Manual para centrales menores a 0.5 MW, mientras sus preguntas frecuentes de 2025 describen el nuevo marco para centrales menores a 0.7 MW. CDSE debe validar los formatos y el procedimiento efectivamente recibido en la oficina/canal aplicable antes de cada ingreso. El software conserva términos configurables y no decide por sí solo qué régimen aplica.

## Fuentes oficiales

- [CNE — Generación Distribuida y publicaciones vigentes](https://www.gob.mx/cne/acciones-y-programas/generacion-distribuida-399371).
- [CNE — Preguntas frecuentes sobre Generación Distribuida](https://www.gob.mx/cne/articulos/preguntas-frecuentes-sobre-generacion-distribuida-406238).
- [CENACE/DOF — Manual de Interconexión de Centrales de Generación con Capacidad menor a 0.5 MW](https://www.cenace.gob.mx/Docs/ConexionInterconexion/Manual%20del%20Interconexi%C3%B3n%20de%20Centrales%20con%20Cap%20menor%20a%200.5%20MW%20%28DOF%20SENER%2015-Dic-16%29.pdf).
- [CFE Distribución — plataforma de solicitudes de Generación Distribuida](https://app.cfe.mx/Aplicaciones/GeneracionDistribuida/Solicitud/SolicitudInterconexion).

Este módulo organiza evidencia y trabajo interno; no sustituye la confirmación de requisitos, formatos o criterios por la oficina receptora ni constituye asesoría jurídica o regulatoria.
