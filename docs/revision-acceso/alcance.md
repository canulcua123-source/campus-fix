# Revisión de acceso por alcance

La auditoría de T-069 concluye que el alcance de incidencias coincide con la documentación para los cinco roles base y para roles personalizados con alcance `edificio`. Listados, búsqueda, detalle, escrituras, evidencias y analítica aplican el filtro antes de devolver o modificar datos. Se corrigieron dos discrepancias en usuarios: el listado delegado filtraba después de leer el directorio completo y `PATCH /usuarios/{id}` distinguía con 403 a un objetivo existente no gestionable. El comportamiento final limita la consulta en MongoDB y devuelve el mismo 404 que para un ID inexistente.

## Fuente de verdad y semántica

La comparación usa las secciones 4.1 a 4.5, los RF por rol y la sección 12.8 de `docs/UTM_Desk_Documentacion_Proyecto.docx`. En la documentación vigente la tabla de tipos de alcance está en 4.1; la referencia original del issue a 3.1 corresponde a una numeración anterior.

| Alcance | Filtro de incidencias | Datos del usuario | Semántica verificada |
| --- | --- | --- | --- |
| `propio` | `reportante.usuario_id == usuario._id` | `_id` BSON `ObjectId` | El propietario es quien creó el reporte; no se usa el nombre ni un ID enviado por el cliente. |
| `area` | `categoria in usuario.areas` | `areas[]` con claves de categoría | En este modelo el área operativa se representa por la categoría responsable (`computo_redes`, `infraestructura`, `academico`). |
| `edificio` | `ubicacion.edificio in usuario.edificios` | `edificios[]` de texto | Coincide por el mismo texto normalizado que persiste la incidencia. Se verificó con el rol personalizado de prueba `jefe_edificio`. |
| `global` | `{}` | No requiere dimensión | Puede alcanzar todas las incidencias, pero cada acción todavía exige su permiso. |

No existe una dimensión de organización o tenant en el modelo actual. `tecnico_asignado.usuario_id` no sustituye al alcance: restringe quién puede registrar seguimiento cuando ya hay una asignación. El estado limita transiciones y cierre, pero no amplía visibilidad. Las evidencias heredan siempre el alcance de la incidencia padre. Los `_id`, `reportante.usuario_id`, `tecnico_asignado.usuario_id`, `historial_seguimiento.usuario_id` y `subido_por` se guardan y comparan como BSON `ObjectId`; los IDs de evidencia son UUID en texto.

La creación no recibe un ID de recurso existente y fija el propietario desde el usuario autenticado. Por ello `POST /incidencias` se gobierna por `incidencias:crear`, no por un filtro de lectura sobre la categoría o el edificio elegidos. Esto permite que un técnico reporte una falla de otra especialidad como reportante, sin darle visibilidad posterior fuera de su alcance operativo.

## Política 401 403 y 404

- `401` significa que falta una sesión válida.
- `403` significa que el rol carece de la capacidad general y la respuesta no confirma un recurso concreto; por ejemplo, DIR intentando agregar etiquetas o REP intentando abrir analítica.
- `404` se usa cuando una ruta señala un recurso concreto que no debe ser visible. El status y el cuerpo son iguales para un ID inexistente y para uno existente fuera de alcance.
- Una restricción de acción sobre un recurso ya visible puede conservar `403`; por ejemplo, un técnico ve una incidencia de su área pero no puede modificarla si está asignada a otro técnico.

Esta decisión prioriza BOLA y coincide con las convenciones actuales de `docs/reglas/API.md` y con la documentación del proyecto. No se sustituyeron indiscriminadamente respuestas 403 por 404.

## Inventario de aplicación

