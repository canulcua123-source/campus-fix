# T-068 · Revisión de roles y permisos

Fecha de revisión: 23 de octubre de 2026.

## Fuentes y criterio

La revisión se hizo contra `docs/UTM_Desk_Documentacion_Proyecto.docx`, versión 2.0:

- tabla 3.1: alcances `propio`, `area`, `edificio` y `global`;
- tabla 3.2: alcance de los cinco roles base;
- tabla 3.3: catálogo de permisos por rol;
- V-ROL-01 a V-ROL-12;
- RF-GEN-03, RF-REP-01 a RF-REP-12, RF-TEC-01 a RF-TEC-09,
  RF-COO-01 a RF-COO-08, RF-DIR-01 a RF-DIR-06 y RF-ADM-01 a RF-ADM-06;
- matriz de ruta o acción por rol y tabla de transiciones de estado.

En el código se revisaron `CATALOGO_PERMISOS`, `roles_sistema()`,
`require_permiso()`, `puede_otorgar()`, `filtro_alcance()` y las protecciones de
los routers de incidencias, analítica, usuarios y roles.

En la matriz, cada celda muestra **documento / código**. `Sí / Sí` indica que el
permiso aparece tanto en la tabla 3.3 como en la definición base actual; `— / —`
indica que no se asigna en ninguno de los dos.

## Matriz permiso × rol

| Permiso | REP | TEC | COO | DIR | ADM | Resultado |
|---|---:|---:|---:|---:|---:|---|
| `incidencias:crear` | Sí / Sí | Sí / Sí | Sí / Sí | — / — | Sí / Sí | Coincide |
| `incidencias:ver` | Sí / Sí | Sí / Sí | Sí / Sí | Sí / Sí | Sí / Sí | Coincide |
| `incidencias:asignar` | — / — | — / — | Sí / Sí | — / — | Sí / Sí | Coincide |
| `incidencias:buscar` | — / — | Sí / Sí | Sí / Sí | Sí / Sí | Sí / Sí | Coincide |
| `evidencias:subir` | Sí / Sí | Sí / Sí | Sí / Sí | — / — | Sí / Sí | Coincide |
| `seguimiento:registrar` | — / — | Sí / Sí | Sí / Sí | — / — | Sí / Sí | Coincide |
| `tags:gestionar` | — / — | Sí / Sí | Sí / Sí | — / — | Sí / Sí | Coincide |
| `analitica:ver` | — / — | — / — | Sí / Sí | Sí / Sí | Sí / Sí | Coincide |
| `usuarios:gestionar` | — / — | — / — | — / — | — / — | Sí / Sí | Coincide |
| `roles:gestionar` | — / — | — / — | — / — | — / — | Sí / Sí | Coincide |
| `categorias:gestionar` | — / — | — / — | — / — | — / — | Sí / Sí | Coincide |
| `ia:usar` | Sí / Sí | Sí / Sí | Sí / Sí | — / — | Sí / Sí | Coincide |

Conclusión de la matriz: las doce entradas de `CATALOGO_PERMISOS` y sus
asignaciones coinciden exactamente con la tabla 3.3. No se modificó
`roles_sistema()` porque no existe una discrepancia documental que lo justifique.

## Trazabilidad de los RF obligatorios

| Rol | RF/operación relevante | Permiso y control real | Resultado |
|---|---|---|---|
| REP | Crear y consultar sus incidencias; adjuntar evidencias; usar IA | `incidencias:crear`, `incidencias:ver`, `evidencias:subir`, `ia:usar`; alcance `propio` | Cubierto por la matriz |
| TEC | Consultar su bandeja, dar seguimiento, etiquetar, adjuntar evidencia y buscar | `incidencias:ver`, `seguimiento:registrar`, `tags:gestionar`, `evidencias:subir`, `incidencias:buscar`; alcance `area` | Cubierto por la matriz |
| COO | Tablero, asignación, seguimiento, cierre y analítica de su área | Permisos del técnico más `incidencias:asignar` y `analitica:ver`; alcance `area` | Cubierto por la matriz |
| DIR | Buscar y consultar cualquier incidencia en solo lectura; ver analítica global | `incidencias:ver`, `incidencias:buscar`, `analitica:ver`; alcance `global` | Cubierto y sin permisos de escritura |
| ADM | Administrar usuarios, roles y categorías | `usuarios:gestionar`, `roles:gestionar`, `categorias:gestionar`; además recibe todo el catálogo actual | Cubierto a nivel de permisos |

