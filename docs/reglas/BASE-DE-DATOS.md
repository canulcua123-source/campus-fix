# BASE DE DATOS · Reglas de MongoDB

MongoDB Atlas M0 (512 MB, sin respaldos automáticos) en producción y `mongo:7.0` en Docker para desarrollo y CI (`mongo:8` no arranca en kernels Linux ≥ 6.19, [SERVER-121912](https://jira.mongodb.org/browse/SERVER-121912)). Base: secciones 9 y RNF-13, RNF-17, RNF-22 de la documentación del proyecto.

Archivos clave: `backend/scripts/init_db.py` (`esquema_incidencias`, `asegurar_coleccion`, `crear_indices`, `sembrar_base`, `sembrar_demo`), `backend/app/core/db.py` (`get_db`, cliente con `tz_aware=True`), `backend/scripts/limpiar_huerfanos.py`, `backend/tests/e2e/conftest.py` (guard de base local).

Colecciones actuales: `incidencias_campus`, `usuarios`, `roles` y `categorias`, todas con `$jsonSchema`, `validationLevel: "strict"` y `validationAction: "error"`.

---

## 1. Modelado

**BD-01 · Embeber lo que se lee junto y está acotado; referenciar lo que vive solo.** La incidencia es un expediente completo en un solo documento (una lectura = una pantalla de detalle):

| Dato | Decisión | Por qué |
|---|---|---|
| `historial_seguimiento`, `evidencias_adjuntas`, `tags`, `ubicacion`, `detalle_especifico` | Embebido | Se leen siempre con la incidencia; acotados |
| `reportante`, `tecnico_asignado` | Embebido como **instantánea** `{usuario_id, nombre}` | Mostrar el nombre sin `$lookup`; `usuario_id` es la referencia real |
| Usuario completo, rol | Referencia (`usuario_id: ObjectId`, `rol: "clave"`) | Cambian solos y se comparten |
| Archivos de evidencia | **Fuera** de MongoDB (bucket); solo metadatos + `url_storage` | 512 MB de M0 (RNF-17) |

```js
// ✅ { reportante: { usuario_id: ObjectId("..."), nombre: "Ana López" } }
// ❌ { reportante: { ...documento_completo_del_usuario, password_hash: "..." } }
// ❌ { evidencias_adjuntas: [{ contenido_base64: "/9j/4AAQ..." }] }
```

**BD-02 · Polimorfismo con `detalle_especifico`.** Los campos propios de cada categoría van dentro de `detalle_especifico`, que lleva su propio `categoria` como discriminador. Debe coincidir con el `categoria` de la raíz: lo exige el `$expr` de `esquema_incidencias()`. Las tres categorías del sistema conservan su unión Pydantic discriminada y sus ramas BSON exactas. Las categorías personalizadas se validan en la API con un modelo estricto generado desde el catálogo; MongoDB conserva para ellas las invariantes estructurales comunes. Prohibido poner campos de una categoría en la raíz del documento.

**BD-03 · Sin `null`.** Un campo que no aplica **no existe**: `fecha_resolucion` y `tecnico_asignado` aparecen solo cuando aplican; al reabrir se quita con `$unset`. Al construir documentos usa `model_dump(exclude_none=True)`.

```python
# ✅ update["$unset"] = {"fecha_resolucion": ""}
# ❌ sets["fecha_resolucion"] = None
```

**BD-04 · Tipos BSON correctos.**

| Dato | Tipo BSON | Cómo en Python |
|---|---|---|
| Fechas | `date` (UTC) | `datetime.now(timezone.utc)`; nunca strings ni hora local |
| Referencias | `objectId` | `ObjectId`, validado con `_oid()`; nunca guardes el id como string |
| Contadores enteros (`vlan`, `equipos_afectados`, `schema_version`) | `int` | `int` |
| Horas | `double` | `float` |
| Booleanos | `bool` | `True`/`False`, nunca `"true"` |
| Ids de evidencia | `string` (UUID v4) | `str(uuid.uuid4())` |
| IP | `string` | `IPvAnyAddress` en Pydantic, `mode="json"` al guardar |

**BD-05 · `schema_version` en todo documento nuevo** (`incidencias_campus` y `usuarios` lo tienen en `1`). Cuando el formato de un documento cambia de forma incompatible, el código nuevo escribe la versión siguiente y una migración (BD-17) actualiza los viejos.

**BD-06 · Arreglos acotados siempre.** Ningún arreglo crece sin límite (documento máx. 16 MB; M0 de 512 MB):

| Arreglo | Tope | Dónde se garantiza |
|---|---|---|
| `tags` | 15, únicos | Pydantic + `$jsonSchema` (`maxItems`, `uniqueItems`) |
| `evidencias_adjuntas` | 10 | `MAX_EVIDENCIAS` + filtro `evidencias_adjuntas.9: {$exists: false}` + `$jsonSchema` |
| `historial_seguimiento` | últimas 200 | `$push` con `$slice: -MAX_HISTORIAL` |
| `detalle_especifico.insumos` | 10 | Pydantic |
| `usuarios.areas` / `edificios` | 3 / 20 | Pydantic (`UsuarioPatch`) |

Un arreglo nuevo debe tener tope en Pydantic **y** en `$jsonSchema` (o `$slice`). Si puede crecer sin fin (p. ej. auditoría), va en su propia colección.

**BD-07 · Nombres:** colecciones y campos en español, `snake_case`; fechas con prefijo `fecha_`; referencias con sufijo `_id`.

### Contratos de las colecciones auxiliares

Los validadores se encuentran únicamente en `scripts/init_db.py`:

| Colección | Campos requeridos | Campos opcionales |
|---|---|---|
| `usuarios` | `schema_version`, `correo`, `nombre`, `password_hash`, `rol`, `activo`, `fecha_alta` | `areas`, `edificios`, `tipo_reportante` |
| `roles` | `clave`, `nombre`, `descripcion`, `permisos`, `alcance` | `sistema` |
| `categorias` | `clave`, `nombre`, `prefijo`, `area_responsable`, `version`, `activa`, `campos` | Ninguno |

`usuarios.schema_version` vale `1`; `fecha_alta` es una fecha BSON. `areas` admite únicamente las tres categorías vigentes y `edificios` contiene cadenas. En `roles`, los permisos pertenecen a `CATALOGO_PERMISOS`, no se repiten y el alcance es `propio`, `area`, `edificio` o `global`. En `categorias`, cada elemento de `campos` usa una rama distinta según `tipo`: `enum` requiere `opciones`; `entero` admite `min`/`max`; `texto` admite `max_length`/`patron`; los demás tipos no aceptan opciones ajenas.

### Contrato de `historial_seguimiento`

La estructura vigente conserva el cambio mínimo y no almacena `estado_anterior`. Cada entrada de creación o transición contiene `fecha` (BSON date), `usuario_id` (ObjectId), `estado_nuevo`, `comentario` y `horas`; una asignación puede añadir `tipo: "asignacion"`. El estado anterior se obtiene de la entrada previa, mientras que la primera entrada siempre indica `estado_nuevo: "abierta"`. Esto evita duplicar información y conserva la actualización atómica que valida el estado permitido en el filtro de MongoDB. No se guarda `estado_anterior: null`. El arreglo continúa limitado a las últimas 200 entradas mediante `$push` y `$slice`.

## 2. Índices

Índices actuales (`crear_indices()`):

| Índice | Sirve a |
|---|---|
| `{categoria:1, estado:1, "ubicacion.edificio":1}` | Filtros del tablero (obligatorio) |
| `{fecha_resolucion:1}` TTL 60 días | Depuración automática CU-07 (obligatorio) |
| texto `titulo` (peso 10) + `descripcion` (5), español, `texto_titulo_descripcion` | `/incidencias/buscar` (obligatorio) |
| `{codigo:1}` único | Folio sin duplicados |
| `{"reportante.usuario_id":1, fecha_creacion:-1}` | Mis reportes (alcance `propio`) |
| `{"tecnico_asignado.usuario_id":1, estado:1}` | Bandeja del técnico |
| `{estado:1, "ubicacion.edificio":1}` | Pipeline 1 (`/analitica/edificios`) |
| `{fecha_creacion:-1}` | Listados recientes |
| `usuarios.correo`, `roles.clave`, `categorias.clave` únicos | Unicidad |

Los pipelines de analítica comienzan con `$match` y combinan el alcance autorizado y los filtros del cliente mediante `$and`. `/analitica/resumen` usa una sola agregación con `$facet`: `fecha_creacion` para abiertas, en proceso y críticas, y `fecha_resolucion` para resueltas. El filtro superior `hasta` se convierte al inicio UTC del día siguiente y se aplica con `$lt`, por lo que incluye el día indicado completo sin depender de la hora almacenada.

Los pipelines F2 conservan el mismo `$match` inicial. `/analitica/aulas-cronicas` intersecta el periodo solicitado con los últimos 30 días UTC y agrupa por edificio, piso y aula; `/analitica/carga-tecnicos` usa los estados no terminales (`abierta`, `en_proceso`, `en_espera`), excluye documentos sin `tecnico_asignado.usuario_id` y suma `horas_invertidas` sin desplegar el historial; `/analitica/tendencia` agrupa `fecha_creacion` por año-mes y categoría con zona `UTC`. El índice `{categoria:1, estado:1, "ubicacion.edificio":1}` puede aprovechar sus prefijos cuando el alcance o el filtro fijan categoría y estado; `{fecha_creacion:-1}` cubre el rango temporal. La selección real del plan debe comprobarse en MongoDB local con `aggregate(..., explain=True)` o el comando `explain` equivalente, sin `hint` ni filtros artificiales.

**BD-08 · Un índice nuevo solo si hay una consulta frecuente que lo necesita.** Cada índice ocupa espacio y frena las escrituras. En el PR escribe la consulta que sirve y el `explain` antes/después:

```python
plan = await db.incidencias_campus.find(filtro).sort("fecha_creacion", -1).explain()
# ✅ IXSCAN con totalDocsExamined ≈ nReturned     ❌ COLLSCAN
```

**BD-09 · Orden ESR** en índices compuestos: primero campos de **Igualdad**, luego de **Sort**, al final de **Rango** (`$in` de muchos valores, `$gt`, `$lt`).

```python
# consulta: {"reportante.usuario_id": X, "fecha_creacion": {"$gte": d}} ordenada por fecha_creacion desc
# ✅ [("reportante.usuario_id", 1), ("fecha_creacion", -1)]   igualdad → sort/rango
# ❌ [("fecha_creacion", -1), ("reportante.usuario_id", 1)]
```

**BD-10 · Índices solo en `crear_indices()` de `init_db.py`**, nunca a mano en Atlas ni desde la API. `create_index` es idempotente si las opciones no cambian; si cambias las opciones de un índice existente (p. ej. el TTL), Mongo lanza conflicto: hay que usar `collMod` o borrarlo y recrearlo en un paso explícito del script, aprobado por el DBA. Solo puede haber **un** índice de texto por colección.

## 3. Operaciones permitidas y prohibidas

**BD-11 · Permitido en la API:** `find_one`/`find` con proyección y `limit`, `insert_one`, `update_one` con `$set`, `$inc`, `$push` (`$each` + `$slice`), `$addToSet` (`$each`), `$pull`, `$unset`; `count_documents` con filtro; `aggregate` que empieza con `$match` que incluye `filtro_alcance`; `$text` con `$meta: "textScore"`.

**BD-12 · Prohibido en la API:**

| Prohibido | Motivo |
|---|---|
| Pasar un `dict` del cliente como filtro o update | Inyección de operadores (`{"$ne": ""}`) — RNF-13 |
| `$where`, `$function`, `$accumulator`, JavaScript en el servidor | Ejecución de código |
| `$regex` con texto del usuario | ReDoS y búsquedas sin índice; usa `$text` (el único `$regex` del código usa un prefijo construido por el servidor con `re.escape`) |
| `replace_one`, `$set` de un arreglo completo | Pierde cambios concurrentes |
| `update_many`, `delete_many`, `delete_one`, `drop` | Borrado masivo; las incidencias se depuran solo por TTL |
| `find` sin `limit` sobre `incidencias_campus` | Memoria y tiempo; ver API-16 |
| Leer, decidir en Python y escribir | Carreras; las condiciones van en el filtro (API-19) |
| Transacciones multi-documento | No hacen falta: cada operación es de un documento |
| Consultas sin `filtro_alcance` sobre incidencias | BOLA |

Los scripts de `scripts/` sí pueden usar `delete_many`/`insert_many`, siempre filtrando por algo explícito (`{"demo": True}`).

## 4. Cambiar el esquema

**BD-13 · Solo vía `scripts/init_db.py`.** El `$jsonSchema`, las colecciones y los índices se definen ahí y en ningún otro lugar. Nada de crear colecciones o validadores desde Compass, la consola de Atlas o la API.

**BD-14 · El script es idempotente.** Correrlo dos veces seguidas no cambia nada ni falla: colecciones con `asegurar_coleccion` (crea o hace `collMod`), índices con `create_index`, semillas con `update_one(..., {"$setOnInsert": ...}, upsert=True)`. Toda sección nueva debe seguir esa forma.

**BD-15 · Mismos límites en tres capas.** Si cambias un límite en Pydantic (`app/schemas/`), cámbialo en `esquema_incidencias()` y en Zod en el mismo PR (sección 7 de la documentación: Zod → Pydantic → `$jsonSchema`).

**BD-16 · `validationLevel: "strict"` afecta a los documentos viejos.** Tras el `collMod`, cualquier `update_one` sobre un documento que no cumpla el nuevo esquema falla (la API responde 400 "El documento no cumple el esquema de la base de datos"). Por eso, antes de endurecer el esquema, migra los documentos existentes (BD-17) o haz el campo nuevo opcional.

**BD-17 · Migraciones de datos** en un script en `scripts/` (p. ej. `scripts/migrar_v2.py`): idempotente, filtra por `schema_version` (`{"schema_version": 1}` → actualiza y pone `2`), imprime cuántos documentos cambió, y tiene modo simulación por defecto (como `limpiar_huerfanos.py` con `--borrar`).

Para T-008, un administrador antiguo puede tener `fecha_creacion` y no tener `schema_version`. Antes de instalar el validador estricto, ejecuta `python scripts/migrar_admin_t008.py` para simular y, tras el respaldo y revisión, `python scripts/migrar_admin_t008.py --aplicar`. La migración actúa solo sobre `admin@utm.local`, copia la fecha BSON existente a `fecha_alta`, asigna la versión `1` y elimina el nombre de campo antiguo en la misma actualización. No modifica el hash, rol, permisos ni estado y no se ejecuta automáticamente.

**BD-18 · Probar en Docker antes que nada:**

```bash
docker compose up -d
cd backend
python scripts/init_db.py --seed-demo     # primera vez
python scripts/init_db.py                 # segunda vez: no debe cambiar ni fallar
pytest tests/e2e -q                       # la suite recrea utm_desk_test con el mismo init_db
```

**BD-19 · Orden en producción:** 1) respaldo con `mongodump` (BD-24), 2) migración de datos si aplica, 3) `init_db.py` con `MONGODB_ADMIN_URI`, 4) verificar en Atlas (validador e índices), 5) desplegar la API.

