# CDSE Solar — inventario y materiales por proyecto

Fecha de implementación: 8–9 de agosto de 2026. Migraciones: `202608080013`, endurecimiento `202608080014` y serialización `202608090001`.

## Propósito

Este módulo separa tres cantidades que no deben confundirse:

- **Físico:** unidades que realmente están en una ubicación de CDSE.
- **Apartado:** parte del físico comprometida para proyectos específicos.
- **Disponible:** físico menos apartado; es lo único que puede prometerse a otro proyecto.

El costo de proyecto y el inventario son fuentes distintas. Finanzas registra el costo presupuestado o incurrido; Inventario demuestra qué material entró, se comprometió, se entregó y volvió.

Paneles e inversores usan además identidad unitaria. Cada serie conserva su estado actual y una bitácora inmutable desde la factura o remisión hasta el activo instalado.

## Cadena de custodia por serie

Los estados permitidos son:

1. **En almacén:** recibida con factura/remisión o conciliada contra existencia física anterior.
2. **Apartada:** comprometida para una partida y proyecto concretos.
3. **En obra:** salió del almacén mediante una entrega y, cuando existe, una orden de trabajo.
4. **Instalada:** fue confirmada físicamente y quedó vinculada al activo de Postventa.
5. **En revisión o retirada:** estados de excepción reservados para aislamiento y baja controlada.

El servidor valida que una serie no se repita globalmente, pertenezca al SKU y ubicación correctos, respete la transición esperada y no pueda asignarse a dos proyectos. Los movimientos serializados actualizan en una sola transacción el saldo agregado, la partida, el libro mayor, el estado de la unidad y la bitácora del proyecto.

Para existencia comprada antes de esta función se utiliza **Identificar existencia anterior**. Esta operación no incrementa el saldo: sólo permite registrar series hasta el máximo físico disponible todavía no identificado.

## Flujo operativo

### 1. Catalogar y recibir

1. Paneles e inversores se sincronizan automáticamente desde `Catálogo y precios`.
2. Estructura, cableado, protecciones, monitoreo y consumibles se crean como SKU independientes.
3. Administración registra cada recepción con cantidad, costo antes de IVA y factura o remisión.
4. El sistema conserva el saldo físico anterior y posterior.

El almacén inicial es `Almacén Morelos`, Calle Morelos #209 Ote., Col. Centro, Los Mochis, Sinaloa. Pueden agregarse otras ubicaciones posteriormente sin mezclar saldos.

### 2. Planear el proyecto

Al crear un proyecto desde una venta aceptada se agregan automáticamente:

- cantidad vendida del modelo de panel;
- modelo y cantidad del inversor seleccionado.

Ingeniería o administración completa estructura, protecciones, cableado y consumibles reales. Agregar una partida al plan todavía no modifica existencias.

### 3. Apartar

Administración aparta material para un proyecto. El servidor bloquea el movimiento si:

- no existe suficiente cantidad disponible;
- se intenta apartar más de lo planeado;
- la cantidad no es positiva.

El material sigue físicamente en almacén, pero deja de estar disponible para otras obras.

### 4. Entregar a obra

La entrega sólo puede hacerse sobre material previamente apartado. Puede vincularse a una orden de trabajo del mismo proyecto y registrar vale, remisión o nota.

Al entregar:

- disminuye el físico;
- disminuye el apartado;
- aumenta el acumulado entregado del proyecto;
- se crea un evento en la bitácora del proyecto.

### 5. Liberar o devolver

- **Liberar:** cancela una parte del apartado que nunca salió del almacén.
- **Devolver:** reingresa material que ya había sido entregado. No permite devolver más que la entrega neta.

Una corrección nunca edita ni borra el movimiento original; se registra un movimiento compensatorio.

## Lectura de estados

- **Sin apartar:** ninguna parte del plan está cubierta.
- **Parcial:** existe material apartado o entregado, pero falta cubrir el plan.
- **Listo para entregar:** todo lo pendiente está apartado.
- **Entregado:** la entrega neta cubre el plan.

Un proyecto se considera listo sólo cuando todas sus partidas abiertas están cubiertas. El indicador de reorden se activa cuando la disponibilidad total es igual o menor al punto configurado del SKU.

## Permisos

- **Administrador:** crea SKU, recibe, ajusta, planea, aparta, libera, entrega y devuelve.
- **Vendedor o miembro del proyecto:** consulta disponibilidad y materiales de sus proyectos; no modifica saldos.
- **Libro mayor:** sólo se consulta. No admite edición ni borrado directo.

Todas las mutaciones de saldo pasan por funciones transaccionales con bloqueo de fila. Las políticas RLS limitan partidas y movimientos de proyecto a sus miembros.

## Conciliación recomendada

Semanalmente:

1. revisar puntos de reorden;
2. resolver proyectos con partidas sin cubrir antes de confirmar fecha de instalación;
3. comparar vales físicos contra entregas del libro mayor;
4. registrar devoluciones y ajustes con explicación;
5. resolver cualquier equipo **En obra** que todavía no haya sido confirmado como instalado;
6. comparar factura/remisión, libro mayor, series y activos de Postventa.

Mensualmente, administración debe hacer conteo físico por ubicación. Las diferencias se registran como `Ajuste de entrada` o `Ajuste de salida`; nunca se cambia el saldo directamente.

## Límites actuales

- El costo mostrado usa el costo unitario de catálogo y es auxiliar operativo, no póliza contable.
- No se generan órdenes de compra ni transferencias entre almacenes en esta fase.
- Los consumibles no se infieren: deben catalogarse y planearse según ingeniería real.
- La cuarentena, devolución a proveedor, reemplazo y retiro se controlan desde
  **Postventa → Garantías / RMA**. La recepción del reemplazo genera una partida y
  reserva una serie disponible; su entrega e instalación continúan en Inventario
  para conservar la misma cadena de custodia.
