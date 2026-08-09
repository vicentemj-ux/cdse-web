# Inversores y desglose de la propuesta solar

## Objetivo

La propuesta conserva tres páginas. La tercera concentra el desglose del sistema con servicios incluidos, componentes, especificación, cantidad, subtotal antes de IVA, IVA incluido, total, términos comerciales y la nota fiscal para negocios.

El modelo y la cantidad del inversor quedan congelados dentro de la cotización para que el PDF, el proyecto, almacén, instalación y postventa consulten el mismo alcance.

## Catálogo Growatt

El catálogo separa cada potencia comercial de las familias solicitadas:

- MIC 1000, 1500, 2000, 2500, 3000 y 3300 TL-X;
- MIN 2500, 3000, 3600, 4200, 4600, 5000 y 6000 TL-X.

Growatt enumera los modelos MIC en su [manual oficial MIC TL-X](https://de.growatt.com/upload/file/MIC_600-3000TL-X_User_manual_EN_202306.pdf) y los modelos MIN, junto con sus potencias aparentes nominales, en el [manual oficial MIN TL-X para México](https://latam.growatt.com/upload/file/MIN_2500-6000TL-X_Manual_de_usuario_MX.pdf).

Administración puede dar de alta o de baja cada modelo. Una baja impide seleccionarlo en cotizaciones nuevas, pero no altera cotizaciones históricas.

## Recomendación automática

La política comercial de CDSE limita el cociente del arreglo fotovoltaico en corriente directa respecto a la potencia nominal del inversor en corriente alterna:

`carga DC/AC = potencia de paneles kWp / potencia total de inversores kW × 100`

El resultado debe ser menor o igual a 120%. Entre las alternativas activas que cumplen, el motor elige:

1. la que requiere menos inversores;
2. si hay empate, la de menor potencia AC combinada;
3. si persiste el empate, la unidad de mayor potencia.

Ejemplos con panel de 550 W:

| Arreglo | Potencia DC | Recomendación comercial | Carga DC/AC |
| --- | ---: | --- | ---: |
| 4 paneles | 2.20 kWp | 1 × MIC 2000TL-X | 110.0% |
| 8 paneles | 4.40 kWp | 1 × MIN 4200TL-X | 104.8% |
| 17 paneles | 9.35 kWp | 2 × MIN 4200TL-X | 111.3% |

El vendedor puede sustituir el modelo antes de generar. El servidor vuelve a calcular cantidad y carga, y rechaza cualquier combinación que exceda el límite.

## Límite del cálculo comercial

Esta recomendación no sustituye la ingeniería. Antes de instalar deben comprobarse, con la ficha exacta del panel y del inversor seleccionado:

- voltaje de circuito abierto a la temperatura mínima de diseño;
- rango MPPT y voltaje de arranque;
- corriente máxima y corriente de cortocircuito por entrada;
- cantidad de strings y módulos por string;
- tensión, fases, protecciones, conductores y condiciones del punto de interconexión.

El manual MIN para México especifica dos entradas independientes, límites de corriente y voltajes máximos diferentes según el modelo; por ello el PDF identifica la propuesta como precotización sujeta a levantamiento e ingeniería final.
