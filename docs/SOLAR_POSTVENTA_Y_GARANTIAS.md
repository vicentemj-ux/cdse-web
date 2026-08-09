# CDSE Solar — guía de postventa, garantías y desempeño

Fecha de corte: 8 de agosto de 2026.

## Propósito

Mantener la continuidad del proyecto después de la instalación e interconexión.
El módulo **Postventa** une al expediente original:

- equipos instalados y números de serie;
- garantías y vigencias verificadas;
- casos de servicio con responsable y objetivo interno;
- generación observada contra la estimación de la propuesta;
- satisfacción y autorización expresa para contacto sobre referidos.

No sustituye el documento de garantía, el diagnóstico técnico ni un sistema de
monitoreo del fabricante.

## 1. Alta automática al terminar instalación

Cuando una orden de trabajo llega a `completed`, el sistema toma el snapshot
vendido y crea:

- un activo agregado para los paneles instalados;
- un activo para el o los inversores;
- garantía de producto y desempeño del módulo, si el catálogo tiene años;
- garantía de inversor, si el catálogo tiene años.

Las vigencias nacen de la fecha real de terminación. El texto generado indica que
debe validarse contra el documento del fabricante. Las series quedan pendientes
hasta que administración las documente.

No se crea automáticamente garantía de instalación CDSE: duración, exclusiones y
condiciones deben provenir de una política comercial aprobada.

## 2. Equipos y garantías

### Activo instalado

Registrar tipo, fabricante, modelo, serie, cantidad y fecha de instalación. Una
serie no puede repetirse dentro del proyecto. Los activos no deben eliminarse:
si se reemplazan o retiran, se conserva el registro y cambia su estado.

### Garantía

Registrar:

- equipo o sistema general;
- tipo de garantía;
- proveedor responsable;
- inicio y vencimiento;
- cobertura verificada;
- contacto para reclamación;
- referencia de póliza, certificado o factura.

El tablero alerta garantías activas que vencen en los siguientes 90 días. Una
garantía sin fecha no se considera vencida, pero requiere revisión documental.

## 3. Casos de servicio

El vendedor o miembro del proyecto puede abrir un caso. Administración controla
diagnóstico, esperas, programación, resolución y cierre.

Prioridades y objetivos internos iniciales:

| Prioridad | Objetivo interno |
|---|---:|
| Crítica | 24 horas |
| Alta | 72 horas |
| Normal | 7 días |
| Baja | 14 días |

Estos valores ordenan trabajo; no son SLA contractual ni promesa al cliente.
Cada cambio queda en `solar_service_case_events` y en la bitácora del proyecto.
Resolver o cerrar exige una explicación de la solución.

Estados:

`abierto → diagnóstico → espera cliente/proveedor/material → programado → resuelto → cerrado`

Un caso puede cancelarse con trazabilidad; no se elimina.

## 4. Generación

Cada lectura contiene periodo, kWh reales, kWh esperados, fuente y referencia.
Si no se captura una expectativa, el servidor prorratea la generación anual del
snapshot de la propuesta por los días del periodo.

Una cobertura menor a 80% se destaca para revisión, pero no diagnostica por sí
sola una falla. Deben considerarse clima, sombras nuevas, indisponibilidad de red,
configuración, limpieza y comparabilidad del periodo.

Fuentes admitidas: portal del inversor, recibo del cliente, exportación de
monitoreo, captura manual u otra fuente documentada.

## 5. Cliente y referidos

Puede registrarse una valoración de recomendación de 0 a 10 y comentarios en
distintos momentos. La autorización para contacto sobre referidos es independiente
y nunca se deduce de una puntuación alta. Si no se autorizó, el portal conserva
`false` y no habilita una nota de referido.

## 6. Permisos y privacidad

- Miembros del proyecto leen equipos, garantías, casos, lecturas y seguimiento.
- Miembros pueden abrir casos y registrar lecturas/retroalimentación.
- Sólo administración crea equipos y garantías o cambia estados operativos del caso.
- La información se protege con RLS por proyecto.
- Documentos de garantía y fotografías sensibles permanecen en el expediente
  privado; no se convierten en enlaces públicos permanentes.

## 7. Revisión mensual sugerida

1. Casos abiertos y vencidos por responsable.
2. Garantías que vencen dentro de 90 días.
3. Proyectos con cobertura de generación menor a 80%.
4. Activos sin serie o garantía documental.
5. Casos resueltos que aún no se cierran.
6. Seguimientos anuales y satisfacción pendientes.

La configuración de garantías, responsabilidades y compromisos debe aprobarse
con la política comercial y de servicio de CDSE antes de comunicarse al cliente.
