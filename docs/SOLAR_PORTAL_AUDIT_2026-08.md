# Auditoría vigente del portal CDSE Solar — agosto de 2026

Fecha de revisión: 8 de agosto de 2026. Evidencia: esquema remoto hasta la
migración `202608080011`, componentes publicados, 22 pruebas automatizadas,
compilación de 554 rutas y documentación operativa del repositorio.

## Veredicto de patrones de interfaz

**Aprobado con deuda técnica.** La interfaz no parece un CRM genérico generado
por IA: conserva una dirección editorial propia, paleta cálida/marino, jerarquía
tipográfica consistente y superficies planas. Evita glassmorphism, neón,
gradientes de texto y cuadrículas repetitivas de tarjetas.

La deuda visible no es estética sino de escala: `SolarPortal.jsx` supera 2,400
líneas y la barra móvil expone cada módulo en una sola fila desplazable. Los
diálogos nativos `prompt/confirm` aparecen en decisiones auditables y no ofrecen
contexto, validación en línea ni recuperación clara.

## Resumen ejecutivo

- 0 bloqueos críticos vigentes en el flujo implementado.
- 2 hallazgos altos: inventario comprometido/consumido incompleto y perfiles
  globales limitados a administrador/vendedor.
- 4 hallazgos medios: navegación móvil, búsqueda global, accesibilidad de foco y
  tamaño del módulo principal.
- 3 hallazgos bajos: diálogos nativos, colores de aviso fuera de tokens y falta
  de una política automatizada de retención.
- Calidad funcional de fases 1–5: **8.4/10**.
- Cobertura del objetivo completo: **8.5/10**.

## Evidencia de requisitos ya logrados

| Requisito | Estado | Evidencia autoritativa |
|---|---|---|
| Venta crea proyecto operativo | Logrado | `provision_solar_project_for_quote`, `solar_projects` |
| Snapshot de alcance y precio | Logrado | `sold_scope_snapshot`, importes antes de IVA congelados |
| Expediente privado y versionado | Logrado | documentos, archivos, RLS, ZIP y manifiesto SHA-256 |
| Carta de autorización y recursos PDF | Logrado | `project-documents.js` y pruebas de documentos |
| Levantamiento e ingeniería | Logrado | revisiones estructuradas y puerta DC/AC ≤ 120% |
| Puerta antes de ingresar a CFE | Logrado | migraciones `008` y `009`, folio obligatorio |
| Agenda y responsables | Logrado | `solar_project_tasks` y vista Agenda |
| Órdenes, cuadrillas y seguridad | Logrado | migración `007`, orden móvil, checklist e incidencias |
| Cambio de medidor e interconexión | Logrado | `solar_cfe_cases`, observaciones y contratos |
| Comisión 5–10% antes de IVA | Logrado | libro, hitos, aprobación, pago, reverso y recuperación |
| Costos y margen | Logrado | migraciones `010`/`011`, reporte por periodo y CSV |
| Postventa y garantías | Logrado | migración `012`, activos, casos, generación y seguimiento |

## Hallazgos altos

### A1. Material comprometido y consumido no tiene libro propio

**Ubicación:** instalación y finanzas.

**Impacto:** los costos reales pueden capturarse, pero no se sabe qué panel,
inversor, protección o estructura se reservó, entregó, consumió, devolvió o quedó
con número de serie en el sitio.

**Recomendación:** reservas y movimientos inmutables por orden; la salida debe
convertir equipos serializables en activos de postventa.

### A2. El perfil global no representa todas las funciones

**Ubicación:** `solar_profiles` y administración de usuarios.

**Impacto:** la membresía por proyecto ya admite operaciones, ingeniería,
instalador, finanzas y consulta, pero el alta de usuarios y la navegación sólo
modelan administrador/vendedor. No puede delegarse el trabajo sin entregar una
superficie más amplia de la necesaria.

**Recomendación:** separar perfil global de función por proyecto y aplicar
permisos por acción, manteniendo administración financiera restringida.

## Hallazgos medios

### M1. Navegación móvil pierde contexto

Diez módulos compiten en una barra horizontal. En teléfonos el usuario puede no
descubrir Postventa o Administración. Debe agruparse en Inicio, Ventas, Proyectos,
Operación y Más, sin ocultar funciones.

### M2. Falta búsqueda transversal

Cada módulo tiene filtros propios, pero no existe una búsqueda por cliente,
teléfono, folio de cotización/proyecto/CFE, número de servicio o serie instalada.

### M3. El foco de teclado es inconsistente

Los campos muestran foco, pero botones y enlaces no tienen una regla global
`:focus-visible`. Varios botones de texto tienen objetivos menores a 44 px fuera
de móvil. Impacta WCAG 2.4.7/2.4.11 y operación con teclado.

### M4. El módulo principal dificulta mantener calidad

`SolarPortal.jsx` concentra 2,400+ líneas y produce un bundle aproximado de 433
KB sin comprimir. Instalaciones y CFE ya están separados; Finanzas, Ventas,
Proyectos y Administración deben seguir la misma estrategia con carga diferida.

## Hallazgos bajos

- `window.prompt/confirm` se usa en 13 decisiones críticas; sustituirlo por
  formularios contextuales accesibles y con motivo persistente visible.
- Dos estilos de advertencia usan colores hexadecimales directos; convertirlos a
  tokens semánticos de advertencia.
- La clasificación y texto de retención existen, pero falta un proceso de
  vencimiento/supresión revisable; no debe automatizarse sin política legal aprobada.

## Patrones sistémicos y fortalezas

Fortalezas a conservar:

- fuentes de verdad históricas mediante snapshots y movimientos compensatorios;
- RLS por proyecto y almacenamiento privado;
- puertas que explican evidencia faltante;
- importes financieros separados antes/con IVA;
- tolerancia móvil y offline para checklist de campo;
- identidad visual local, sobria y reconocible.

Patrones a corregir:

- crecimiento monolítico del componente raíz;
- autorización contextual mediante diálogos del navegador;
- acciones de texto pequeñas fuera de la clase de botón principal;
- documentación de auditoría que debe actualizarse con cada fase.

## Prioridad de ejecución

1. **Inmediato:** inventario comprometido/consumido y series desde la orden.
2. **Siguiente:** perfiles funcionales, búsqueda global y navegación móvil agrupada.
3. **Después:** integración opcional con portales de monitoreo.
4. **Calidad continua:** reemplazo de diálogos y división progresiva del bundle.

La auditoría no constituye dictamen legal, fiscal, laboral ni eléctrico. La
validación de formatos CFE locales y política de retención sigue siendo una
actividad operativa de CDSE, no una condición que el software pueda presumir.
