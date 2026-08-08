# CDSE Solar — modelo operativo y roadmap México

Fecha de corte: 8 de agosto de 2026.

## Estado de implementación

- **Fase 1 — núcleo de proyecto:** implementada y desplegada. Una cotización aceptada crea proyecto, expediente, tareas y comisión calculada antes de IVA.
- **Fase 2 — expediente e ingeniería:** implementada y desplegada. Incluye almacenamiento privado, carga múltiple, versiones, revisión administrativa, requisitos condicionales, levantamiento estructurado, ingeniería formal, recursos PDF y exportación integral.
- **Puerta técnica desplegada:** el sistema exige visita aprobada, ingeniería aprobada y documentos base completos antes de permitir el estado `ready_for_submission`; para `submitted_to_cfe` exige además folio de seguimiento.
- **Recursos desplegados:** reporte de levantamiento, carta de autorización condicional, índice documental y ZIP privado con archivos, versiones, manifiesto y huellas SHA-256. La generación y las aperturas quedan auditadas.
- **Módulo financiero base desplegado:** calendario automático de cobros, captura y conciliación de pagos, comisión sobre base antes de IVA, dos hitos de devengo, autorización y liquidación con bitácora. Se adelantó este núcleo de la Fase 5 por prioridad comercial.
- **Siguiente hito:** Fase 3 — agenda de capacidad, órdenes de trabajo, cuadrillas, instalación móvil y acta de entrega. Las fases 4 a 6 continúan según el orden definido en este documento; en Fase 5 aún faltan reversos, margen real, exportación contable y reportes por periodo.

## 1. Objetivo

Convertir el cotizador actual en el sistema de trabajo de CDSE para administrar de punta a punta:

`lead → diagnóstico → propuesta → venta → ingeniería → expediente → instalación → interconexión/medidor → puesta en marcha → garantía`

La cotización aceptada deja de ser el final. Se convierte automáticamente en un **Proyecto Solar**, con alcance vendido congelado, responsables, documentos, agenda, evidencias, pagos y comisión.

## 2. Decisiones regulatorias de diseño

### 2.1 Expediente oficial, condicional e interno

El expediente debe indicar el origen de cada requisito:

- **Regulatorio:** aparece en disposiciones, manual, formato o solicitud aplicable.
- **Condicional:** se solicita sólo por representación, tipo de usuario, nivel de tensión, estudio, obra o condición particular.
- **Interno CDSE:** protege la calidad, seguridad o administración, pero no debe presentarse como exigencia universal de CFE.

Esto es importante para la carta poder. El manual de interconexión no la enumera como requisito universal; una autorización o documento de representación puede ser necesario cuando CDSE actúe por el solicitante. Se manejará como requisito condicional y configurable por oficina/procedimiento.

### 2.2 Alerta de transición normativa

La Comisión Nacional de Energía describe en 2025 la Generación Distribuida como centrales menores a **0.7 MW**, conforme al nuevo marco del sector. Al mismo tiempo, su página de publicaciones vigentes conserva el Manual de Interconexión de centrales menores a **0.5 MW** y los instrumentos de 2017. El sistema no debe codificar el umbral como una verdad permanente: debe guardarlo en configuración versionada y mostrar una alerta de revisión normativa.

Para los proyectos residenciales y comerciales pequeños de CDSE, el flujo documental básico sigue siendo aplicable; antes de automatizar una presentación real debe validarse el procedimiento vigente en la zona de CFE Sinaloa y el formato que esté recibiendo la oficina correspondiente.

### 2.3 Núcleo documental oficial

El manual y las preguntas frecuentes oficiales identifican este núcleo para la solicitud:

- solicitud de interconexión y anexos;
- croquis de ubicación;
- diagrama unifilar;
- ficha técnica de la tecnología de generación/panel;
- ficha técnica y certificado del inversor;
- cuando aplique, último recibo sin adeudos del centro de carga.

La instalación física requiere medición bidireccional para registrar energía recibida e inyectada. El proyecto debe guardar solicitud, acuse/folio, respuesta, contrato aplicable y evidencia del medidor, no sólo un estado escrito manualmente.

### 2.4 Plazos como SLA de referencia, no promesa comercial

El Manual publicado en 2016 señala 13 días de atención sin estudio y 18 con estudio, excluyendo obra específica y tiempos atribuibles al solicitante. Estos valores se cargarán como referencias configurables. La agenda debe distinguir:

- plazo regulatorio de referencia;
- compromiso interno CDSE;
- fecha prometida al cliente;
- tiempo en espera de cliente/CFE/tercero.

No se mostrará al cliente una fecha garantizada calculada sólo a partir de esos números.

### 2.5 Privacidad y documentos sensibles

