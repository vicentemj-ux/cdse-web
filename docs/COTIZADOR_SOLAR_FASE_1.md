# Cotizador solar CDSE — especificación ejecutable de fase 1

Estado: borrador de trabajo para validación comercial
Origen: revisión de `spec-cotizador-solar-cdse.md`
Objetivo prioritario: convertir visitas y recibos CFE en oportunidades de venta que CDSE pueda atender.

## 1. Decisión de producto

La fase 1 no será solamente una calculadora ni un generador de PDF. Será un embudo comercial:

1. explicar la oferta solar de CDSE;
2. recibir un recibo CFE o datos equivalentes;
3. identificar y guardar al prospecto;
4. entregar una estimación útil;
5. conducir al prospecto a una conversación de venta;
6. conservar todos los datos y supuestos usados en la estimación.

La cifra mostrada al usuario será una **estimación preliminar sujeta a validación técnica**. Una visita o revisión remota deberá confirmar espacio disponible, sombras, orientación, estructura, instalación eléctrica, fases, punto de interconexión y equipos finales.

## 2. Alcance comercial

### Incluido

- Landing pública en `/solar`.
- Cotizador progresivo integrado en la landing.
- Entrada por carga de recibo o captura manual.
- Extracción asistida del recibo: texto PDF u OCR, parser CFE y confirmación humana.
- Captura de datos de contacto y consentimiento.
- Cálculo por zona con parámetros versionados.
- Resultado inmediato y comprensible.
- Registro del lead y de la estimación.
- Folio único.
- PDF preliminar de dos o tres páginas.
- Enlace de WhatsApp con folio y resumen.
- Administrador mínimo para consultar y dar seguimiento.
- Estados: `nuevo`, `contactado`, `validando`, `propuesta_enviada`, `ganado`, `perdido`.
- Registro de fuente, campaña y parámetros UTM.

### Fuera de fase 1

- Activación productiva del proveedor OCR/visión para recibos escaneados.
- Cálculo definitivo de tarifas horarias GDMTH.
- Diseño final del PDF de cinco páginas.
- Automatización mediante la API oficial de WhatsApp.
- Financiamientos dinámicos.
- Firma electrónica y cobro.
- Reportería comercial avanzada.

Los tres PDF de competidores se analizarán en fase 2. Su contenido podrá cambiar la presentación comercial, pero no deberá romper el modelo de datos ni la trazabilidad de los cálculos.

## 3. Audiencias provisionales

Hasta recibir confirmación del negocio, el sistema admite:

- hogar con tarifa doméstica o DAC;
- pequeño negocio en PDBT;
- negocio de mayor demanda que requiere revisión especializada.

GDMTH no debe cotizarse como si fuera una tarifa residencial: usa demanda y periodos horarios. En fase 1 se puede dimensionar generación con el historial energético, pero el ahorro económico se mostrará como rango o se reservará para revisión.

## 4. Embudo y eventos

### Ruta principal: tengo mi recibo

1. CTA: `Analizar mi recibo`.
2. Captura o carga del recibo.
3. Datos mínimos: nombre, WhatsApp, municipio y consentimiento.
4. Creación del lead.
5. Datos del consumo; en v1 se capturan manualmente si solo se subió el archivo.
6. Resultado preliminar.
7. CTA: `Validar mi propuesta por WhatsApp`.

### Ruta alternativa: no tengo mi recibo

1. CTA: `Estimar con mi pago`.
2. Captura de pago promedio, periodicidad, tarifa conocida y municipio.
3. Identificación del prospecto.
4. Resultado en rango, con menor nivel de confianza.
5. Solicitud explícita del recibo para precisar la propuesta.

### Eventos de medición

- `solar_landing_view`
- `solar_quote_start`
- `solar_receipt_uploaded`
- `solar_contact_submitted`
- `solar_quote_calculated`
- `solar_pdf_downloaded`
- `solar_whatsapp_clicked`
- `solar_admin_status_changed`
- `solar_sale_won`

