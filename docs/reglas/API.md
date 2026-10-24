# API · Convenciones REST

Reglas para diseñar y cambiar endpoints de la API FastAPI (`backend/app/`). Para el paso a paso de un endpoint nuevo ve a [CREAR-API.md](CREAR-API.md).

Archivos clave: `app/main.py` (manejadores de error, límite de cuerpo, CORS), `app/core/security.py` (`get_usuario_actual`, `require_permiso`, `filtro_alcance`, `puede_otorgar`), `app/core/serial.py` (`a_json`), `app/core/limiter.py` (`limiter`, `clave_usuario`), `app/core/storage.py` (URLs firmadas), `app/routers/*.py`.

## Endpoints actuales (referencia)

| Método y ruta | Permiso | Respuesta OK |
|---|---|---|
| `POST /auth/login` | público (10/min por IP) | 200 `{access_token, token_type, usuario}` |
| `GET /auth/me` | autenticado | 200 |
| `GET /health` | público | 200 `{"status":"ok"}` |
| `POST /incidencias` | `incidencias:crear` | **201** `{_id, codigo, estado}` |
| `GET /incidencias?estado&categoria&prioridad&edificio&limite` | `incidencias:ver` | 200 lista |
| `GET /incidencias/buscar?q=` | `incidencias:buscar` | 200 lista (máx. 20, por relevancia) |
| `GET /incidencias/{id}` | `incidencias:ver` | 200 |
| `PATCH /incidencias/{id}/seguimiento` | `seguimiento:registrar` | 200 `{ok, estado}` |
| `PATCH /incidencias/{id}/asignacion` | `incidencias:asignar` | 200 |
| `POST` / `DELETE /incidencias/{id}/tags` | `tags:gestionar` | 200 `{ok}` |
| `POST /incidencias/{id}/evidencias/firma` | `evidencias:subir` | 200 `{evidencia_id, url_storage, upload_url, expira_en}` |
| `POST /incidencias/{id}/evidencias` | `evidencias:subir` | **201** `{ok, evidencia_id}` |
| `GET /incidencias/{id}/evidencias/{evidencia_id}/url` | `incidencias:ver` | 200 `{url, expira_en}` |
| `POST /ia/analizar-imagen` (multipart) | `ia:usar` | 200 `AnalisisImagen` |
| `GET /analitica/edificios`, `GET /analitica/tags` | `analitica:ver` | 200 |
| `GET /roles`, `POST /roles` | `roles:gestionar` | 200 / **201** |
| `GET /usuarios`, `POST /usuarios`, `PATCH /usuarios/{id}` | `usuarios:gestionar` | 200 / **201** / 200 |
| `GET /categorias` | autenticado | 200 |

La documentación interactiva vive en **`/docs`** (OpenAPI de FastAPI). Es la fuente de verdad del contrato: si no aparece bien ahí, el endpoint no está terminado.

---

## 1. Rutas y verbos

**API-01 · Recursos en plural y en español, kebab-case.** Un router por recurso en `app/routers/<recurso>.py` con `APIRouter(prefix="/<recurso>", tags=["<recurso>"])`. Subrecursos anidados bajo su padre. Acciones que no son CRUD van como subrecurso con sustantivo o verbo en kebab-case (`/ia/analizar-imagen`, `/evidencias/firma`).

```
✅ GET  /incidencias/{incidencia_id}/evidencias/{evidencia_id}/url
✅ POST /ia/analizar-imagen
❌ GET  /getIncidencia?id=...     ❌ POST /incidencia/crear     ❌ /Incidencias_Campus
```

**API-02 · Verbos HTTP con su significado.**

| Verbo | Uso | Ejemplo real |
|---|---|---|
| `GET` | Leer; nunca modifica nada | `GET /incidencias` |
| `POST` | Crear un recurso o ejecutar una acción | `POST /incidencias`, `POST /incidencias/{id}/tags` |
| `PATCH` | Modificar parte de un recurso | `PATCH /incidencias/{id}/seguimiento`, `PATCH /usuarios/{id}` |
| `DELETE` | Quitar | `DELETE /incidencias/{id}/tags` |
| `PUT` | No se usa en la API (solo el PUT directo al bucket con `upload_url`) | — |

**API-03 · Parámetros de ruta con nombre explícito** (`{incidencia_id}`, `{usuario_id}`), no `{id}` genérico. Filtros y paginación van en query string, validados con `Annotated[..., Query(...)]` y límites (`max_length`, `ge`, `le`).

## 2. Códigos de estado

**API-04 · Usa exactamente estos códigos** (RF-SIS-03):

