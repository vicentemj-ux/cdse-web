# CDSE Solar — operación de cobros y comisiones

Fecha de corte: 8 de agosto de 2026.

## 1. Qué controla el portal

El módulo **Finanzas** separa deliberadamente dos libros:

1. **Cobranza del proyecto:** total acordado con IVA, calendario, movimientos pendientes de revisión, pagos conciliados y saldo.
2. **Comisión del vendedor:** base congelada antes de IVA, tasa, ajuste justificado, hitos de devengo, autorización y pago.

El portal es un control operativo y auditable. No sustituye banca, contabilidad,
CFDI, complemento de recepción de pagos ni nómina.

## 2. Política CDSE implementada

- La tasa normal está entre **5% y 10%**, con 10% como máximo.
- La base es `amount_before_vat_mxn` del proyecto aceptado.
- Un ajuste distinto de cero exige motivo.
- La comisión se devenga en dos hitos:
  - 50% al existir un cobro conciliado y confirmarse que el anticipo dejó firme la venta;
  - 50% cuando el acta de entrega y puesta en marcha está aprobada.
- Sólo una comisión 100% devengada y dentro de política puede autorizarse.
- El pago exige referencia del movimiento y admite referencia de nómina/contabilidad.
- Si administrador y vendedor son la misma persona, la autorización propia exige
  un motivo excepcional. Al incorporar otro administrador debe usarse segregación
  de funciones como regla normal.

## 3. Flujo operativo

### Al aceptar una cotización

El proyecto crea automáticamente:

- un renglón de pago total, si fue contado; o
- enganche y liquidación por financiamiento, si la propuesta contiene enganche.

Para proyectos históricos la migración crea el calendario con el snapshot que ya
existía. Administración puede ajustar el vencimiento; el importe queda ligado a
la propuesta aceptada y no se modifica silenciosamente desde el calendario.

### Al recibir dinero

1. El vendedor o miembro del proyecto registra fecha, importe, medio y referencia.
2. El movimiento queda **Por conciliar** y no modifica el saldo.
3. Administración compara el dato con banca/comprobante y lo concilia o rechaza.
4. Sólo los movimientos conciliados reducen el saldo.
5. El hito de anticipo se confirma por separado; conciliar no equivale por sí solo
   a declarar firme la venta.

### Al pagar comisión

1. Revisar base antes de IVA y tasa.
2. Confirmar anticipo conciliado.
3. Aprobar el acta de entrega en el expediente.
4. Confirmar el segundo hito.
5. Autorizar la comisión.
6. Registrar pago con referencia bancaria y, cuando corresponda, referencia de
   nómina o contabilidad.

## 4. Controles y límites conocidos

- Los pagos rechazados no afectan el saldo.
- Los estados y actores quedan en `solar_project_events` y
  `solar_commission_events`.
- Esta versión no registra todavía reembolsos parciales, cancelaciones con reverso
  proporcional, costo real, margen ni exportación contable. No deben resolverse
  cambiando importes históricos: se implementarán como movimientos compensatorios.
- La tasa de 0% puede existir sólo en proyectos históricos que nacieron sin una
  política configurada; queda marcada para revisión y no puede autorizarse.

## 5. Referencias oficiales revisadas

- La [Ley Federal del Trabajo vigente, artículo 84](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf)
  integra las comisiones al salario cuando son pagos entregados al trabajador por
  su trabajo.
- El [SAT — Recibo de nómina](https://wwwmat.sat.gob.mx/consultas/97722/comprobante-de-nomina)
  indica el uso del CFDI de nómina para pagos por sueldos, salarios, servicio
  personal subordinado o asimilados.
- La [regla SAT sobre CFDI por pagos realizados](https://wwwmat.sat.gob.mx/articulo/22029/regla-2.7.1.35)
  describe el complemento de recepción de pagos cuando la contraprestación no se
  liquida en una sola exhibición.

La clasificación concreta de cada vendedor, el timbrado, retenciones y momento
fiscal deben confirmarse con el contador y asesor laboral de CDSE.