**BD-20 · PR con aprobación del DBA.** Todo PR que toque `init_db.py`, un script de migración, `$jsonSchema`, índices o la forma de un documento necesita aprobación explícita del DBA del equipo. Los cambios de esquema en producción **no** se aplican sin ese visto bueno.

## 5. Datos demo

**BD-21 · Datos de demostración solo con las banderas del script:**

| Comando | Efecto |
|---|---|
| `python scripts/init_db.py` | Esquema, índices, roles y categorías de sistema, usuario `admin@utm.local` |
| `python scripts/init_db.py --seed-demo` | Además 24 incidencias con `demo: true` (≥ 8 resueltas, 18 con evidencia, fechas de los últimos 5–30 días, folios `…-9000` a `…-9023`). Si ya existen, no hace nada |
| `python scripts/init_db.py --reset-demo` | Borra **solo** `{"demo": true}` y las vuelve a crear |

Reglas: todo dato sintético lleva `demo: true` (así se borra sin tocar datos reales); nunca marques datos reales como demo; los datos demo son deterministas (`random.Random(42)`). Fuera de `localhost`, el script exige `SEED_ADMIN_PASSWORD` para crear el admin. También conviene definirla explícitamente en local: si se genera una contraseña aleatoria, el script no la imprime ni expone hashes o secretos en los logs.