| Código | Cuándo | Ejemplo en el código |
|---|---|---|
| **201** | Se creó un recurso. Declara `status_code=201` en el decorador | `@router.post("", status_code=201)` en `crear_incidencia`, `crear_rol`, `crear` (usuarios), `registrar_evidencia` |
| **200** | Lectura, actualización o acción sin recurso nuevo | seguimiento, tags, firma |
| **400** | Validación (Pydantic, `$jsonSchema`, id malformado, regla de negocio sobre los datos enviados) | `_oid()` → "Identificador inválido"; firma inexistente/expirada |
| **401** | Sin token, token inválido/expirado, usuario inactivo | `get_usuario_actual` |
| **403** | Autenticado pero **sin el permiso** (o intentando otorgar más de lo que tiene) | `require_permiso`, `puede_otorgar` |
| **404** | No existe **o está fuera de su alcance** | `_en_alcance()` |
| **409** | Conflicto con el estado actual: duplicado, transición no permitida, límite de evidencias, carrera | `DuplicateKeyError`, "Transición de estado no permitida" |
| **411** | POST/PUT/PATCH/DELETE con `Transfer-Encoding` y sin `Content-Length` | middleware `_limitar_body` |
| **413** | Cuerpo mayor al permitido | middleware `_limitar_body` |
| **429** | Límite de frecuencia o cupo diario | slowapi, cupo de IA, firmas por día, bloqueo de login |
| **503** | Dependencia externa no disponible o apagada (almacenamiento, IA) | `_requerir_cliente()`, IA deshabilitada |

**API-05 · 404 fuera de alcance, nunca 403.** Si la incidencia existe pero no está en el alcance del usuario, la respuesta es idéntica a la de una que no existe: `404 "Incidencia no encontrada"`. Así no se puede adivinar qué ids existen (BOLA, OWASP API1:2023). El 403 es solo para "tu rol no tiene ese permiso".

```python
# ✅ el filtro de alcance va en la misma consulta
doc = await get_db().incidencias_campus.find_one({"_id": _oid(incidencia_id), **filtro_alcance(usuario)})
if doc is None:
    raise HTTPException(404, "Incidencia no encontrada")

# ❌ revela que existe
doc = await get_db().incidencias_campus.find_one({"_id": oid})
if doc["reportante"]["usuario_id"] != usuario["_id"]:
    raise HTTPException(403, "No es tuya")
```

**API-06 · Orden de las comprobaciones:** 401 (token) → 403 (permiso, lo hace `require_permiso` antes de entrar a la función) → 400 (cuerpo; FastAPI lo valida) → 404 (alcance) → 409 (estado). No hagas consultas a la base antes de saber que el usuario tiene permiso.

**API-07 · Nunca 500 a propósito.** Errores esperados se convierten en `HTTPException` con código y mensaje. Errores de librerías externas (IA, almacenamiento) se capturan y se responden como 503 (ver `routers/ia.py`), sin incluir el error interno en el mensaje.

## 3. Forma de los errores

**API-08 · Formas de error que existen hoy** (no inventes otras):

| Origen | Código | Cuerpo |
|---|---|---|
| Validación de Pydantic / FastAPI (`_validacion` en `main.py`) | 400 | `{"error":"validacion","detalle":[{"type":"string_too_short","loc":["body","titulo"],"msg":"..."}]}` |
| `$jsonSchema` de MongoDB, código 121 (`_write_error`) | 400 | `{"error":"validacion","detalle":[{"msg":"El documento no cumple el esquema de la base de datos"}]}` |
| `HTTPException(status, "mensaje")` en routers | 400–503 | `{"detail":"mensaje en español"}` |
| `DuplicateKeyError` no capturado (`_duplicado`) | 409 | `{"error":"duplicado","detalle":"Registro duplicado"}` |
| Middleware de cuerpo | 411 / 413 | `{"error":"longitud_requerida"}` / `{"error":"cuerpo_demasiado_grande"}` |
| slowapi | 429 | `{"error":"Rate limit exceeded: 10 per 1 minute"}` |
| `WriteError` distinto de 121 | 500 | `{"error":"interno"}` |

Regla para código nuevo: errores de negocio con `raise HTTPException(código, "Mensaje en español para el usuario")`. El mensaje se muestra tal cual en la PWA, así que debe ser claro y no técnico.

```python
# ✅ raise HTTPException(409, "La incidencia está cerrada")
# ❌ raise HTTPException(409, "matched_count == 0")          # técnico
# ❌ return JSONResponse({"ok": False, "msg": "..."}, 200)    # error con 200
```

**API-09 · Los errores no reflejan lo que mandó el cliente.** `_validacion` elimina `input`, `ctx` y `url` del detalle para no devolver contraseñas u otros valores. No pongas valores enviados en los mensajes (`f"El correo {correo} no existe"` ❌). Login responde igual "Credenciales inválidas" exista o no el correo.

## 4. JSON

**API-10 · Nombres en `snake_case` y en español**, igual que en MongoDB: `fecha_creacion`, `tecnico_asignado`, `peso_bytes`. Nada de `camelCase`.

