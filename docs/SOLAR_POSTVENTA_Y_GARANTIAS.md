# CDSE Solar — guía de postventa, garantías y desempeño

Fecha de corte: 9 de agosto de 2026.

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

## 3. Reclamaciones, cuarentena y RMA

Una reclamación parte de una **serie instalada y conciliada**. Al abrirla, el
servidor crea o enlaza un caso de servicio, cambia la unidad a `quarantined`,
marca la póliza como `claim_open` y conserva un evento inmutable. No se elimina
ni se edita la historia del equipo.

Flujo controlado:

`diagnóstico → evidencia → envío → aprobación/rechazo → reemplazo en tránsito → recepción → instalación → resolución → cierre`

La pantalla bloquea el envío al fabricante mientras falte alguna referencia:

1. comprobante de compra o instalación;
2. fotografía de placa y número de serie;
3. diagnóstico o mediciones del técnico;
4. fotografía, video o código de falla;
5. para fabricante, configuración del sistema: paneles, strings, red, tensión y frecuencia.

Para una sustitución, administración debe recibir una serie disponible de la
misma categoría. El sistema la aparta al proyecto. Después se entrega e instala
desde **Inventario**; sólo entonces puede resolverse el RMA. La serie retirada
queda `retired` y la nueva permanece enlazada al activo y a la garantía.

### Efecto sobre la vigencia

- Reparación: los días transcurridos entre inicio y término del servicio se
  agregan al vencimiento registrado.
- Sustitución: la vigencia se reinicia desde la entrega del reemplazo usando la
  duración original documentada.
- Crédito o reembolso: el equipo queda retirado y la póliza se marca cumplida.

Estas reglas implementan control operativo compatible con los artículos 77 a
84 de la Ley Federal de Protección al Consumidor. En particular, el artículo 83
señala que el tiempo de reparación no se cuenta dentro de la garantía y que la
reposición del bien renueva su plazo. La póliza contractual real sigue siendo la
fuente del alcance, exclusiones y responsable.

Para reclamaciones Growatt, la guía oficial pide modelo y serie, comprobante,
configuración del sistema y descripción/evidencia de la falla. Por eso el portal
no permite presentar un expediente de fabricante incompleto.

## 4. Casos de servicio

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

## 5. Generación

Cada lectura contiene periodo, kWh reales, kWh esperados, fuente y referencia.
Si no se captura una expectativa, el servidor prorratea la generación anual del
snapshot de la propuesta por los días del periodo.

Una cobertura menor a 80% se destaca para revisión, pero no diagnostica por sí
sola una falla. Deben considerarse clima, sombras nuevas, indisponibilidad de red,
configuración, limpieza y comparabilidad del periodo.

Fuentes admitidas: portal del inversor, recibo del cliente, exportación de
monitoreo, captura manual u otra fuente documentada.

## 6. Cliente y referidos

Puede registrarse una valoración de recomendación de 0 a 10 y comentarios en
distintos momentos. La autorización para contacto sobre referidos es independiente
y nunca se deduce de una puntuación alta. Si no se autorizó, el portal conserva
`false` y no habilita una nota de referido.

## 7. Permisos y privacidad

- Miembros del proyecto leen equipos, garantías, casos, lecturas y seguimiento.
- Miembros pueden abrir casos, iniciar una reclamación y registrar lecturas/retroalimentación.
- Operaciones y administración completan evidencia y cambian estados del RMA.
- Sólo administración recibe reemplazos y aplica la resolución final que modifica
  inventario, activo o vigencia.
- Sólo administración crea equipos y pólizas o cambia estados operativos del caso.
- La información se protege con RLS por proyecto.
- Documentos de garantía y fotografías sensibles permanecen en el expediente
  privado; no se convierten en enlaces públicos permanentes.

## 8. Revisión semanal y mensual sugerida

1. Casos abiertos y vencidos por responsable.
2. Garantías que vencen dentro de 90 días.
3. Proyectos con cobertura de generación menor a 80%.
4. Activos sin serie o garantía documental.
5. Casos resueltos que aún no se cierran.
6. Seguimientos anuales y satisfacción pendientes.
7. RMA sin evidencia, sin folio externo o con seguimiento vencido.
8. Reemplazos recibidos que todavía no se entregaron o instalaron.

La configuración de garantías, responsabilidades y compromisos debe aprobarse
con la política comercial y de servicio de CDSE antes de comunicarse al cliente.

## Fuentes oficiales

- Cámara de Diputados, Ley Federal de Protección al Consumidor vigente, artículos
  77–84: https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf
- Growatt, Warranty Claim y datos requeridos:
  https://en.growatt.com/support/warranty
- Growatt, formulario de reclamación y evidencia de falla:
  https://warranty.growatt.com/common/showLink/2408052026268?lang=en