## 6. Acceso a Atlas

**BD-22 · Nadie toca Atlas salvo el responsable.** Solo el DBA/responsable designado tiene la cadena de conexión de producción y la usa desde su equipo, con IP en la lista de acceso de Atlas.
- Prohibido pegar la URI de Atlas, contraseñas o el `.env` de producción en un asistente de IA, chat, issue o commit.
- Prohibido que un asistente de IA ejecute comandos contra Atlas (`mongosh`, `init_db.py`, scripts) o tenga la URI en su entorno. La IA trabaja solo contra Docker local.
- En máquinas personales, `backend/.env` apunta a `mongodb://localhost:27017`. La suite e2e se niega a correr contra otra base (`conftest.py` exige `localhost`, base `utm_desk_test` y Redis `/15`).

**BD-23 · Usuarios de base con permisos mínimos** (RNF-14): la API usa `MONGODB_URI` con un usuario `readWrite` sobre `utm_desk`; `init_db.py` usa `MONGODB_ADMIN_URI` (usuario `dbAdmin` + `readWrite`) y solo lo corre el responsable. Nunca el usuario administrador del clúster.

## 7. Respaldos

**BD-24 · `mongodump` semanal y antes de cada cambio de esquema** (RNF-22; M0 no tiene respaldos automáticos). Lo ejecuta el responsable:

