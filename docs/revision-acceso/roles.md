# Revisión de acceso de los cinco roles base

Esta auditoría de T-068 compara el catálogo de permisos y su tabla 3.3 con los requisitos funcionales, `roles_sistema()` y las dependencias `require_permiso` de la API. La tabla 3.3 es la fuente de verdad de la matriz; los RF determinan si cada asignación es suficiente y si respeta mínimo privilegio.

## Matriz final permiso por rol

| Permiso | Descripción efectiva en la API | REP | TEC | COO | DIR | ADM | RF Debe habilitado | Tabla 3.3 | Código antes | Decisión final |
| --- | --- | :---: | :---: | :---: | :---: | :---: | --- | --- | --- | --- |
| `incidencias:crear` | `POST /incidencias` | Sí | Sí | Sí | No | Sí | RF-REP-01, RF-REP-02, RF-REP-06 | Igual | Igual | Conservar |
| `incidencias:ver` | Listado, detalle y descarga de evidencia, siempre con alcance | Sí | Sí | Sí | Sí | Sí | RF-REP-07, RF-REP-08, RF-TEC-01, RF-COO-01, RF-DIR-05 | Igual | Igual | Conservar |
| `incidencias:asignar` | `PATCH /incidencias/{id}/asignacion` | No | No | Sí | No | Sí | RF-COO-02 | Igual | Igual | Conservar |
| `incidencias:buscar` | Búsqueda de texto de incidencias | No | Sí | Sí | Sí | Sí | RF-TEC-06, RF-DIR-05 | Igual | Igual | Conservar |
| `evidencias:subir` | Crear firma y registrar evidencia | Sí | Sí | Sí | No | Sí | RF-REP-03, RF-REP-05, RF-TEC-05 | Igual | Igual | Conservar |
| `seguimiento:registrar` | Cambiar estado, horas y comentario | No | Sí | Sí | No | Sí | RF-TEC-02, RF-TEC-03, RF-COO-03, RF-COO-04 | Igual | Igual | Conservar |
| `tags:gestionar` | Agregar o quitar etiquetas | No | Sí | Sí | No | Sí | RF-TEC-04 | Igual | Igual | Conservar |
| `analitica:ver` | Métricas por edificio y etiquetas | No | No | Sí | Sí | Sí | RF-COO-05, RF-DIR-01, RF-DIR-02, RF-DIR-03 | Igual | Igual | Conservar |
| `ia:usar` | Analizar una imagen con IA | Sí | Sí | Sí | No | Sí | Ninguno en prioridad Debe; RF-REP-04 es Debería | Igual | Igual | Conservar por la tabla vigente |
| `usuarios:gestionar` | Crear, listar y editar usuarios | No | No | No | No | Sí | RF-ADM-01 | Igual | Igual | Conservar |
| `roles:gestionar` | Crear, listar, editar y eliminar roles personalizados | No | No | No | No | Sí | RF-ADM-02 | Igual | Igual | Conservar y completar la API |
| `categorias:gestionar` | Capacidad administrativa reservada para categorías | No | No | No | No | Sí | Ninguno en prioridad Debe; RF-ADM-03 es Debería | Igual | Igual | Conservar por la tabla vigente; endpoint de escritura fuera de T-068 |

Las claves significan: REP reportante, TEC técnico, COO coordinador, DIR directivo y ADM administrador. Los cinco roles contienen exclusivamente las asignaciones de esta tabla.

## Alcance por rol

