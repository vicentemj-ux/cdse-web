# CDSE Solar — guía de expediente, levantamiento y recursos

Versión operativa: 8 de agosto de 2026.

## 1. Propósito

Esta guía explica cómo pasar de una venta cerrada a un expediente técnicamente
revisado y listo para presentar. No sustituye los formatos vigentes ni la
confirmación del procedimiento con la oficina de CFE que recibirá la solicitud.

El portal protege la transición con tres condiciones:

1. levantamiento técnico aprobado;
2. ingeniería aprobada y vinculada a un diagrama unifilar aprobado;
3. documentos base regulatorios, condicionales e internos completos.

Mientras una condición falte, el servidor no permite marcar el proyecto como
`ready_for_submission`. Para marcarlo `submitted_to_cfe` también exige el folio
de seguimiento.

## 2. Secuencia de trabajo

### Antes de la visita

- confirmar titular, número de servicio y domicilio;
- validar que el recibo utilizado corresponda al centro de carga;
- programar visita con fecha, responsable y ubicación;
- solicitar acceso a techo, tablero, acometida y medidor;
- revisar equipo de protección y condiciones de trabajo en altura.

### Durante el levantamiento

El técnico puede guardar un borrador desde el teléfono. Para enviarlo a revisión
debe completar como mínimo:

- fecha y responsable;
- tipo, condición y área útil del techo;
- orientación, inclinación y sombras;
- tipo de servicio, voltaje e interruptor principal;
- condición del tablero;
- disponibilidad de tierra física;
- acceso al medidor;
- longitud estimada de la ruta eléctrica;
- observaciones estructurales, eléctricas y de seguridad.

Las fotografías de techo, tablero, acometida, medidor, ruta y riesgos deben
cargarse dentro del requisito **Levantamiento técnico**. El formulario describe
el hallazgo; la evidencia visual permite comprobarlo.

### Revisión del levantamiento

El administrador revisa consistencia y evidencia. Puede:

- aprobar la versión;
- devolverla con una corrección concreta;
- conservar versiones anteriores en la bitácora.

Al corregir una versión aprobada se crea una nueva versión; el historial previo
no se sobrescribe.

### Ingeniería

La revisión técnica registra:

- cantidad y modelo de paneles;
- potencia DC total;
- modelo, cantidad y potencia AC de inversores;
- relación DC/AC;
- strings y distribución MPPT;
- protecciones DC y AC;
- conductores y canalización;
- puesta a tierra;
- notas de diseño.

La relación DC/AC no puede superar 120%. Para enviar una revisión de ingeniería
debe existir un diagrama unifilar aprobado en el expediente. La aprobación de la
ingeniería no sustituye las fichas técnicas ni el certificado del inversor.

## 3. Núcleo documental para interconexión

El índice distingue el origen de cada documento:

- **Regulatorio:** forma parte del núcleo documental aplicable.
- **Condicional:** se solicita sólo cuando la representación, titularidad,
  inmueble o procedimiento lo requiere.
- **Control CDSE:** protege la ejecución, seguridad, calidad o administración.

El núcleo configurado incluye solicitud y anexos, croquis, diagrama unifilar,
ficha del módulo, ficha y certificado del inversor, recibo cuando aplique, acuse,
contrato/evidencia posterior y medidor bidireccional. La oficina receptora debe
confirmar la versión vigente de sus formatos.

## 4. Recursos generados por proyecto

### Reporte de levantamiento

Documento A4 de dos páginas con datos de campo, resultado de revisión,
observaciones y espacios de validación. Se genera desde la versión más reciente,
priorizando la versión aprobada.

### Carta de autorización para gestión

Formato precargado con cliente, servicio, domicilio y responsable CDSE. Es un
recurso **condicional**: no debe presentarse como requisito universal ni usarse
sin validar su alcance y firma con el procedimiento aplicable.

### Índice del expediente

Muestra puertas técnicas, cada requisito, origen, estado, versión y cantidad de
archivos. En la última página resume los pendientes y el siguiente hito.

### Exportación ZIP

El ZIP se construye localmente en el navegador con enlaces privados temporales.
Contiene:

```text
00_Control/
  indice-expediente.pdf
  carta-autorizacion-condicional.pdf
  manifest.json
01_Comercial/
02_Levantamiento/
  reporte-levantamiento.pdf
03_Ingenieria/
04_CFE/
05_Instalacion/
06_Entrega/
LEEME.txt
```

`manifest.json` conserva folio, estado, puertas técnicas, versiones, rutas del
paquete, tamaño y huella SHA-256 de cada archivo fuente.

## 5. Privacidad y trazabilidad

- Los archivos permanecen en un bucket privado.
- Los enlaces de lectura son temporales.
- Abrir un documento, generar un recurso o exportar el expediente crea un evento
  en la bitácora del proyecto.
- El ZIP puede contener recibos, identificaciones, firmas y domicilio; no debe
  publicarse ni compartirse mediante enlaces abiertos.
- Para expedientes mayores a 125 MB, el portal pide usar una computadora para
  evitar pérdida de memoria en el navegador móvil.

## 6. Criterio de entrega a CFE

Antes de ingresar una solicitud, el responsable debe comprobar:

- visita e ingeniería aprobadas;
- documentos base marcados completos;
- nombres y número de servicio consistentes;
- equipos del unifilar iguales a fichas y certificados;
- carta de autorización sólo cuando aplique;
- índice descargado y revisado;
- formato vigente confirmado con la oficina receptora;
- copia del paquete entregado;
- acuse, fecha y folio cargados inmediatamente después de la recepción.

El estado `submitted_to_cfe` representa una entrega demostrable, no sólo la
intención de presentar el expediente.