```bash
mongodump --uri "$MONGODB_URI_RESPALDO" --db utm_desk --gzip \
  --archive="respaldos/utm_desk_$(date +%F).gz"
```

- Los respaldos **nunca** van al repositorio (contienen `password_hash` y datos personales); se guardan cifrados fuera de él. Conservar al menos las últimas 4 semanas.
- Un respaldo no probado no es respaldo: restáuralo en Docker al menos una vez al mes, en otra base:

```bash
mongorestore --uri "mongodb://localhost:27017" --gzip --archive=respaldos/utm_desk_2026-10-19.gz \
  --nsFrom 'utm_desk.*' --nsTo 'utm_desk_restaurada.*'
```

- Los archivos de evidencia viven en el bucket, no en el dump.

## 8. TTL de 60 días

**BD-25 · Qué hace.** El índice `{fecha_resolucion: 1}` con `expireAfterSeconds = 60 días` hace que MongoDB **borre** la incidencia completa 60 días después de su `fecha_resolucion` (RF-SIS-06, CU-07). El monitor TTL corre cada ~60 s, así que el borrado puede tardar unos minutos.

**BD-26 · Efectos que hay que conocer:**
- Se borran las incidencias **resueltas y cerradas** (al cerrar se conserva `fecha_resolucion`). Las abiertas, en proceso o en espera nunca expiran.
- Reabrir (`resuelta → en_proceso`) hace `$unset` de `fecha_resolucion` y cancela el borrado; al volver a resolver, el plazo empieza de nuevo.
- La analítica (`/analitica/*`) deja de contar las incidencias borradas: los indicadores son de los últimos ~60 días de resueltas, no históricos.
- Los archivos en el bucket **no** se borran solos: corre `python scripts/limpiar_huerfanos.py` (simulación) y luego `--borrar` periódicamente. Las subidas nunca registradas quedan en `staging/` y las elimina la regla de lifecycle del bucket.
- Nunca escribas `fecha_resolucion` a mano ni con fechas pasadas: borrarías la incidencia en el siguiente ciclo. Los datos demo usan fechas de los últimos 30 días para no expirar antes de la defensa.
- `fecha_resolucion` debe ser `date` BSON; si fuera string, el TTL la ignora.
- Cambiar el plazo se hace con `collMod` en `init_db.py` (no con otro `create_index`), con aprobación del DBA.