- **REP, alcance `propio`:** crea incidencias, consulta sus reportes, adjunta evidencias y usa IA. No accede a búsqueda global, seguimiento, asignación, analítica ni administración.
- **TEC, alcance `area`:** conserva las capacidades de reporte y agrega seguimiento, etiquetas y búsqueda para atender incidencias de sus áreas. No asigna, consulta analítica ni administra catálogos o identidades.
- **COO, alcance `area`:** añade asignación y analítica a las capacidades operativas. `seguimiento:registrar` habilita el cierre `resuelta → cerrada` de RF-COO-04; no se creó un permiso más amplio ni uno redundante.
- **DIR, alcance `global`:** solo consulta incidencias, búsqueda y analítica. `incidencias:buscar` es necesario para RF-DIR-05; no recibe creación, evidencias, seguimiento, etiquetas, asignación ni administración.
- **ADM, alcance `global`:** recibe el catálogo completo para los RF administrativos y operativos. No puede alterar ni eliminar los cinco roles base: `roles:gestionar` no absorbe esa restricción estructural.

## Inventario de comprobaciones reales

La API comprueba mediante `require_permiso` los permisos `incidencias:crear`, `incidencias:ver`, `incidencias:asignar`, `incidencias:buscar`, `evidencias:subir`, `seguimiento:registrar`, `tags:gestionar`, `analitica:ver`, `usuarios:gestionar`, `roles:gestionar` e `ia:usar`. Los nombres coinciden exactamente con el catálogo y no hay comprobaciones con alias.

`categorias:gestionar` está definido y asignado únicamente a ADM, pero todavía no se comprueba porque la API actual solo expone lectura autenticada de categorías. Se conserva para la futura escritura de RF-ADM-03, cuya prioridad es Debería; no habilita hoy una ruta sensible. No se encontraron rutas de incidencias, analítica, usuarios o roles que dependan solo de autenticación cuando requieren autorización.

## Decisiones y discrepancias resueltas

1. La matriz de `roles_sistema()` ya coincidía exactamente con la tabla 3.3; no se añadieron permisos. En particular, DIR conserva `incidencias:buscar` por RF-DIR-05 y sigue siendo de solo lectura, REP sigue sin `analitica:ver`, y COO conserva `seguimiento:registrar` para RF-COO-04.
2. RF-ADM-02 decía crear y editar roles, pero la API solo implementaba listado y creación. Se añadieron `PATCH /roles/{rol_id}` y `DELETE /roles/{rol_id}` para roles personalizados. El borrado completa la administración segura y aplica V-ROL-09: un rol asignado a usuarios devuelve 409.
3. V-ROL-08 ya fijaba 409 para intentar cambiar o borrar un rol base. La API usa ese contrato tanto para edición como para borrado, incluso para ADM.
4. La inicialización anterior usaba `$setOnInsert`; por ello no reparaba permisos o marcas obsoletos en instalaciones existentes. La semilla ahora sincroniza por la clave estable con `$set`, conserva `_id` y referencias de usuarios, no duplica roles y puede ejecutarse repetidamente con el mismo resultado.

## Inmutabilidad de los roles base

Cada rol base persiste con `sistema: true` y una clave estable (`reportante`, `tecnico`, `coordinador`, `directivo`, `admin`). Los cuerpos de edición no aceptan el campo `sistema`. Antes de modificar o borrar, el servidor lee el documento por `_id` y rechaza si la marca es verdadera; la operación atómica repite `sistema != true` en su filtro para impedir una carrera. Por ello no es posible degradar un rol base, cambiarle la clave para eludir la protección, modificar sus permisos mediante el endpoint genérico ni eliminarlo.

Los roles personalizados se crean con `sistema: false`, pueden editarse dentro de los permisos y alcance que el actor puede otorgar, y pueden eliminarse cuando ningún usuario los tiene asignados. Para no dejar referencias huérfanas, tampoco se puede cambiar la clave de un rol que esté asignado.

## Riesgos y asuntos fuera del alcance

- La edición concurrente de roles personalizados no tiene control de versión; no afecta la inmutabilidad de los roles base.
- `categorias:gestionar` seguirá sin una ruta de escritura hasta implementar RF-ADM-03.
- La auditoría administrativa de cambios de roles corresponde a RF-ADM-05 y continúa fuera de T-068.
