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
4. **RF-ADM-02, edición de roles.** `roles:gestionar` protege `GET /roles`,
   `POST /roles`, `PATCH /roles/{rol_id}` y `DELETE /roles/{rol_id}`. Editar y
   eliminar solo aplican a roles personalizados (ver la sección siguiente).
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
- `PATCH /roles/{id}` y `DELETE /roles/{id}` rechazan con 409 cualquier rol con
  `sistema: true` (también para el administrador); la operación atómica repite
  `sistema != true` en el filtro para evitar carreras.
- Única excepción: un actor con `sistema:administrar` (superadmin) puede hacer
  `PATCH` **solo de `permisos`** del rol de sistema `admin` para limitar lo que hace
  el administrador. Cambiar `clave`, `nombre`, `descripcion` o `alcance` responde 409;
  incluir un permiso de `PERMISOS_EXCLUSIVOS_SUPERADMIN` (`app/schemas/rol.py`)
  responde 403. La escritura es atómica (`{_id, clave: "admin", sistema: true}`) y se
  registra en la auditoría. El rol `admin` tampoco se puede eliminar.
- Un rol personalizado solo se puede editar o eliminar si el actor puede otorgar
  los permisos y el alcance ACTUALES de ese rol (`puede_otorgar`), además de los
  nuevos; así un gestor con menos acceso no degrada ni borra un rol más poderoso.
  Si no, responde 403.
- Un rol asignado a usuarios no se elimina ni cambia de clave (409).
- Si el rol desaparece entre la comprobación y la escritura, la respuesta es 404.
- `RolIn` usa `extra="forbid"` y no acepta el campo `sistema`; además, el alta
  siempre guarda `sistema: false`. Un cliente no puede crear un rol personalizado
  que se presente como rol del sistema.
- Tanto listar como crear requiere `roles:gestionar`. `puede_otorgar()` impide
  conceder permisos o alcance superiores a los del actor.
- El índice único de `roles.clave` y el manejo de `DuplicateKeyError` rechazan con
  409 la suplantación de una clave ya existente, incluidas las cinco claves base.

La regla V-ROL-08 queda cubierta en el backend: cualquier documento con
`sistema: true` se rechaza con 409 en edición y borrado; ocultar controles en el
frontend no es suficiente.

## Definición base frente a documentos persistidos

`sembrar_base()` sincroniza los roles base por su clave estable con `$set`
(upsert). El rol `admin` es la excepción: sus `permisos` solo se escriben al crearlo
(`$setOnInsert`) para no pisar lo que haya limitado el superadmin; en un rol existente
únicamente se retiran (`$pull`) los permisos exclusivos del superadmin. Por tanto:

1. `roles_sistema()` es la fuente de verdad de los cinco roles base: volver a
   ejecutar `init_db.py` repara permisos, alcance o marca `sistema` alterados;
2. el `_id` y las referencias de los usuarios (por `clave`) se conservan, y los
   roles personalizados no se tocan;
3. es idempotente: dos ejecuciones seguidas dejan el mismo resultado.

Antes de ejecutar `init_db.py` en producción se sigue BD-19 (respaldo previo con
`mongodump`). Pruebas: `test_sembrar_base_repara_rol_base_conservando_id` y
`test_sembrar_base_conserva_permisos_limitados_del_admin`.

## Adenda: rol `superadmin` (28 de octubre de 2026)

Decisión del usuario: un sexto rol de sistema, `superadmin` («Superadministrador»), alcance
`global`, **por encima** de `admin`. Tiene todo el catálogo, incluido el permiso nuevo
`sistema:administrar`. Son exclusivos del superadmin y se retiran de `admin`:

| Permiso | ADM | SUP | Protege |
|---|---:|---:|---|
| `configuracion:gestionar` | — | Sí | `GET/PATCH /config/ia` |
| `roles:gestionar` | — | Sí | `POST/PATCH/DELETE /roles` (`GET /roles` también admite `usuarios:gestionar`) |
| `sistema:administrar` | — | Sí | `GET /sistema/salud`, `GET /sistema/resumen`, cuentas privilegiadas |

Cuentas privilegiadas (`_es_rol_privilegiado` en `routers/usuarios.py`): rol `admin` o `superadmin`,
cualquier rol con `sistema:administrar` o con `usuarios:gestionar` y alcance `global`. Sin
`sistema:administrar` no se ven en `GET /usuarios` (salvo la propia), editarlas responde 404 y
asignarlas 403. Invariantes: nadie cambia su propio rol ni se desactiva (400) y no se puede
desactivar ni degradar al último superadmin activo (409). `GET /auditoria` y `GET /analitica/ia`
(Métricas IA) exigen `sistema:administrar`: el admin recibe 403. El superadmin puede limitar los
permisos del rol `admin` (ver «Protección de los roles del sistema»). Pruebas: `tests/e2e/test_superadmin.py` y la columna `SUP` de
`test_alcance_matriz.py`.