## 9. Categorías dinámicas en incidencias (T-020)

Al crear una incidencia, la API toma la clave de `detalle_especifico.categoria` y comprueba en MongoDB que el documento de `categorias` exista y siga activo. Para `computo_redes`, `infraestructura` y `academico` continúa usando `DetalleComputo`, `DetalleInfra` y `DetalleAcademico`; no se reinterpretan sus definiciones históricas ni se relajan sus enumeraciones, patrones, límites o `extra="forbid"`.

Para una categoría personalizada, `app/dominio/detalle.py` compila la definición mediante `pydantic.create_model()` con `extra="forbid"` y tipos estrictos. `categoria` es un discriminador literal y no puede definirse como campo administrable. Las reglas aplicadas son:

| Tipo | Validación | Límites/opciones | Valor BSON |
|---|---|---|---|
| `texto` | cadena estricta | `min`/`max` son longitudes | string |
| `numero` | entero o decimal estricto y finito; no acepta booleanos | `min`/`max` numéricos | int/long/double |
| `entero` | entero estricto; no acepta decimales ni booleanos | `min`/`max` enteros | int/long |
| `booleano` | solo `true` o `false` | sin límites | bool |
| `ip` | IPv4 o IPv6 válida | sin límites | string normalizado |
| `lista` | selección única estricta | una de las `opciones` configuradas | string |