**API-11 · Ids como string.** Todo `ObjectId` sale como string de 24 hex; la clave del documento es `_id` (así lo devuelven `a_json` y `crear_incidencia`). Los ids de evidencia son UUID v4 en string. Un id que llega en la ruta se valida con `_oid()` (400 si está malformado).

**API-12 · Serializar siempre con `a_json()`** (`app/core/serial.py`): convierte `ObjectId` anidados a string y **elimina `password_hash` a cualquier profundidad**. Además, proyecta para no leer de más (`PROYECCION = {"password_hash": 0}` en `usuarios.py`, `PROYECCION_LISTA` en `incidencias.py`).

```python
# ✅ return [a_json(d) async for d in cursor]
# ❌ d["_id"] = str(d["_id"]); return d     # ObjectId anidados rompen, no filtra password_hash
```

**API-13 · Nunca devolver secretos:** `password_hash`, tokens de otros usuarios, claves del bucket, `ANTHROPIC_API_KEY`, URLs firmadas de subida de otro usuario, contenido de `.env`. La suite e2e usa `ClienteSeguro`, que falla si cualquier respuesta contiene `password_hash`.

**API-14 · Fechas en ISO 8601 UTC.** En MongoDB se guardan como `date` BSON con `datetime.now(timezone.utc)` (nunca hora local ni string). En JSON salen en UTC; el contrato acordado es ISO 8601 con zona (`2026-10-19T14:02:00Z`). Hoy los endpoints sin `response_model` las emiten como `2026-10-19T14:02:00.123000+00:00` (mismo instante; los parsers de JS aceptan ambas). La PWA convierte a `America/Mexico_City` solo al mostrar (UX-28). El único cálculo con zona local en el backend es el día del folio (`generar_codigo` usa `ZONA`).

**API-15 · Sin `null` en las respuestas de documentos.** Un campo que no aplica no se envía (p. ej. `fecha_resolucion` y `tecnico_asignado` no existen hasta que aplican). Los schemas de entrada usan `model_dump(exclude_none=True)`.

## 5. Límites, paginación y frecuencia

**API-16 · Todo listado tiene tope.** `GET /incidencias` acepta `limite` (1–100, por defecto 100) y ordena por `fecha_creacion` descendente; `/incidencias/buscar` devuelve máximo 20. Un endpoint nuevo de lista declara `limite: Annotated[int, Query(ge=1, le=100)]`. Prohibido devolver colecciones completas sin `limit` (excepto catálogos pequeños: roles, categorías). Si se necesita paginar más allá de 100, se usa cursor por `fecha_creacion`/`_id` (`?antes_de=`), no `skip` grande.

**API-17 · Límites de tamaño.**

| Qué | Límite | Dónde |
|---|---|---|
| Cuerpo JSON de cualquier POST/PUT/PATCH/DELETE | 64 KB | `MAX_BODY_DEFECTO` en `main.py` |
| `POST /ia/analizar-imagen` (cuerpo) | 6 MB; imagen ≤ 5 MB, JPEG/PNG/WebP | `MAX_BODY`, `routers/ia.py` |
| Evidencia (va directo al bucket, no pasa por la API) | 10 MB; JPEG, PNG, WebP o PDF | `EvidenciaFirmaIn` |
| Evidencias por incidencia | 10 (guardadas + firmas pendientes); 5 pendientes por usuario | `MAX_EVIDENCIAS` |
| Historial de seguimiento | últimas 200 entradas (`$slice`) | `MAX_HISTORIAL` |
| Horas acumuladas por incidencia | 1000 | `MAX_HORAS` |
| Tags por incidencia | 15 | `IncidenciaIn`, `TagsIn`, `$jsonSchema` |

Un endpoint que necesite más de 64 KB se agrega a `MAX_BODY` en `main.py` con justificación en el PR.

**API-18 · Límites de frecuencia existentes** (no los quites; los nuevos se agregan aquí):

| Límite | Valor | Clave |
|---|---|---|
| Login | 10/minuto | IP (`limiter` por defecto) |
| Login fallido | 10 en 15 min por (correo, IP); 50 en 15 min por correo | Redis `login:fallos:*` |
| Escrituras (`POST /incidencias`, `PATCH .../seguimiento`) | `LIMITE_ESCRITURA` = 60/minuto | usuario (`clave_usuario`) |
| Firmas de evidencia | 50 por usuario al día | Redis `firmas:usuario:*` |
| IA | 20 por usuario al día (`IA_LIMITE_DIARIO`); 300 global al día (503) | Redis `ia:uso:*` |

Todo endpoint nuevo **que escribe** lleva `@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)` y recibe `request: Request` como primer parámetro (slowapi lo exige).

## 6. Idempotencia y atomicidad

