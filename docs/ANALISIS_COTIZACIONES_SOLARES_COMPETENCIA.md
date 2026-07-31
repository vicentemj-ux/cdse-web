# Análisis comparativo de cotizaciones solares

Fecha de análisis: 30 de julio de 2026
Caso: tres propuestas elaboradas para el mismo prospecto a partir del mismo recibo CFE.

## Conclusión ejecutiva

SUNWIRE tiene la mejor experiencia de lectura para un cliente no técnico. Su principal acierto no es solamente el color: convierte el historial del recibo en una tabla y una gráfica reconocibles, y después conecta esos datos con el sistema propuesto. El cliente puede seguir la historia `recibo -> consumo -> paneles -> ahorro`.

Sin embargo, ninguna propuesta debe copiarse de forma directa. Las tres contienen diferencias o inconsistencias que podrían afectar una decisión de compra:

- L'Opande dimensiona con 11,668 kWh/año y recomienda 12 paneles.
- SUNWIRE dimensiona con 2,819 kWh/año y recomienda 3 paneles.
- Valcar muestra 415 kWh como consumo actual y recomienda 3 paneles, pero mezcla unidades mensuales, bimestrales y anuales.

La superversión de CDSE debe combinar:

1. La familiaridad del resumen de consumo de SUNWIRE.
2. La explicación técnica y financiera de L'Opande.
3. La estructura ejecutiva, garantías y aceptación comercial de Valcar.
4. Una capa propia de trazabilidad que impida publicar cifras incompatibles.

## Comparación normalizada

| Concepto declarado | L'Opande Solar | SUNWIRE | Valcar Solar |
|---|---:|---:|---:|
| Consumo usado | 11,668 kWh/año | 2,819 kWh/año | 415 kWh, periodo no aclarado |
| Paneles | 12 | 3 | 3 |
| Potencia por panel | 620 W en resumen; 635 W en desglose | 635 W | No indicada; 1.67 kWp / 3 equivale a 557 W |
| Potencia total | No destacada | 1.90 kW | 1.67 kWp |
| Producción declarada | 11,918 kWh/año | 2,996 kWh/año | 440 kWh/año, unidad probablemente incorrecta |
| Cobertura declarada | 102% | 106% implícita | 106% |
| Inversión | $114,000 MXN | $1,767.83 USD / $30,838.20 MXN | $25,500 MXN |
| Ahorro anual | $46,441.44 MXN | $9,207.74 MXN en tabla; $12,115 MXN en resumen | $19,308.50 MXN |
| Retorno declarado | 2.5 años | 2.1 años | 2.3 años |
| Equipos identificados | Canadian Solar + Growatt + K2 | Canadian Solar + Growatt | Descripciones generales; sin modelo de panel |
| Vigencia | No destacada | No indicada | 15 días |
| Firma / aceptación | No | No | Sí |

## Revisión de consistencia

### L'Opande Solar

Fortalezas:

- Explica consumo, producción, facturación actual, nueva y ahorro por periodo.
- Incluye desglose de equipos, servicios, IVA, exclusiones y revisión en sitio.
- El retorno simple sí se aproxima a la relación entre inversión y ahorro del primer año:
  `114,000 / 46,441 = 2.45 años`.
- La cobertura declarada coincide aproximadamente con:
  `11,918 / 11,668 = 102.1%`.

Riesgos:

- El resumen indica paneles de 620 W, pero el desglose especifica paneles de 635 W.
- El consumo anual y la facturación son aproximadamente cuatro veces los usados por SUNWIRE para el mismo recibo.
- Frases como “98% de forma permanente” y el ahorro a 25 años presentan demasiada certeza para una precotización.
- La deducción de ISR requiere lenguaje condicionado a la situación fiscal del cliente, no una promesa general.

### SUNWIRE

Fortalezas:

- Es la propuesta más fácil de relacionar con el recibo CFE.
- La tabla por bimestre hace visible qué dato se leyó y cómo cambia con paneles.
- La fórmula física del sistema es coherente:
  `3 x 635 W = 1.905 kW`.
- La producción declarada implica un rendimiento razonable para la zona:
  `2,996 / 1.905 = 1,573 kWh por kWp al año`.
- Identifica marcas, modelos, estructura, mano de obra, trámites, subtotal e IVA.
- Presenta contado y alternativas de financiamiento.

Riesgos:

- El resumen dice ahorro anual de $12,115 MXN, superior al pago anual actual de $12,108 MXN.
- La tabla detallada calcula un ahorro de $9,207.74 MXN y un pago residual de $2,900.62 MXN; esto no coincide con el resumen de $719 MXN.
- Con las cifras de la tabla, el retorno simple sería:
  `30,838.20 / 9,207.74 = 3.35 años`, no 2.1 años.
- “Pago promedio (12 meses) $2,018” parece ser el promedio de seis recibos bimestrales, no un promedio mensual.
- El ahorro acumulado cambia de una base de pago con paneles de $2,900.62 en el año 1 a $719.68 en el año 2 sin explicar la transición.
- El beneficio ambiental de 1,330 toneladas de CO2 no es compatible con una generación anual de 2,996 kWh.
- La información bancaria aparece antes de una sección formal de alcance, exclusiones y aceptación.

### Valcar Solar

Fortalezas:

- Es la propuesta más compacta y ejecutiva.
- Presenta precio, vigencia, garantías, tiempos, forma de pago y alcance en bloques claros.
- Incluye una hoja de aceptación con espacio para firma del cliente y vendedor.
- El lenguaje comercial es más prudente que el de las otras propuestas.

Riesgos:

- Declara 440 kWh/año de producción y 106% de cobertura sobre 415 kWh. Parece comparar periodos equivalentes, pero etiqueta la producción como anual.
- No aclara si los 415 kWh son mensuales, bimestrales o un promedio normalizado.
- El ahorro anual de $19,308.50 no guarda una relación clara con el pago mostrado de $3,174.
- `25,500 / 19,308.50 = 1.32 años`, no el retorno declarado de 2.3 años.
- No indica potencia ni modelo exacto de cada panel.
- El resumen técnico usa “microinversor Growatt” sin aportar modelo o compatibilidad.

## Dirección de diseño para CDSE

### Lo que se adopta de SUNWIRE

- Un bloque inicial llamado **Resumen de tu recibo**.
- Historial por periodo con consumo, importe, generación estimada y saldo residual.
- Gráfica sencilla que permita comparar consumo y producción.
- Jerarquía visual basada en cifras grandes y explicaciones cortas.
- Continuidad visual entre lo que el cliente reconoce en CFE y la recomendación solar.

No debe reproducirse el recibo CFE de forma literal ni utilizar su logotipo, folio visual o una composición que pueda interpretarse como documento oficial. La familiaridad debe venir de la estructura de lectura, acompañada siempre por la leyenda **Propuesta solar CDSE - documento no emitido por CFE**.

### Lo que se adopta de L'Opande

- Comparación detallada por periodo.
- Desglose explícito de equipos y servicios.
- Supuestos de proyección visibles.
- Exclusiones técnicas y necesidad de levantamiento en sitio.

### Lo que se adopta de Valcar

- Resumen ejecutivo compacto.
- Vigencia, tiempo de instalación y forma de pago.
- Garantías separadas por panel, inversor, producción e instalación.
- Página final de aceptación.

## Estructura recomendada de la propuesta CDSE

### Página 1 - Resumen de tu recibo y recomendación

- Logotipo CDSE Solar y folio propio.
- Cliente, ubicación, tarifa, periodicidad y fecha.
- Consumo anual normalizado.
- Panel elegido, cantidad, potencia total y cobertura objetivo.
- Inversión total y CTA para validar visita.
- Aviso visible: propuesta preliminar, no emitida por CFE.

### Página 2 - Cómo llegamos al resultado

- Historial completo del recibo.
- Estado de cada renglón: extraído automáticamente, confirmado por cliente o corregido por asesor.
- Gráfica consumo vs. producción.
- Fórmula resumida:
  `paneles = techo(consumo objetivo / producción anual por panel)`.
- Supuestos de irradiación, pérdidas y cobertura.

### Página 3 - Inversión y escenario económico

- Precio por panel instalado o precio por watt, solo después de cargar la configuración vigente.
- Pago actual, pago residual estimado y ahorro.
- Retorno simple calculado sobre el mismo ahorro mostrado.
- Proyección anual con tasa de incremento editable y claramente identificada.
- Escenario conservador, no promesas de “ahorro permanente”.

### Página 4 - Equipos, alcance y garantías

- Marca, modelo, potencia y cantidad de paneles.
- Inversor, estructura, protecciones, monitoreo e interconexión.
- Incluye / no incluye.
- Garantías por componente.
- Vigencia, plazo estimado y condiciones de pago.

### Página 5 - Siguiente paso y aceptación

- Validación de techo, sombras, orientación, estructura y acometida.
- Fotografías o croquis cuando estén disponibles.
- Firma de cliente y asesor.
- Datos de contacto y enlace verificable al folio digital.

## Reglas automáticas antes de emitir una propuesta

El generador debe bloquear la emisión si falla cualquiera de estas validaciones:

1. El historial no tiene periodicidad explícita.
2. La suma anual no coincide con los periodos mostrados.
3. `cantidad x watts` no coincide con la potencia total.
4. La generación total no coincide con paneles, zona, irradiación y factor de desempeño.
5. La cobertura mostrada no coincide con generación / consumo.
6. El ahorro supera el pago actual sin una explicación de ingreso por excedentes.
7. El retorno no coincide con inversión / ahorro anual.
8. Se mezclan MXN y USD sin tipo de cambio y fecha.
9. Un dato mensual o bimestral se etiqueta como anual.
10. Equipo, precio o garantía no corresponde a la versión vigente del catálogo.

## Decisión recomendada para este caso

El recibo CFE original confirma una tarifa PDBT y un periodo vigente de 817 kWh. La base móvil de doce meses se obtiene sumando ese periodo y los cinco bimestres inmediatamente anteriores:

```text
817 + 349 + 84 + 116 + 577 + 876 = 2,819 kWh
```

Por lo tanto, SUNWIRE interpretó correctamente el historial energético del recibo. Valcar coincide en una solución de tres paneles, pero presenta la periodicidad y las unidades de forma ambigua. La base de 11,668 kWh usada por L'Opande no está sustentada por este recibo y conduce a un sobredimensionamiento cercano a cuatro veces el consumo observado.

El caso queda incorporado como prueba de regresión del parser CFE de CDSE. La extracción automática debe devolver seis periodos bimestrales, 2,819 kWh, tarifa PDBT y confianza alta, siempre con confirmación humana antes de cotizar.