Cada evento debe conservar `lead_id`, `quote_id` cuando exista, fuente, campaña, UTM y fecha.

## 5. Datos y fricción

### Datos mínimos antes de guardar el lead

- nombre;
- WhatsApp;
- municipio o código postal;
- aceptación del aviso de privacidad;
- fuente y UTM capturados automáticamente.

El correo será opcional en el primer contacto. Hacerlo obligatorio reduce conversiones y no es necesario para continuar por WhatsApp.

### Datos de dimensionamiento

- tarifa CFE;
- periodos de consumo: kWh, monto, fecha inicial/final o duración;
- periodicidad mensual o bimestral;
- tipo de inmueble;
- tipo de techo;
- archivo del recibo, si está disponible.

El formulario debe permitir dos periodos como mínimo y recomendar seis bimestres o doce meses. Toda extrapolación deberá indicar el nivel de confianza.

### Extracción automática desde el recibo CFE

El recibo será la fuente estándar para iniciar una cotización. La automatización se divide en dos capas:

1. **Extracción documental:** obtener el texto nativo del PDF o usar OCR/visión cuando el archivo sea una imagen.
2. **Interpretación determinista:** convertir el texto CFE en campos normalizados mediante `cfe-receipt-parser.mjs`.

Para un recibo bimestral estándar, la base móvil de doce meses será:

```text
periodo facturado actual + cinco periodos históricos inmediatamente anteriores
```

No se sumarán los seis renglones históricos además del periodo actual, porque eso produciría catorce meses. Tampoco se usará `TOTAL A PAGAR` como costo energético si contiene adeudos, pagos o ajustes. Para el periodo actual se priorizará `Fac. del Periodo`; para el historial se usarán los importes asociados a cada renglón.

Campos propuestos automáticamente:

- número de servicio y RMU;
- tarifa, medidor, multiplicador y número de hilos;
- inicio y fin del periodo facturado;
- consumo actual en kWh;
- importe de la factura del periodo;
- historial de kWh e importes;
- periodicidad;
- consumo y facturación observada de doce meses.

Toda extracción conservará origen y confianza. El usuario o asesor deberá confirmar los periodos antes de emitir una propuesta comercial. Si faltan periodos, la periodicidad es ambigua o el OCR devuelve valores incompatibles, el resultado se marcará para revisión y nunca se publicará silenciosamente.

### Datos para validación posterior

- dirección completa;
- orientación e inclinación;
- sombras;
- superficie útil;
- tensión y número de fases;
- demanda contratada/facturable;
- fotografías del techo y tablero;
- crecimiento futuro de consumo.

## 6. Motor de cálculo

### 6.1 Normalización del consumo

Para periodos con fechas:

```text
consumo_diario = suma(kWh) / suma(días cubiertos)
consumo_anual = consumo_diario × 365
```

Para periodos sin fechas:

```text
consumo_anual = suma(kWh) / meses_cubiertos × 12
```

No se debe asumir que cada renglón del recibo representa un mes. La periodicidad debe ser explícita.

### 6.2 Generación por zona

El modo local y auditable usa:

```text
generación_anual_por_kW =
  horas_sol_pico_diarias × 365 × factor_de_rendimiento

generación_objetivo =
  consumo_anual × factor_de_cobertura
```

El factor de rendimiento agrega pérdidas por temperatura, inversor, cableado, suciedad y desajustes. Debe guardarse con la cotización.

El sistema quedará preparado para usar PVWatts V8 mediante latitud y longitud. Los parámetros mínimos relevantes serán potencia, pérdidas, tipo de arreglo, inclinación y azimut. La respuesta de PVWatts y su versión deberán guardarse para reproducibilidad.

### 6.3 Número de paneles

```text
paneles =
  techo(generación_objetivo / generación_anual_por_panel)

potencia_DC_kW =
  paneles × watts_panel / 1000
```

Siempre se redondea hacia arriba. Después se aplican restricciones de inversor, arreglos eléctricos y superficie; si no se han validado, se incluye una advertencia.

### 6.4 Precio

El motor soportará dos modos:

- precio por watt;
- suma de partidas.

La cotización conservará un snapshot inmutable de:

- panel e inversor;
- precio;
- IVA;
- partidas;
- margen;
- promociones;
- versión de configuración.

Modificar el catálogo no debe alterar cotizaciones históricas.

### 6.5 Ahorro preliminar

Para hogares, DAC y PDBT sin desglose tarifario completo se usa el gasto histórico:

```text
gasto_anual_observado = suma(montos) anualizada
proporción_compensable = mínimo(generación / consumo, 1)
ahorro_año_1 =
  (gasto_anual_observado - cargos_no_compensables)
  × proporción_compensable
  × factor_de_realización
```

`factor_de_realización` evita prometer que cada kWh generado elimina el mismo valor monetario. Debe ser configurable y visible en el registro técnico.

Para GDMTH el resultado económico será `requiere_revision`, salvo que se capturen consumos y demandas por periodo horario.

### 6.6 Proyección

Cada año considera:

- incremento tarifario;
- degradación anual del panel;
- ahorro acumulado;
- flujo acumulado después de inversión.

El periodo de recuperación es el primer año o fracción en el que el flujo acumulado deja de ser negativo. No se calculará como una simple división si se presenta una tabla con escalación y degradación.

### 6.7 Confianza y advertencias

Niveles:

- `baja`: pago aproximado sin recibo;
- `media`: menos de doce meses, datos manuales o sin fechas;
- `alta`: doce meses completos con recibo y ubicación conocida;
- `validada`: revisión técnica realizada por CDSE.

Advertencias automáticas:

- historial incompleto;
- cobertura mayor a 100%;
- tarifa horaria;
- falta de superficie;
- falta de orientación/sombras;
- precio provisional;
- generación calculada sin servicio climático externo.

## 7. Entidades

### `leads`