**API-19 · Una escritura = una operación atómica de MongoDB.** Las condiciones de negocio van en el **filtro** del `update_one`, no en un `find` previo, para que no haya carreras. Si `matched_count == 0`, se distingue 404 (con `_en_alcance`) de 409.

```python
# ✅ (registrar_seguimiento) la transición se valida en el mismo update
res = await col.update_one({"$and": [{"_id": oid, "estado": {"$in": origenes}}, filtro_alcance(usuario)]}, update)
if res.matched_count == 0:
    await _en_alcance(incidencia_id, usuario)   # 404 si no existe o fuera de alcance
    raise HTTPException(409, "Transición de estado no permitida")

# ❌ leer, decidir en Python y luego escribir: dos peticiones simultáneas pasan ambas
doc = await col.find_one({"_id": oid}); if doc["estado"] == "abierta": await col.update_one(...)
```

**API-20 · Operadores atómicos:** `$set`, `$inc`, `$push` con `$each` + `$slice`, `$addToSet` con `$each`, `$pull`, `$unset`. Prohibido reescribir el documento completo (`replace_one`) o arreglos completos con `$set`.

**API-21 · Idempotencia donde el cliente puede repetir.** Agregar/quitar tags es idempotente (`$addToSet`/`$pull`). Registrar evidencia consume la firma con `GETDEL` (un solo uso) y el filtro `evidencias_adjuntas.evidencia_id: {"$ne": ...}` evita duplicados. `POST /incidencias` **no** es idempotente: la PWA deshabilita el botón al enviar (UX-17). Un endpoint nuevo que el usuario pueda reintentar debe diseñarse para que repetirlo no duplique datos.

## 7. Contrato y documentación

**API-22 · Versionado del contrato.** La API no tiene prefijo `/v1`. Por eso:
- Agregar un campo opcional a una respuesta o un parámetro opcional: permitido.
- Quitar, renombrar o cambiar el tipo de un campo, o volver obligatorio algo opcional: **cambio que rompe**. Se hace solo en un PR que actualice también la PWA (FRONT-BACK.md FB-12), Postman y estas reglas, y sube `version` en `FastAPI(title="UTM Desk API", version=...)` de `main.py`.
- Cambios en la forma del documento en MongoDB suben `schema_version` (ver BASE-DE-DATOS.md).

**API-23 · OpenAPI en `/docs` completo.** Cada endpoint tiene `tags` (del router), nombre de función descriptivo en español (`registrar_seguimiento`, no `post2`), y schemas Pydantic de entrada. Si la respuesta tiene forma fija, declara `response_model` (como `/ia/analizar-imagen`).

**API-24 · Todo endpoint nuevo o modificado actualiza Postman** (`postman/UTM-Desk.postman_collection.json`) en el mismo PR: una petición del caso feliz en su carpeta y, en "Pruebas negativas", al menos los casos 400, 403 y 404 (fuera de alcance). Usa variables del entorno `UTM-Desk.local` (`{{base_url}}`, `{{token}}`, `{{token_reportante}}`, `{{incidencia_id}}`…), nunca valores pegados. Postman CLI está disponible para correr la colección.

**API-25 · Entradas siempre con schema Pydantic**, `extra="forbid"` y límites en todo campo (ver CREAR-API.md). Nunca `dict` o `Request.json()` crudos: un body crudo permite inyectar operadores de MongoDB (`{"$ne": ""}`) — RNF-13.

---

## Checklist de revisión API

- [ ] Ruta en plural, español, kebab-case; verbo HTTP correcto.
- [ ] 201 al crear (`status_code=201`); 200 en el resto de éxitos.
- [ ] 403 solo por permiso; **404** si no existe o está fuera de alcance.
- [ ] Errores con `HTTPException(código, "mensaje en español")`; sin valores enviados en el mensaje.
- [ ] Respuesta serializada con `a_json`; ids como string; sin `password_hash` ni secretos; sin `null`.
- [ ] Fechas en UTC (`datetime.now(timezone.utc)`), sin strings de fecha.
- [ ] Listas con `limite` acotado; cuerpo ≤ 64 KB o agregado a `MAX_BODY` con justificación.
- [ ] Escritura atómica (condiciones en el filtro) y con rate limit por usuario.
- [ ] No rompe el contrato, o actualiza PWA + Postman + versión en el mismo PR.
- [ ] Aparece correctamente en `/docs`.
- [ ] Colección de Postman actualizada (caso feliz + 400/403/404).

### Autor de la bitácora

`GET /incidencias/{id}` agrega `autor_nombre?: string` a cada entrada de `historial_seguimiento` cuando el usuario aún existe. Es el nombre actual, consultado después de comprobar el alcance; no se persiste en MongoDB. No incluye correo ni otros campos del usuario. Si el usuario ya no existe, se omite y la interfaz muestra la referencia disponible o «Usuario no disponible».