Un campo con `requerido: true` debe existir. Uno opcional puede omitirse, pero un `null` explícito no sustituye un valor válido. La serialización usa `exclude_unset=True` y `exclude_none=True`, por lo que no se crean valores nulos de relleno. Los campos desconocidos, requeridos ausentes y tipos incorrectos producen HTTP 400 con la ubicación dentro de `body.detalle_especifico`.

Cada incidencia nueva guarda `categoria_version`, tomada del mismo snapshot lógico de la definición que se usó para validar. El cliente no puede enviarla. La API vuelve a comprobar `clave`, `version`, `prefijo` y `activa` antes de insertar; si cambiaron durante la solicitud responde 409. No se promete una transacción entre las colecciones, pero nunca se etiqueta un detalle validado con una versión distinta. Las incidencias históricas de las categorías base pueden carecer de `categoria_version` y continúan siendo válidas.

### Caché e invalidación

MongoDB sigue siendo la fuente de verdad para actividad, versión y prefijo. Redis conserva solo `campos` con una clave separada por categoría y versión (`categorias:definicion:v1:<clave>:<version>`) durante 300 segundos; las clases Pydantic compiladas se reutilizan en una caché LRU de proceso limitada a 128 entradas y también incluyen la huella del contenido. `POST /categorias` y `PATCH /categorias/{clave}` invalidan las versiones conocidas después de confirmar la escritura.