- `id`
- `created_at`
- `name`
- `phone_e164`
- `email`
- `municipality`
- `postal_code`
- `contact_preference`
- `privacy_consent_at`
- `source`
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`
- `status`
- `owner_user_id`
- `lost_reason`

### `receipts`

- `id`
- `lead_id`
- `storage_path`
- `mime_type`
- `service_number_last4`
- `tariff_code`
- `billing_frequency`
- `latest_bill_date`
- `capture_method`

El número de servicio completo no es necesario para una estimación y no debe pedirse sin una finalidad operativa.

### `consumption_periods`

- `id`
- `receipt_id`
- `period_start`, `period_end`
- `covered_days`
- `kwh`
- `amount_mxn`
- `demand_kw`
- `base_kwh`, `intermediate_kwh`, `peak_kwh`

### `quotes`

- `id`
- `folio`
- `lead_id`
- `receipt_id`
- `created_at`
- `status`
- `confidence`
- `calculation_version`
- `configuration_snapshot` JSON
- `input_snapshot` JSON
- `result_snapshot` JSON
- `total_mxn`
- `pdf_storage_path`
- `expires_at`
- `requires_engineering_review`

### Catálogos y configuración

- `zones`
- `solar_modules`
- `inverters`
- `cost_templates`
- `calculation_configs`
- `company_profile`
- `quote_events`
- `lead_notes`

La configuración publicada será versionada. Una versión usada por una cotización no se edita; se crea una nueva.

## 8. Seguridad

- Los archivos de recibos y PDF estarán en buckets privados.
- La landing no tendrá acceso de lectura a leads ni cotizaciones.
- La creación pública se hará mediante una función/RPC con campos permitidos, validación, rate limiting y protección anti-spam.
- El panel usará Supabase Auth y RLS.
- Las acciones administrativas se registrarán.
- El administrador tendrá `noindex` y no aparecerá en sitemap, pero eso no sustituye autenticación.
- No se expondrá la clave `service_role` al navegador.
- Se definirán políticas de conservación y eliminación de recibos.

## 9. Arquitectura compatible con el repositorio

El sitio actual usa Astro con `output: "static"`. Para conservar rendimiento y reducir cambios:

- páginas públicas prerenderizadas en Astro;
- isla React únicamente para el cotizador;
- Supabase Auth, Postgres y Storage;
- Edge Functions de Supabase para creación segura, folio y PDF;
- administrador como ruta Astro con aplicación autenticada y datos protegidos por RLS.

Alternativa: añadir adaptador de Vercel y rutas de servidor de Astro. No es necesario para la primera implementación si las operaciones privilegiadas viven en Supabase.

## 10. Resultado público

El resultado inicial debe mostrar:

- número de paneles recomendado;
- potencia del sistema;
- generación anual estimada;
- cobertura estimada;
- ahorro anual en rango;
- inversión o rango, según política comercial;
- recuperación estimada;
- nivel de confianza;
- siguiente paso.

No se mostrará precisión falsa. Los valores monetarios se redondearán comercialmente y los supuestos estarán disponibles en un bloque expandible.

CTA principal:

```text
Validar esta propuesta por WhatsApp
```

El mensaje incluirá folio, nombre, zona, tarifa, paneles estimados y URL segura de seguimiento.

## 11. PDF de fase 1

### Página 1

- marca CDSE Solar;
- folio y vigencia;
- cliente y ubicación;
- sistema recomendado;
- inversión/rango;
- ahorro y recuperación;
- CTA de validación.

### Página 2

- consumo histórico;
- generación estimada;
- supuestos;
- nivel de confianza;
- advertencias.

### Página 3 opcional

- partidas;
- garantías confirmadas;
- condiciones de pago;
- pasos para visita, validación e interconexión.

No se copiará la estructura definitiva de un competidor antes del análisis comparativo de fase 2.

## 12. Criterios de aceptación

1. Un visitante móvil puede iniciar y terminar el flujo.
2. El lead se guarda antes de revelar o enviar una propuesta completa.
3. Una falla del PDF no pierde el lead ni el cálculo.
4. Cada cotización tiene folio único y snapshots reproducibles.
5. El cálculo diferencia periodicidad mensual y bimestral.
6. El número de paneles se redondea hacia arriba.
7. GDMTH dispara revisión especializada.
8. Los parámetros y precios no están hardcodeados en la interfaz.
9. El recibo no es públicamente accesible.
10. WhatsApp incluye contexto suficiente para que ventas continúe.
11. Se registran UTM y eventos de conversión.
12. La interfaz identifica el resultado como preliminar.
13. La landing cumple navegación por teclado, etiquetas, errores accesibles y contraste AA.
14. `npm run build` termina correctamente.

## 13. Decisiones pendientes del negocio

- audiencia inicial: hogar, negocio o ambos;
- área exacta de servicio;
- mostrar precio inmediato o después de validación;
- personalidad de marca solar;
- paneles, inversores y garantías;
- precio por watt o partidas;
- IVA incluido o desglosado;
- cobertura objetivo;
- esquemas de pago;
- responsable y SLA de seguimiento;
- dirección, teléfono y datos legales definitivos.

## 14. Fuentes técnicas iniciales

- CFE, Tarifa DAC: https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCREHogar/Tarifas/TarifaDAC.aspx
- CFE, Tarifa PDBT: https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCRENegocio/Tarifas/PequenaDemandaBT.aspx
- CFE, Tarifa GDMTH: https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCREIndustria/Tarifas/GranDemandaMTH.aspx/
- NLR/NREL, PVWatts V8 API: https://developer.nrel.gov/docs/solar/pvwatts/v8/
- Resolución RES/142/2017 sobre contraprestación de generación distribuida:
  https://beta.cfe.mx/negocio/nuevocontrato/Documents/Resoluci%C3%B3n%20RES-142-2017%20Disposiciones%20Administrativas%20de%20car%C3%A1cter%20general%2C%20los%20modelos%20de%20contrato%2C%20la%20metodolog%C3%ADa%20de%20c%C3%A1lculo%20de%20contraprestaci%C3%B3n%20y%20las%20especificaciones%20t%C3%A9cnicas%20generales%2C%20aplicables%20a%20las%20centrales.pdf