- `GET /incidencias`: combina filtros del cliente y alcance con `$and` antes de ordenar y aplicar `limit`; no hay total ni metadatos de paginación que puedan filtrar conteos.
- `GET /incidencias/buscar`: combina `$text` y alcance antes de calcular relevancia, ordenar y limitar.
- `GET /incidencias/{id}`: `_en_alcance` consulta por `_id` y alcance. La consulta posterior de nombres se limita a los autores ya referenciados en el historial autorizado y proyecta solo `nombre`.
- `PATCH /incidencias/{id}/seguimiento`: el filtro atómico incluye `_id`, estado de origen, tope de horas, alcance y, cuando corresponde, técnico asignado.
- `POST|DELETE /incidencias/{id}/tags`: la actualización atómica incluye `_id` y alcance.
- `PATCH /incidencias/{id}/asignacion`: comprueba el alcance del coordinador, que la incidencia también esté dentro del alcance del técnico y repite el alcance en la escritura atómica.
- `POST /incidencias/{id}/evidencias/firma`, `POST /incidencias/{id}/evidencias` y `GET /incidencias/{id}/evidencias/{evidencia_id}/url`: autorizan primero la incidencia padre; el registro repite el alcance en el `update_one`.
- `GET /analitica/edificios` y `GET /analitica/tags`: ambos pipelines empiezan con `$match` de alcance, antes de `$project`, `$unwind`, `$group`, `$sort` y `$limit`. No usan `$lookup`, `$unionWith` ni `$facet`.
- `GET /usuarios`: después de la corrección consulta solo roles, áreas o edificios gestionables antes de ordenar. Incluye el perfil propio únicamente para editar el nombre.
- `POST /usuarios`: `puede_otorgar` impide conceder permisos, dimensión o valores por encima del actor.
- `PATCH /usuarios/{id}`: consulta y actualiza con el mismo filtro gestionable; autoedición de rol, áreas, edificios o desactivación permanece bloqueada.
- `GET|POST /roles` aplica permiso y jerarquía de otorgamiento. `GET /categorias` es un catálogo autenticado. `POST /ia/analizar-imagen` usa permiso y cupos del actor, sin leer una incidencia. `POST /auth/login` y `GET /auth/me` operan sobre la propia identidad. No existen endpoints de exportación ni operaciones masivas sobre incidencias.

La resincronización interna del folio consulta el último `codigo` de la fecha y categoría después de una colisión de índice único. No devuelve documentos ni acepta un filtro del cliente; es una operación de unicidad global, no una lectura de recursos del usuario.

## Matriz esperado contra comportamiento previo

`✔` indica coincidencia previa. `✘ corregido` identifica una discrepancia observada antes de esta rama; la columna Acción describe el resultado final.

