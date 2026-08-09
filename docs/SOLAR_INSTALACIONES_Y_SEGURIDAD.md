# CDSE Solar — operación de instalaciones y seguridad

Fecha de corte: 8 de agosto de 2026.

## Alcance

El módulo convierte un proyecto aprobado en una orden de trabajo trazable. Ayuda a programar capacidad, ejecutar controles de campo, reunir evidencia y documentar la entrega. No certifica por sí solo el cumplimiento legal, la competencia del personal ni la seguridad de una obra; la evaluación del sitio, los procedimientos, la supervisión y las autorizaciones siguen siendo responsabilidad de CDSE y de profesionales competentes.

## Flujo operativo

1. **Proyecto listo:** sólo un proyecto en `approved_for_installation` o `installation_scheduled` puede reservar cuadrilla.
2. **Programación:** el administrador elige cuadrilla, inicio, fin, paneles, domicilio, contacto y alcance. El servidor rechaza traslapes de la misma cuadrilla.
3. **Puerta técnica:** una orden no inicia sin una revisión de ingeniería aprobada.
4. **Puerta de seguridad:** todos los controles de preparación y seguridad deben estar completos antes de cambiar a `in_progress`.
5. **Ejecución móvil:** la cuadrilla confirma montaje, circuitos DC/AC, puesta a tierra, pruebas y entrega. Un bloqueo exige nota.
6. **Evidencia:** fotografías o PDF se guardan en el bucket privado del expediente. Se admiten varios archivos de hasta 15 MB cada uno.
7. **Incidencias:** una incidencia alta o crítica pausa automáticamente la orden y marca el proyecto como bloqueado. Debe resolverse con una nota auditable.
8. **Cierre:** el servidor exige checklist completo, evidencia de instalación y cero incidencias altas/críticas abiertas. Al terminar, el proyecto avanza a `installed_pending_interconnection`.
9. **Entrega:** se genera un acta PDF de dos páginas con cliente, orden, sistema, revisión de ingeniería, resumen de controles, firmas y observaciones. El acta firmada debe volver al expediente.

## Capacidad y personal

- La capacidad semanal visible se estima como capacidad diaria declarada por cuadrilla multiplicada por seis días. Es una referencia de programación, no una garantía de productividad.
- El padrón registra oficio, teléfono, autorización para trabajo en altura, aptitud médica y última verificación de EPP.
- Una vigencia faltante o vencida se muestra como advertencia. La interfaz no sustituye la revisión documental ni autoriza a una persona a ejecutar trabajo especializado.
- La base impide que una misma cuadrilla ocupe dos órdenes cuyos horarios se crucen.

## Trabajo con señal débil

Los cambios de checklist y las incidencias pueden quedar en una cola local del teléfono y se sincronizan cuando regresa la conexión. La pantalla distingue “en línea”, “sin señal” y número de cambios pendientes.

Límites deliberados:

- la cola pertenece a ese navegador y dispositivo;
- no debe borrarse el almacenamiento del navegador antes de sincronizar;
- las fotografías requieren conexión y permanecen pendientes hasta poder cargarse;
- no es todavía una PWA de operación totalmente desconectada ni garantiza carga reanudable en segundo plano.

## Controles incluidos

El checklist inicial contiene 23 controles agrupados en:

- preparación del sitio, acceso, alcance y materiales;
- análisis de riesgo, EPP, protección contra caídas y clima;
- trazado, anclajes, sellado, estructura y módulos;
- polaridad, conectores, canalización y protecciones DC;
- inversor, canalización y protecciones AC, puesta a tierra;
- inspección visual, pruebas eléctricas, arranque y monitoreo;
- limpieza, explicación al cliente, evidencia y cierre.

Los textos son ayudas operativas configuradas por CDSE. El procedimiento técnico definitivo debe provenir de la ingeniería aprobada, las instrucciones de los fabricantes y la evaluación de riesgos del sitio.

## Referencias oficiales usadas para el diseño

- [NOM-009-STPS-2011, condiciones de seguridad para trabajos en altura](https://www.dof.gob.mx/normasOficiales/4377/stps/stps.htm): base para la autorización/capacitación, sistemas de protección, suspensión ante condiciones inseguras y plan de emergencia.
- [NOM-017-STPS-2024, equipo de protección personal](https://www.dof.gob.mx/website/normasOficiales/9496/stps/stps.html): base para seleccionar, usar y administrar EPP según el riesgo.
- [NOM-031-STPS-2011, seguridad y salud en obras de construcción](https://dof.gob.mx/normasOficiales/4376/stps/stps.htm): referencia para análisis, procedimientos y controles documentados en obra.
- [Manual de Medición para Liquidaciones del CENACE](https://www.cenace.gob.mx/Docs/14_REGLAS/Manuales/Manual%20de%20Medici%C3%B3n%20para%20Liquidaciones%20%5BDOF%2010-01-18%5D.pdf): referencia para conservar la verificación de medición bidireccional dentro del proceso de interconexión.

Este documento es una guía de producto y operación. No es dictamen jurídico, de seguridad, eléctrico ni de cumplimiento normativo.