El expediente puede incluir recibos, identificaciones, domicilio, firma y documentos de propiedad. La ley vigente exige aviso de privacidad, finalidad, medios ARCO, controles de seguridad y supresión cuando los datos dejan de ser necesarios conforme a finalidades/plazos aplicables. Por ello:

- los buckets serán privados;
- el acceso será por proyecto y rol;
- toda descarga/aprobación/rechazo quedará auditada;
- los tipos documentales tendrán clasificación y política de retención;
- los enlaces compartidos serán temporales;
- no se enviarán identificaciones como adjuntos públicos de WhatsApp.

### 2.6 Mensaje fiscal responsable

El artículo 34, fracción XIII, de la LISR permite 100% para maquinaria y equipo de generación renovable, condicionado —entre otros puntos— a que opere por al menos cinco años. En materiales comerciales debe decir “puede ser aplicable; consulte a su asesor fiscal”, nunca prometer una devolución ni afirmar que todo cliente puede deducirlo.

## 3. Modelo operativo objetivo

### 3.1 Etapas y puertas de control

| Etapa | Resultado exigido | Puerta para avanzar |
|---|---|---|
| Lead | contacto identificado y consentimiento | datos de contacto válidos |
| Diagnóstico | consumo confiable y sitio preliminar | recibo validado o captura manual completa |
| Propuesta | alcance, precio, vigencia y supuestos | revisión comercial/técnica según riesgo |
| Venta | aceptación, condiciones y anticipo | evidencia de aceptación y regla financiera cumplida |
| Visita | levantamiento técnico | techo, tablero, acometida, ruta, sombras y fotos |
| Ingeniería | diseño ejecutable | unifilar, arreglo, protecciones, capacidad y equipos aprobados |
| Expediente | paquete listo para trámite | documentos regulatorios/condicionales completos |
| Trámite CFE | solicitud registrada | acuse/folio y fecha de ingreso |
| Instalación | sistema instalado y probado | checklist de calidad/seguridad y evidencias |
| Interconexión | contrato/medición atendidos | documentos y medidor bidireccional verificados |
| Puesta en marcha | cliente recibe sistema | pruebas, monitoreo, manuales, garantías y acta |
| Postventa | sistema acompañado | garantías/incidencias y seguimiento de generación |

No todas las etapas tienen que ser estrictamente lineales: ingeniería, expediente e instalación pueden solaparse si la política del proyecto lo permite, pero el sistema debe registrar la excepción y quién la autorizó.

### 3.2 Estados del proyecto

Estados principales propuestos:

- `sold_pending_validation`
- `site_survey_scheduled`
- `engineering`
- `documents_pending`
- `ready_for_submission`
- `submitted_to_cfe`
- `cfe_observation`
- `approved_for_installation`
- `installation_scheduled`
- `installation_in_progress`
- `installed_pending_interconnection`
- `meter_change_pending`
- `commissioning`
- `operational`
- `on_hold`
- `cancelled`

Además del estado, cada proyecto tendrá una **salud** calculada: `en tiempo`, `en riesgo`, `bloqueado`, `vencido`. El bloqueo debe indicar requisito, responsable y acción.

## 4. Expedientes por proyecto

### 4.1 Comercial y cliente

- cotización y versión aceptada;
- aceptación/contrato CDSE;
- recibo CFE validado;
- datos fiscales, sólo si se requieren para facturación;
- identificación del titular: condicional según trámite/política;
- autorización/carta poder y documentación del representante: condicional;
- autorización del propietario o documento de posesión: condicional;
- comprobantes de anticipo y pagos.

### 4.2 Levantamiento e ingeniería

- formulario de visita;
- fotografías de techo, tablero, acometida, medidor y ruta;
- medidas/área disponible y obstáculos;
- arreglo de módulos;
- diagrama unifilar controlado por versión;
- memoria/lista de protecciones;
- fichas técnicas de módulo, inversor, estructura y protecciones;
- certificado del inversor;
- revisión y aprobación de ingeniería.

### 4.3 Interconexión CFE

- solicitud y anexos vigentes;
- croquis/ubicación;
- diagrama unifilar aprobado;
- fichas y certificado de inversor;
- recibo sin adeudo, cuando aplique;
- autorización de representación, cuando aplique;
- acuse y folio;
- oficio resolutivo/observaciones y respuesta;
- contrato aplicable;
- evidencia de instalación/cambio de medidor bidireccional;
- evidencia de energización/interconexión.

### 4.4 Instalación y entrega

- orden de trabajo y cuadrilla;
- lista de materiales comprometidos/consumidos;
- evaluación de riesgos y seguridad;
- fotografías antes/durante/después;
- torque, polaridad, aislamiento, puesta a tierra y pruebas definidas por ingeniería;
- números de serie de paneles/inversores, cuando proceda;
- configuración de monitoreo;
- incidencias y retrabajos;
- acta de entrega/aceptación;
- garantías, manuales y contacto de soporte.

