# Analítica de dirección de CDSE Solar

Fecha de corte: 9 de agosto de 2026.

## Propósito

La vista **Dirección** reconstruye desempeño comercial, operativo y financiero a
partir de los libros existentes. No guarda totales paralelos ni utiliza metas de
mercado inventadas. Administradores ven al equipo y pueden filtrar vendedor;
ventas ve únicamente su cartera autorizada por RLS.

## Definiciones ejecutables

### Conversión

El periodo selecciona una cohorte por `solar_leads.created_at`. Los siguientes
escalones conservan esos mismos leads:

1. leads recibidos;
2. leads con al menos una cotización;
3. leads cuya cotización generó proyecto;
4. leads con proyecto operativo o fecha de puesta en marcha.

La tasa de cada escalón usa como denominador los leads de la cohorte. En el
desglose por vendedor, la conversión relaciona cotizaciones creadas en el periodo
con ventas pertenecientes a esa misma muestra. La venta monetaria sí se reconoce
por `accepted_at`, por lo que se etiqueta por separado como **venta aceptada**.

### Duración

Se reporta la mediana, no el promedio, para reducir la distorsión de expedientes
atípicos. Cada indicador muestra su tamaño de muestra y sólo admite pares de
fechas válidos y cronológicos:

- lead a primera cotización;
- cotización a aceptación/creación del proyecto;
- venta a primera orden de instalación terminada;
- instalación terminada a interconexión registrada.

Cuando no existen ambos hitos se muestra `Sin muestra`; no se imputa un cero.

### Control de excepciones

Las alertas representan el estado actual y no se ocultan al cambiar fechas:

- proyecto `at_risk`, `blocked` u `overdue`;
- tarea abierta con vencimiento anterior a hoy;
- orden abierta cuya ventana planeada terminó;
- expediente CFE no terminal con una parte responsable de la espera.

Cada renglón abre el proyecto fuente. El filtro de vendedor sí limita las alertas
para mantener una mesa de trabajo accionable.

### Finanzas

Los importes se presentan antes de IVA salvo indicación expresa:

- venta: `solar_projects.amount_before_vat_mxn`;
- costo real: partidas `actual` con estado `paid`;
- comisión comprometida: obligación neta registrada;
- margen real: venta antes de IVA menos costo real pagado y comisión pagada.

Por eso el margen puede ser provisional mientras falten costos por conciliar. La
interfaz lo advierte de forma permanente y conserva Finanzas como fuente de
detalle y CSV.

## Alcance y siguientes cortes

Este primer corte consolida equipo/vendedor, cohortes, tiempos, excepciones y
rentabilidad. Quedan como ampliaciones documentadas:

- conversión por fuente de captación, zona y municipio;
- porcentaje de expedientes completos al primer intento;
- separación agregada de días CDSE contra espera externa;
- puntualidad, retrabajo y productividad por cuadrilla;
- conexión automática con portales de monitoreo.

El motor puro vive en `src/lib/solar/executive-analytics.mjs`; sus casos de borde
se verifican en `tests/executive-analytics.test.mjs`.