Si Redis falla, la creación consulta los campos en MongoDB y valida normalmente. Una entrada corrupta se ignora. La comprobación de `activa` y `version` nunca procede únicamente de la caché, por lo que una definición obsoleta no puede reactivar una categoría ni utilizarse bajo una versión nueva. Entre procesos pueden permanecer clases antiguas en memoria, pero dejan de ser seleccionables al cambiar la versión.

`area_responsable` continúa siendo metadato descriptivo del catálogo. T-020 no inventa una traducción a `usuarios.areas`: el alcance `area` sigue comparando la clave de la incidencia con las áreas autorizadas. Así una categoría nueva no amplía permisos; el reportante conserva el alcance propio y los roles globales su alcance vigente.

### Alcance del `$jsonSchema` e índice wildcard

`esquema_incidencias()` mantiene las tres ramas exactas del sistema y agrega una cuarta rama estructural para categorías personalizadas. Esta rama exige una clave segura, `categoria_version` positiva, discriminador coherente y valores escalares compatibles con los seis tipos. No afirma validar contra otra colección: la obligatoriedad, opciones y límites dinámicos se comprueban en la API. `validationLevel: "strict"` y `validationAction: "error"` permanecen sin cambios.

T-020 evaluó el índice `{"detalle_especifico.$**": 1}` descrito como posibilidad en el documento funcional. No se define por ahora: el catálogo técnico vigente de índices no lo incluye, la API no ejecuta consultas por campos dinámicos y Atlas M0 tiene almacenamiento limitado. Crearlo hoy aumentaría el coste de todas las escrituras sin una consulta demostrable ni un `explain()` que lo justifique. Si se incorpora un filtro real en el futuro, el DBA debe medirlo en MongoDB local, añadirlo idempotentemente en `crear_indices()` y aprobar su aplicación. No sustituiría los índices compuestos, de texto, TTL o de folio existentes.

Los cambios de validador están preparados en `backend/scripts/init_db.py`, pero requieren respaldo, revisión y aprobación del DBA antes de ejecutar `collMod` en un entorno autorizado. No se aplican desde los routers. Como T-013 genera sus artefactos desde `init_db.py`, `entrega/script_maestro.js` deberá regenerarse posteriormente mediante el exportador aprobado; T-020 no modifica los archivos de `entrega/`.

---

## Checklist BASE DE DATOS

- [ ] Embebido solo lo acotado y leído junto; referencias con `ObjectId`; archivos fuera de MongoDB.
- [ ] Campos por categoría dentro de `detalle_especifico` con su `categoria`.
- [ ] Sin `null` (omitir o `$unset`); tipos BSON correctos; fechas `date` en UTC.
- [ ] `schema_version` en documentos nuevos; versión subida si el cambio es incompatible.
- [ ] Todo arreglo con tope en Pydantic y en `$jsonSchema` o `$slice`.
- [ ] Índice nuevo justificado con su consulta y `explain`; orden ESR; definido en `crear_indices()`.
- [ ] Solo operadores atómicos; nada de `$where`, `$regex` con texto del usuario, `replace_one`, borrados masivos ni filtros del cliente.
- [ ] Cambios de esquema solo en `init_db.py`, idempotente (corre dos veces sin error) y probado en Docker + e2e.
- [ ] Límites iguales en Zod, Pydantic y `$jsonSchema`.
- [ ] Migración de datos con script idempotente y modo simulación, si aplica.
- [ ] Aprobación del DBA en el PR.
- [ ] Datos sintéticos con `demo: true`, solo vía `--seed-demo`/`--reset-demo`.
- [ ] Nadie más que el responsable usó Atlas; ninguna credencial en IA, chat o repo.
- [ ] `mongodump` hecho antes de aplicar en producción.
- [ ] Efecto del TTL de 60 días considerado (analítica, evidencias huérfanas, `fecha_resolucion`).