| Rol | Endpoint | Método | Operación | Alcance esperado | Alcance real previo | Resultado | Prueba o evidencia | Acción |
| --- | --- | --- | --- | --- | --- | :---: | --- | --- |
| REP | `/incidencias` | POST | Crear | Capacidad; propietario forzado al actor | Igual | ✔ | `test_incidencias_crear.py`; código construye `reportante.usuario_id` | Sin cambio |
| TEC | `/incidencias` | POST | Crear | Capacidad; propietario forzado al actor | Igual | ✔ | Permiso base y creación tipada | Sin cambio |
| COO | `/incidencias` | POST | Crear | Capacidad; propietario forzado al actor | Igual | ✔ | Permiso base y creación tipada | Sin cambio |
| DIR | `/incidencias` | POST | Crear | Sin acceso | 403 por falta de permiso | ✔ | `test_rol_endpoint_alcance[DIR-crear]` | Sin cambio |
| ADM | `/incidencias` | POST | Crear | Capacidad global | Igual | ✔ | Permiso base | Sin cambio |
| REP | `/incidencias` | GET | Listar | `propio` | Filtro por `reportante.usuario_id` antes de ordenar/limitar | ✔ | `test_rol_endpoint_alcance[REP-listar]` | Sin cambio |
| TEC | `/incidencias` | GET | Listar | `area` | Filtro por categoría antes de ordenar/limitar | ✔ | `test_rol_endpoint_alcance[TEC-listar]` | Sin cambio |
| COO | `/incidencias` | GET | Listar | `area` | Filtro por categoría antes de ordenar/limitar | ✔ | `test_rol_endpoint_alcance[COO-listar]` | Sin cambio |
| DIR | `/incidencias` | GET | Listar | `global`, solo lectura | Sin restricción de incidencia; permiso presente | ✔ | `test_rol_endpoint_alcance[DIR-listar]` | Sin cambio |
| ADM | `/incidencias` | GET | Listar | `global` | Sin restricción de incidencia | ✔ | `test_rol_endpoint_alcance[ADM-listar]` | Sin cambio |
| REP | `/incidencias/buscar` | GET | Buscar | Sin acceso | 403 por falta de permiso | ✔ | `test_rol_endpoint_alcance[REP-buscar]` | Sin cambio |
| TEC | `/incidencias/buscar` | GET | Buscar | `area` | `$text` + categoría antes de score/limit | ✔ | `test_rol_endpoint_alcance[TEC-buscar]` | Sin cambio |
| COO | `/incidencias/buscar` | GET | Buscar | `area` | `$text` + categoría antes de score/limit | ✔ | `test_rol_endpoint_alcance[COO-buscar]` | Sin cambio |
| DIR | `/incidencias/buscar` | GET | Buscar | `global` | `$text` global | ✔ | `test_rol_endpoint_alcance[DIR-buscar]` | Sin cambio |
| ADM | `/incidencias/buscar` | GET | Buscar | `global` | `$text` global | ✔ | `test_rol_endpoint_alcance[ADM-buscar]` | Sin cambio |
| REP | `/incidencias/{id}` | GET | Detalle | `propio`; ajeno 404 | Igual | ✔ | `test_rol_endpoint_alcance[REP-detalle]` compara ajeno e inexistente | Sin cambio |
| TEC | `/incidencias/{id}` | GET | Detalle | `area`; otra área 404 | Igual | ✔ | `test_rol_endpoint_alcance[TEC-detalle]` | Sin cambio |
| COO | `/incidencias/{id}` | GET | Detalle | `area`; otra área 404 | Igual | ✔ | `test_rol_endpoint_alcance[COO-detalle]` | Sin cambio |
| DIR | `/incidencias/{id}` | GET | Detalle | `global`, solo lectura | Global | ✔ | `test_rol_endpoint_alcance[DIR-detalle]` | Sin cambio |
| ADM | `/incidencias/{id}` | GET | Detalle | `global` | Global | ✔ | `test_rol_endpoint_alcance[ADM-detalle]` | Sin cambio |
| REP | `/incidencias/{id}/seguimiento` | PATCH | Estado y horas | Sin acceso | 403 por falta de permiso | ✔ | `test_rol_endpoint_alcance[REP-seguimiento]` | Sin cambio |
| TEC | `/incidencias/{id}/seguimiento` | PATCH | Estado y horas | `area` + sin asignar o asignada al actor | Filtro atómico correcto; 403 si otro técnico visible la tiene asignada | ✔ | `test_rol_endpoint_alcance[TEC-seguimiento]`; `test_solo_el_tecnico_asignado_da_seguimiento` | Sin cambio |
| COO | `/incidencias/{id}/seguimiento` | PATCH | Estado y cierre | `area` | Área en filtro atómico | ✔ | `test_rol_endpoint_alcance[COO-seguimiento]` | Sin cambio |
| DIR | `/incidencias/{id}/seguimiento` | PATCH | Estado y horas | Sin acceso | 403 | ✔ | `test_rol_endpoint_alcance[DIR-seguimiento]` | Sin cambio |
| ADM | `/incidencias/{id}/seguimiento` | PATCH | Estado y cierre | `global` | Global con estado esperado en escritura | ✔ | `test_rol_endpoint_alcance[ADM-seguimiento]` | Sin cambio |
| REP | `/incidencias/{id}/tags` | POST/DELETE | Etiquetas | Sin acceso | 403 | ✔ | `test_rol_endpoint_alcance[REP-tags]` | Sin cambio |
| TEC | `/incidencias/{id}/tags` | POST/DELETE | Etiquetas | `area` | Área en `update_one` | ✔ | `test_rol_endpoint_alcance[TEC-tags]`; pruebas de tags | Sin cambio |
| COO | `/incidencias/{id}/tags` | POST/DELETE | Etiquetas | `area` | Área en `update_one` | ✔ | `test_rol_endpoint_alcance[COO-tags]` | Sin cambio |
| DIR | `/incidencias/{id}/tags` | POST/DELETE | Etiquetas | Sin acceso | 403 | ✔ | `test_rol_endpoint_alcance[DIR-tags]` | Sin cambio |
| ADM | `/incidencias/{id}/tags` | POST/DELETE | Etiquetas | `global` | Global | ✔ | `test_rol_endpoint_alcance[ADM-tags]` | Sin cambio |
| REP | `/incidencias/{id}/asignacion` | PATCH | Asignar técnico | Sin acceso | 403 | ✔ | `test_rol_endpoint_alcance[REP-asignacion]` | Sin cambio |
| TEC | `/incidencias/{id}/asignacion` | PATCH | Asignar técnico | Sin acceso | 403 | ✔ | `test_rol_endpoint_alcance[TEC-asignacion]` | Sin cambio |
| COO | `/incidencias/{id}/asignacion` | PATCH | Asignar técnico | `area`; técnico compatible | Área del actor y del técnico; escritura repite alcance | ✔ | `test_rol_endpoint_alcance[COO-asignacion]` | Sin cambio |
| DIR | `/incidencias/{id}/asignacion` | PATCH | Asignar técnico | Sin acceso | 403 | ✔ | `test_rol_endpoint_alcance[DIR-asignacion]` | Sin cambio |
| ADM | `/incidencias/{id}/asignacion` | PATCH | Asignar técnico | `global`; técnico compatible | Global; escritura atómica | ✔ | `test_rol_endpoint_alcance[ADM-asignacion]` | Sin cambio |
| REP | `/incidencias/{id}/evidencias/firma` y `/evidencias` | POST | Subir/registrar | `propio` | Incidencia padre por propio y alcance repetido al registrar | ✔ | `test_rol_endpoint_alcance[REP-firma]`; `test_firma_permisos_alcance` | Sin cambio |
| TEC | Mismos | POST | Subir/registrar | `area` | Incidencia padre por área | ✔ | `test_rol_endpoint_alcance[TEC-firma]` | Sin cambio |
| COO | Mismos | POST | Subir/registrar | `area` | Incidencia padre por área | ✔ | `test_rol_endpoint_alcance[COO-firma]` | Sin cambio |
| DIR | Mismos | POST | Subir/registrar | Sin acceso | 403 antes de consultar el recurso | ✔ | `test_rol_endpoint_alcance[DIR-firma]` | Sin cambio |
| ADM | Mismos | POST | Subir/registrar | `global` | Global | ✔ | `test_rol_endpoint_alcance[ADM-firma]` | Sin cambio |
| REP | `/incidencias/{id}/evidencias/{evidencia_id}/url` | GET | Descargar | `propio` | Hereda alcance padre | ✔ | `test_rol_endpoint_alcance[REP-evidencia]` | Sin cambio |
| TEC | Mismo | GET | Descargar | `area` | Hereda alcance padre | ✔ | `test_rol_endpoint_alcance[TEC-evidencia]` | Sin cambio |
| COO | Mismo | GET | Descargar | `area` | Hereda alcance padre | ✔ | `test_rol_endpoint_alcance[COO-evidencia]` | Sin cambio |
| DIR | Mismo | GET | Descargar | `global`, solo lectura | Global | ✔ | `test_rol_endpoint_alcance[DIR-evidencia]` | Sin cambio |
| ADM | Mismo | GET | Descargar | `global` | Global | ✔ | `test_rol_endpoint_alcance[ADM-evidencia]` | Sin cambio |
| REP | `/analitica/edificios`, `/analitica/tags` | GET | Agregar métricas | Sin acceso | 403 | ✔ | `test_rol_endpoint_alcance[REP-analitica]` | Sin cambio |
| TEC | Mismos | GET | Agregar métricas | Sin acceso | 403 | ✔ | `test_rol_endpoint_alcance[TEC-analitica]` | Sin cambio |
| COO | Mismos | GET | Agregar métricas | `area` | Primer `$match` por categoría | ✔ | `test_rol_endpoint_alcance[COO-analitica]` verifica edificios ausentes | Sin cambio |
| DIR | Mismos | GET | Agregar métricas | `global` | Primer `$match` global | ✔ | `test_rol_endpoint_alcance[DIR-analitica]` | Sin cambio |
| ADM | Mismos | GET | Agregar métricas | `global` | Primer `$match` global | ✔ | `test_rol_endpoint_alcance[ADM-analitica]` | Sin cambio |
| REP | `/usuarios` | GET/POST | Listar/crear | Sin acceso | 403 | ✔ | `test_usuarios_sin_permiso_403` | Sin cambio |
| TEC | `/usuarios` | GET/POST | Listar/crear | Sin acceso | 403 | ✔ | `test_usuarios_sin_permiso_403` | Sin cambio |
| COO | `/usuarios` | GET/POST | Listar/crear | Sin acceso | 403 | ✔ | Matriz de permisos | Sin cambio |
| DIR | `/usuarios` | GET/POST | Listar/crear | Sin acceso | 403 | ✔ | Matriz de permisos | Sin cambio |
| ADM | `/usuarios` | GET/POST | Listar/crear | `global` dentro de la jerarquía | Global y `puede_otorgar` | ✔ | `test_listar_usuarios`; `test_crear_usuario` | Sin cambio |
| REP | `/usuarios/{id}` | PATCH | Editar usuario | Sin acceso | 403 | ✔ | `test_usuarios_sin_permiso_403` | Sin cambio |
| TEC | `/usuarios/{id}` | PATCH | Editar usuario | Sin acceso | 403 | ✔ | `test_usuarios_sin_permiso_403` | Sin cambio |
| COO | `/usuarios/{id}` | PATCH | Editar usuario | Sin acceso | 403 | ✔ | Matriz de permisos | Sin cambio |
| DIR | `/usuarios/{id}` | PATCH | Editar usuario | Sin acceso | 403 | ✔ | Matriz de permisos | Sin cambio |
| ADM | `/usuarios/{id}` | PATCH | Editar usuario | Global; no autoescalado | Global, con restricciones de autoedición | ✔ | `test_patch_usuario`; `test_patch_usuario_errores` | Escritura ahora reutiliza filtro gestionable |
| Gestor delegado | `/usuarios` | GET | Listar gestionables | Misma dimensión, subconjunto de áreas/edificios y menos permisos | Leía todos con proyección y filtraba después en Python | ✘ corregido | `test_gestor_delegado_solo_ve_y_edita_su_ambito` | Filtro aplicado en `find` antes de ordenar |
| Gestor delegado | `/usuarios/{id}` | PATCH | Editar gestionable | Fuera de alcance e inexistente indistinguibles con 404 | Leía por ID y devolvía 403 al existente no gestionable | ✘ corregido | `test_patch_usuario_no_gestionable_404` | Consulta y `update_one` usan el mismo filtro; ambos casos devuelven `{"detail":"Usuario no encontrado"}` |

## Comportamiento final y seguimiento

Las dos filas marcadas con `✘ corregido` quedan cubiertas en esta rama. La prueba de no enumeración conserva copias de los documentos, compara status y cuerpo para ID fuera de alcance e inexistente, comprueba ausencia de correo, rol, área e identificadores, verifica que ninguna operación fallida modifique la base y confirma que el mismo actor todavía puede editar un usuario gestionable. La actualización incluye el filtro de alcance para evitar que un cambio concurrente convierta una comprobación previa en una escritura fuera de ámbito.

No se identificaron discrepancias que requieran un issue nuevo de producto o migración. La documentación vigente ya adopta 404 para BOLA; no queda una contradicción activa entre el contrato y el comportamiento final. Las capacidades F2 no implementadas (exportación, carga por técnico y tendencias adicionales) no exponen endpoints que auditar en esta versión.
