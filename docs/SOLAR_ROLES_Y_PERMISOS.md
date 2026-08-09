# Funciones y permisos de CDSE Solar

## Principio operativo

El acceso tiene dos condiciones simultáneas:

1. La función del integrante define los módulos y acciones disponibles.
2. La asignación activa define los proyectos que puede consultar u operar.

El administrador conserva acceso total. Ventas accede automáticamente a los proyectos vendidos por su propia cuenta; las demás funciones requieren asignación explícita desde **Equipo y accesos**.

## Matriz funcional

| Función | Áreas principales | Escritura permitida |
|---|---|---|
| Administrador | Todo el portal | Control total, autorizaciones, catálogo, cuentas y auditoría |
| Ventas | Cotización, oportunidades, proyectos propios, agenda, postventa y finanzas propias | Gestión comercial, tareas, documentos y seguimiento postventa |
| Operaciones | Proyectos asignados, agenda, instalaciones, inventario, CFE y postventa | Tareas, documentos, levantamiento, ejecución de instalación y postventa |
| Ingeniería | Proyectos asignados, agenda, inventario y consulta CFE | Tareas, documentos, levantamiento y revisiones de ingeniería |
| Instalación | Proyectos asignados, agenda, órdenes de instalación e inventario | Tareas, documentos y ejecución en campo |
| Finanzas | Proyectos asignados, agenda y finanzas | Tareas y captura de cobros para conciliación |
| Consulta | Proyectos y agenda asignados | Ninguna; lectura solamente |

## Separación de responsabilidades

- Sólo administración crea, suspende o restaura cuentas.
- Sólo administración asigna o retira acceso a un expediente.
- Los eventos de alta, suspensión, restauración, asignación y retiro quedan en `solar_access_events`.
- Los perfiles no administrativos no pueden cambiar su propia función.
- La tasa de comisión existe únicamente para ventas y debe mantenerse entre 5% y 10% sobre la base antes de IVA.
- Finanzas puede capturar un cobro, pero la conciliación y autorización final permanecen en administración.
- Operaciones, ingeniería e instalación pueden consultar inventario; los movimientos físicos y ajustes permanecen en administración en esta fase.
- La programación de órdenes y las decisiones formales de CFE permanecen en administración; el equipo asignado consulta y ejecuta su parte del flujo.

## Alta y asignación

1. Abrir **Equipo y accesos** con una cuenta administradora.
2. Crear el integrante, elegir su función y entregar la contraseña temporal por un canal seguro.
3. En **Acceso por expediente**, elegir integrante y proyecto.
4. Verificar la asignación activa en la lista inferior.
5. Al retirar acceso, el registro se desactiva sin borrar su historial.

## Implementación de seguridad

- La navegación se filtra en la interfaz para evitar acciones improcedentes.
- Las políticas RLS limitan la lectura a proyectos propios o asignados.
- Los disparadores de autorización verifican la acción y la función antes de insertar o modificar información crítica.
- Ocultar un control en la interfaz no sustituye la autorización en base de datos.