## 5. Agenda y ejecución

Cada cita o tarea tendrá proyecto, tipo, responsable, participantes, inicio, vencimiento, ubicación, estado, recordatorios y evidencia de cierre.

Tipos iniciales:

- llamada/seguimiento comercial;
- visita técnica;
- entrega pendiente del cliente;
- revisión de ingeniería;
- ingreso/seguimiento CFE;
- instalación;
- inspección/pruebas;
- cambio de medidor;
- puesta en marcha;
- cobro;
- garantía/mantenimiento.

Vistas necesarias:

- **Mi día:** agenda y tareas personales priorizadas.
- **Semana operativa:** capacidad de cuadrillas y conflictos.
- **Vencimientos:** compromisos internos, regulatorios de referencia y espera externa.
- **Mapa/zona:** visitas e instalaciones cercanas para reducir traslados.

## 6. Comisiones

### 6.1 Política base CDSE

- porcentaje configurable por vendedor o por proyecto;
- rango operativo esperado: 5% a 10%; permitir 0% mientras falte configuración, pero bloquear aprobación;
- base: presupuesto acordado **antes de IVA**;
- snapshot al aceptar la venta;
- el administrador puede ajustar sólo con motivo y bitácora;
- separar `estimada`, `devengada`, `aprobada`, `pagada`, `anulada`.

### 6.2 Regla de devengo recomendada

No confundir “venta aceptada” con “comisión pagable”. Configuración inicial recomendada:

- 50% de la comisión devengada cuando el anticipo esté conciliado y venza el derecho de cancelación definido por contrato;
- 50% al terminar instalación y firmar entrega;
- pago sólo después de aprobación administrativa;
- devolución/reverso proporcional por cancelación, descuento posterior, reembolso o saldo incobrable.

Esta regla es propuesta de control interno y debe aprobarla CDSE con su contador/asesor laboral. Si los vendedores son trabajadores, las comisiones forman parte de su remuneración y la política debe reflejarse en contrato/nómina; no se debe improvisar sólo desde el software.

### 6.3 Datos del libro de comisión

- vendedor y proyecto;
- versión de política;
- total acordado, IVA y base antes de IVA;
- porcentaje y monto;
- hitos de devengo;
- ajustes con motivo/autor;
- aprobación;
- fecha, método y referencia de pago;
- eventos de reverso;
- documento o corrida de nómina vinculada.

## 7. Roles y permisos

| Rol | Alcance principal |
|---|---|
| Administrador | configuración, usuarios, precios, aprobaciones y auditoría |
| Vendedor | sus leads/cotizaciones/proyectos, agenda y documentos solicitados |
| Operaciones | asignación, expediente, agenda y coordinación |
| Ingeniería | levantamiento, diseño, versiones y aprobación técnica |
| Instalador/cuadrilla | orden de trabajo, checklist, materiales y evidencia móvil |
| Finanzas | cobros, facturación, comisiones y márgenes |
| Consulta | lectura acotada para dirección/auditoría |

Principios:

- acceso mínimo necesario;
- pertenencia explícita por proyecto;
- datos financieros restringidos;
- cambios críticos con actor, fecha, valor anterior/nuevo y motivo;
- la aprobación debe hacerla preferentemente un segundo administrador; mientras exista un único administrador que también vende, una autorización propia exige justificación excepcional y queda auditada;
- quien ejecuta una revisión técnica no modifica la evidencia original.

## 8. Modelo de datos

Núcleo nuevo:

- `solar_projects`: proyecto y snapshot contractual/técnico.
- `solar_project_members`: usuarios y función dentro del proyecto.
- `solar_document_requirements`: catálogo versionable y alcance del requisito.
- `solar_project_documents`: archivos, versiones, revisión y vigencia.
- `solar_project_checklist_items`: puertas y evidencia requerida.
- `solar_project_tasks`: agenda, responsables, vencimientos y cierre.
- `solar_project_events`: bitácora inmutable.
- `solar_site_surveys`: levantamientos versionados de techo, sombras, acometida, tablero, ruta y seguridad.
- `solar_engineering_revisions`: diseños versionados con equipos, strings, protecciones, conductores, tierra física, unifilar vinculado y relación DC/AC máxima de 120%.
- `solar_commissions`: obligación y estado financiero.
- `solar_payment_schedules`: calendario acordado de enganche, liquidación o pago total.
- `solar_payments`: evidencia y conciliación de cobros del cliente.
- `solar_commission_milestones`: devengo por anticipo y entrega.
- `solar_commission_events`: bitácora inmutable de términos, devengo, autorización y pago.

Extensiones posteriores:

- `solar_site_surveys` y evidencias;
- `solar_design_revisions`;
- `solar_work_orders`, `solar_crews`, `solar_work_order_members`;
- `solar_inventory_reservations` y consumo;
- `solar_warranties`, `solar_assets` y números de serie;
- `solar_service_cases` y generación monitoreada.

## 9. Roadmap ordenado

### Fase 0 — validación operativa y normativa

**Objetivo:** confirmar con CDSE y oficina local qué se usa realmente antes de automatizar formularios.

- entrevistar vendedor, instalador, administración y contador;
- obtener un expediente real anonimizado completado;
- validar formatos y pasos actuales de CFE en Los Mochis;
- aprobar matriz de roles, etapas, comisión y documentos;
- redactar aviso de privacidad y retención con asesor.

**Salida:** manual operativo v1 y catálogo de requisitos aprobado.

### Fase 1 — núcleo de proyecto

**Objetivo:** que toda venta aceptada genere trabajo trazable.

- proyecto automático desde cotización aceptada;
- ficha 360°, miembros, línea de tiempo y próxima acción;
- checklist/documentos/tareas base;
- búsqueda global;
- comisión fotografiada sobre base antes de IVA;
- RLS por proyecto.

**Criterio de éxito:** ninguna venta aceptada queda fuera del tablero de proyectos.

### Fase 2 — expediente e ingeniería

- buckets privados y subida multiarhivo móvil;
- plantillas, versiones, aprobación/rechazo y vigencia;
- visita técnica estructurada;
- unifilar y diseño versionados;
- integridad del expediente y bloqueos;
- exportación de carpeta ZIP/PDF índice para trámite.

**Criterio de éxito:** un administrador puede demostrar qué falta para ingresar cada expediente.

### Fase 3 — agenda, instalación y móvil

- agenda personal/equipo;
- órdenes de trabajo y cuadrillas;
- capacidad/conflictos;
- checklists offline tolerantes a mala señal;
- evidencia fotográfica comprimida y reanudable;
- incidencias, materiales y acta de entrega.

**Criterio de éxito:** la cuadrilla completa una instalación sin regresar al papel o WhatsApp como sistema de registro.

### Fase 4 — seguimiento CFE

- ingreso, folio, acuses, observaciones y respuesta;
- SLA de referencia configurable y tiempo en espera;
- contrato/medidor/interconexión;
- alertas de formato/norma por vigencia;
- tablero de expedientes por estado.

**Criterio de éxito:** cada proyecto explica con evidencia dónde está su trámite y desde cuándo.

### Fase 5 — finanzas y comisiones

- [implementado] anticipos, hitos, saldo y conciliación;
- [implementado] aprobación y pago de comisiones;
- [pendiente] reversos proporcionales y reembolsos;
- margen presupuestado vs real;
- reportes por vendedor/proyecto/periodo;
- exportación contable, sin convertir el portal en sistema fiscal.

**Criterio de éxito:** toda comisión pagada puede reconstruirse desde contrato, base antes de IVA, porcentaje, hitos y aprobación.

### Fase 6 — postventa y optimización

- activos y garantías;
- tickets y mantenimientos;
- monitoreo de generación;
- comparación prometido/real;
- NPS/referidos;
- analítica de conversión, ciclo, retrasos y rentabilidad.

## 10. Métricas de dirección

- conversión por fuente, vendedor y zona;
- tiempo de lead a propuesta y propuesta a venta;
- ventas sin anticipo/visita/expediente;
- porcentaje de expedientes completos al primer intento;
- días propios vs días en espera externa;
- instalaciones a tiempo y retrabajos;
- tiempo a medidor/interconexión;
- margen estimado vs real;
- comisión estimada, devengada, aprobada y pagada;
- generación real vs propuesta y casos de garantía.

## 11. Fuentes oficiales de referencia

- Comisión Nacional de Energía, **Generación Distribuida** y publicaciones vigentes: https://www.gob.mx/cne/articulos/generacion-distribuida-399260
- Comisión Nacional de Energía, **Preguntas frecuentes sobre Generación Distribuida**: https://www.gob.mx/cne/articulos/preguntas-frecuentes-sobre-generacion-distribuida-406238
- DOF, **Manual de Interconexión de Centrales de Generación con Capacidad menor a 0.5 MW**: https://dof.gob.mx/nota_detalle_popup.php?codigo=5465576
- DOF, **RES/142/2017 e instrumentos de Generación Distribuida**: https://dof.gob.mx/nota_detalle_popup.php?codigo=5474790
- Cámara de Diputados, **LFPDPPP vigente**: https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf
- SAT, **LISR, artículo 34**: https://wwwmat.sat.gob.mx/articulo/61054/articulo-34

Este documento es una especificación de producto y operación, no un dictamen jurídico, fiscal ni eléctrico. Los formatos, umbrales y requisitos deben revisarse antes de cada publicación de plantillas o automatización de trámite.