### Decisiones y brechas observadas

1. **RF-COO-04, cierre de incidencias.** El endpoint
   `PATCH /incidencias/{id}/seguimiento` exige `seguimiento:registrar`. Cuando el
   estado solicitado es `cerrada`, exige además `incidencias:asignar`. El
   coordinador y el administrador poseen ambos permisos; el técnico solo posee el
   primero y recibe 403 al intentar cerrar. El filtro atómico solo permite la
   transición `resuelta → cerrada` y también aplica el alcance del actor. No hace
   falta un permiso nuevo ni un cambio de transición.
2. **RF-DIR-05, búsqueda en solo lectura.** El directivo necesita
   `incidencias:buscar`, además de `incidencias:ver`, y ambos están presentes. No
   tiene `incidencias:crear`, `evidencias:subir`, `seguimiento:registrar`,
   `tags:gestionar`, `incidencias:asignar` ni permisos administrativos. Se
   conserva como rol global de solo lectura más analítica.
3. **RF-COO-03, cambio de prioridad.** La asignación de permisos es coherente con
   la tabla 3.3, pero el endpoint de seguimiento actual no recibe una prioridad.
   Es una brecha funcional preexistente; T-068 no autoriza ampliar ese contrato.
4. **RF-ADM-02, edición de roles.** `roles:gestionar` protege correctamente
   `GET /roles` y `POST /roles`, pero actualmente no existe una ruta para editar
   roles. El permiso está correctamente asignado, aunque el RF no está completo a
   nivel de funcionalidad. No se creó un endpoint artificial durante esta tarea.
5. **RF-GEN-03.** El backend entrega y aplica permisos por rol. La revisión de las
   guardas y menús del frontend pertenece a T-071, por lo que no se modificó la UI.

## Alcances base

| Rol | Documento | `roles_sistema()` | Resultado |
|---|---|---|---|
| Reportante | `propio` | `propio` | Coincide |
| Técnico | `area` | `area` | Coincide |
| Coordinador | `area` | `area` | Coincide |
| Directivo | `global` | `global` | Coincide |
| Administrador | `global` | `global` | Coincide |

Esta comprobación se limita a la configuración base. La auditoría exhaustiva de
`filtro_alcance()` por endpoint corresponde a T-069.

## Protección de los roles del sistema

- Los cinco documentos semilla llevan `sistema: true`.
- La API expone únicamente `GET /roles` y `POST /roles`; no existen rutas públicas
  `PATCH`, `PUT`, `DELETE` ni de desactivación. Por ello, actualmente no hay una
  vía de API para modificar o eliminar un rol base.
- `RolIn` usa `extra="forbid"` y no acepta el campo `sistema`; además, el alta
  siempre guarda `sistema: false`. Un cliente no puede crear un rol personalizado
  que se presente como rol del sistema.
- Tanto listar como crear requiere `roles:gestionar`. `puede_otorgar()` impide
  conceder permisos o alcance superiores a los del actor.
- El índice único de `roles.clave` y el manejo de `DuplicateKeyError` rechazan con
  409 la suplantación de una clave ya existente, incluidas las cinco claves base.

La regla V-ROL-08 permanece marcada en el documento como pendiente para futuros
endpoints de edición o borrado. Si esas rutas se implementan, deberán rechazar
cualquier documento con `sistema: true` en el backend; ocultar controles en el
frontend no será suficiente.

## Definición base frente a documentos persistidos

`sembrar_base()` usa `$setOnInsert`. Por tanto:

1. `roles_sistema()` define el valor esperado para instalaciones nuevas;
2. un rol que ya existe en MongoDB no se actualiza al volver a ejecutar
   `init_db.py`;
3. esta revisión no consultó ni modificó Atlas, así que no afirma que una base
   persistida concreta coincida con la definición actual.

No hace falta una migración para esta auditoría porque la definición base ya
coincide con la documentación. Si en el futuro se detecta deriva en una base
existente, la estrategia segura es un script separado, idempotente y en modo
simulación por defecto: comparar únicamente las cinco claves conocidas, mostrar
el antes/después, exigir respaldo y confirmación explícita para aplicar, actualizar
solo los campos aprobados y no tocar roles personalizados ni usuarios. Nunca debe
reemplazarse globalmente `$setOnInsert` por `$set`.

