# CREAR-API · Definition of Done de un endpoint nuevo

Checklist paso a paso para agregar o modificar un endpoint. Un endpoint **no está terminado** hasta cumplir todos los pasos. Si programas con IA, pega este archivo completo en el prompt.

Reglas relacionadas: [API.md](API.md) (convenciones), [FRONT-BACK.md](FRONT-BACK.md) (Zod y cliente), [BASE-DE-DATOS.md](BASE-DE-DATOS.md) (esquema e índices).

---

## Paso a paso

### CA-01 · Diseña el contrato antes de programar
Escribe en el PR: método + ruta (API-01/02), permiso requerido, cuerpo de entrada, respuesta exitosa y cada error posible (400/401/403/404/409/429). Revisa que el permiso exista en `CATALOGO_PERMISOS` (`app/schemas/rol.py`). Si necesitas un permiso nuevo, agrégalo **en los dos lugares** de `rol.py` (`CATALOGO_PERMISOS` y `Permiso`; un `assert` comprueba que coincidan) y a los roles de sistema en `roles_sistema()` de `scripts/init_db.py`.

### CA-02 · Schema Pydantic con `extra="forbid"` y límites en todo campo
En `app/schemas/<recurso>.py` (o junto al router si es pequeño, como `AsignacionIn`).

- `model_config = ConfigDict(extra="forbid")`: un campo de más → 400.
- **Todo** `str` con `min_length`/`max_length` (y `pattern` si tiene formato); **todo** número con `ge`/`le`; **toda** lista con `max_length` y elementos acotados; enums con `Literal`.
- Ids que llegan en el cuerpo: `str` de 24 caracteres (`Field(min_length=24, max_length=24)`) o `UUID4`.
- Normaliza en `field_validator` (como `normalizar_tag` o `_minusculas` del correo).
- Uniones polimórficas con `Field(discriminator=...)`.

```python
# ✅
class SeguimientoIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    estado_nuevo: Estado
    comentario: str = Field(min_length=5, max_length=1000)
    horas: float = Field(ge=0, le=24)

# ❌ sin forbid, sin límites, acepta {"$ne": ""} en un dict
class SeguimientoIn(BaseModel):
    estado_nuevo: str
    comentario: str
    extra: dict
```

### CA-03 · `require_permiso` correcto
La dependencia del usuario es **siempre** `Annotated[dict, Depends(require_permiso("recurso:accion"))]`. Solo `/auth/me` y catálogos públicos para cualquier sesión usan `get_usuario_actual` directo. `require_permiso` deja en el usuario `_permisos` y `_alcance` (los necesitan `filtro_alcance` y `puede_otorgar`). Reglas adicionales dentro de la función (p. ej. "solo un coordinador puede cerrar": `"incidencias:asignar" in usuario["_permisos"]`) responden 403.

### CA-04 · `filtro_alcance` en toda consulta, combinado con `$and`
Toda lectura, búsqueda, pipeline (`$match`), `update_one` y `count_documents` sobre incidencias incluye `filtro_alcance(usuario)`. En código nuevo combínalo con `$and`: con `{**filtro, **filtro_alcance(usuario)}` una clave repetida (`categoria`, `ubicacion.edificio`, `reportante.usuario_id`) **reemplaza** a la otra en silencio.

```python
# ✅ (listar_incidencias)
cursor = col.find({"$and": [filtro_cliente, filtro_alcance(usuario)]}, PROYECCION_LISTA)
# ❌ si el cliente manda ?categoria=academico, el alcance de área desaparece o el filtro del cliente se pierde
cursor = col.find({**filtro_alcance(usuario), **filtro_cliente})
```

Recursos que no son incidencias (usuarios, roles) usan su propia regla de jerarquía: `puede_otorgar` y `_puede_gestionar`.

### CA-05 · 404 fuera de alcance
Usa `_oid(incidencia_id)` (400 si el id está malformado) y `_en_alcance(incidencia_id, usuario, proyeccion)` de `routers/incidencias.py`: devuelve el documento o lanza `404 "Incidencia no encontrada"` tanto si no existe como si es ajena. Nunca 403 por alcance (API-05).

### CA-06 · Operación atómica
Una escritura = un `insert_one`/`update_one` con operadores atómicos y las condiciones de negocio en el filtro (API-19/20). Arreglos embebidos crecen con `$push` + `$each` + `$slice: -MAX_...`. Si `matched_count == 0`, decide 404 (`_en_alcance`) o 409. Pon siempre `fecha_actualizacion` en el `$set`. Fechas con `datetime.now(timezone.utc)`.

### CA-07 · `$jsonSchema` si cambia el documento
Si agregas o cambias un campo guardado en MongoDB, actualiza `esquema_incidencias()` en `scripts/init_db.py` en el mismo PR (con los mismos límites que Pydantic), sube `schema_version` si el cambio no es compatible, corre `python scripts/init_db.py` contra Docker y pide aprobación del DBA (BD-20). Si consultas por un campo nuevo con frecuencia, revisa índices en `crear_indices()` (BD-10).

### CA-08 · Serializa con `a_json`
Respuestas con `a_json(doc)` (`app/core/serial.py`); proyecta solo lo necesario. Nunca devuelvas el documento crudo ni `password_hash` (API-12/13). 201 al crear (`status_code=201`).

### CA-09 · Rate limit si escribe
Todo endpoint que escribe lleva `@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)` debajo del decorador de ruta, y `request: Request` como **primer** parámetro. Si el endpoint tiene costo externo (IA, almacenamiento), agrega un cupo diario en Redis como en `routers/ia.py` o `firmar_evidencia`.

### CA-10 · Registra el router
Si es un archivo nuevo en `app/routers/`, agrégalo a la tupla del `for r in (...)` al final de `app/main.py`. Si el cuerpo puede superar 64 KB, agrégalo a `MAX_BODY` con justificación.

### CA-11 · Pruebas e2e mínimas obligatorias
En `backend/tests/e2e/test_<recurso>.py`, usando los helpers reales de `tests/e2e/helpers.py`. Requiere `docker compose up -d` (MongoDB en `localhost:27017`, Redis base 15; `conftest.py` aborta si apunta a otra base).

| Caso | Obligatorio | Cómo |
|---|---|---|
| Feliz | Siempre | código 200/201 **y** el efecto en la base (`await api.doc(id)`) |
| 400 | Siempre | campo fuera de límite, enum inválido, campo extra, operador `{"$ne": ""}`, id malformado (`"malo"`) |
| 401 | Siempre | sin header y con usuario `inactivo` |
| 403 | Siempre | un rol sin el permiso (`directivo`, `reportante_a`, `tecnico_infra` según el caso) |
| 404 / BOLA | Si recibe id | usuario fuera de alcance (`reportante_b`, `tecnico_redes`, `jefe_a`) y `str(ObjectId())` inexistente |
| 409 | Si aplica | duplicado, estado inválido, límite alcanzado |
| Sin `password_hash` | Automático | `ClienteSeguro` falla si cualquier respuesta lo contiene; no uses otro cliente sin la misma comprobación |
| Sin `null` | Si guarda documento | `assert sin_nulos(doc) == []` |
| 429 | Si tiene rate limit propio | `monkeypatch.setattr(settings, ...)` como `test_limite_de_escritura_por_usuario` |

Helpers disponibles: `api.c` (cliente), `api.h("quien")` (headers con Bearer), `api.oid("quien")`, `api.crear(quien, categoria, **campos)`, `api.crear_en(estado, ...)`, `api.seguimiento(id, estado, quien)`, `api.a_estado(id, estado)`, `api.doc(id)`, `api.usuario_temporal(rol, **extra)`, `cuerpo(categoria, edificio=...)`, `sin_nulos(obj)`, `DETALLES`, `PASSWORD`. Usuarios sembrados: `reportante_a`, `reportante_b`, `tecnico_infra`, `tecnico_infra2`, `tecnico_redes`, `tecnico_inactivo`, `coordinador_infra`, `directivo`, `inactivo`, `jefe_a` (edificio "Edificio A"), `gestor`, `admin`.

Comando: `cd backend && pytest tests/e2e -q` (y `pytest` completo antes del PR).

### CA-12 · Actualiza Postman, Zod y documentación
- Postman: caso feliz + negativos 400/403/404 (API-24).
- Zod en `frontend/src/schemas/` espejo del schema nuevo (FB-12) y función/clave de query en la PWA si ya se consume.
- Si cambia un requerimiento o una regla, actualiza la documentación del proyecto o estas reglas.
- Revisa que el endpoint se vea bien en `http://localhost:8000/docs`.

---

## Plantilla de endpoint (copiable)

Ejemplo real pendiente del proyecto: **RF-COO-03 "Cambiar la prioridad dejando registro en la bitácora"**. Va en `app/routers/incidencias.py` porque es subrecurso de incidencias y reutiliza `_oid`, `_en_alcance`, `MAX_HISTORIAL`.

```python
class PrioridadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prioridad: Prioridad
    comentario: str = Field(min_length=5, max_length=1000)


@router.patch("/{incidencia_id}/prioridad")
@limiter.limit(lambda: settings.limite_escritura, key_func=clave_usuario)
async def cambiar_prioridad(
    request: Request,
    incidencia_id: str,
    datos: PrioridadIn,
    usuario: Annotated[dict, Depends(require_permiso("incidencias:asignar"))],
):
    # 404 si no existe o está fuera de alcance (nunca 403)
    actual = await _en_alcance(incidencia_id, usuario, {"estado": 1, "prioridad": 1})
    if actual["estado"] == "cerrada":
        raise HTTPException(409, "La incidencia está cerrada")
    ahora = datetime.now(timezone.utc)
    # Atómico: el filtro exige que el estado no haya cambiado desde la lectura
    res = await get_db().incidencias_campus.update_one(
        {"$and": [{"_id": actual["_id"], "estado": actual["estado"]}, filtro_alcance(usuario)]},
        {
            "$set": {"prioridad": datos.prioridad, "fecha_actualizacion": ahora},
            "$push": {"historial_seguimiento": {
                "$each": [{
                    "fecha": ahora, "usuario_id": usuario["_id"], "tipo": "prioridad",
                    "estado_nuevo": actual["estado"], "horas": 0,
                    "comentario": f"Prioridad {actual['prioridad']} → {datos.prioridad}: {datos.comentario}",
                }],
                "$slice": -MAX_HISTORIAL,
            }},
        },
    )
    if res.matched_count == 0:
        raise HTTPException(409, "La incidencia cambió de estado; intenta de nuevo")
    return {"ok": True, "prioridad": datos.prioridad}
```

Para un **router nuevo** (otro recurso):

```python
# app/routers/<recurso>.py
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.db import get_db
from app.core.security import require_permiso
from app.core.serial import a_json

router = APIRouter(prefix="/<recurso>", tags=["<recurso>"])


@router.get("")
async def listar_<recurso>(
    usuario: Annotated[dict, Depends(require_permiso("<recurso>:ver"))],
    limite: Annotated[int, Query(ge=1, le=100)] = 50,
):
    cursor = get_db().<coleccion>.find({}, {"campo": 1}).sort("_id", -1).limit(limite)
    return [a_json(d) async for d in cursor]
# y en app/main.py: for r in (auth, incidencias, ..., <recurso>):
```

## Plantilla de prueba e2e (copiable)

```python
# backend/tests/e2e/test_prioridad.py
import pytest
from bson import ObjectId

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


async def _cambiar(api, inc_id, quien="coordinador_infra", **over):
    body = {"prioridad": "critica", "comentario": "Riesgo eléctrico confirmado", **over}
    return await api.c.patch(f"/incidencias/{inc_id}/prioridad", json=body, headers=api.h(quien) if quien else {})


async def test_feliz(api):
    inc = await api.crear(categoria="infraestructura")
    r = await _cambiar(api, inc["_id"])
    assert r.status_code == 200, r.text
    d = await api.doc(inc["_id"])
    assert d["prioridad"] == "critica"
    assert d["historial_seguimiento"][-1]["tipo"] == "prioridad"


@pytest.mark.parametrize("over", [
    {"prioridad": "urgente"}, {"comentario": "abc"}, {"prioridad": {"$ne": ""}}, {"extra": 1},
], ids=["enum", "comentario_corto", "operador_nosql", "campo_extra"])
async def test_400(api, over):
    inc = await api.crear()
    assert (await _cambiar(api, inc["_id"], **over)).status_code == 400
    assert (await _cambiar(api, "malo")).status_code == 400


async def test_401(api):
    inc = await api.crear()
    assert (await _cambiar(api, inc["_id"], quien=None)).status_code == 401
    assert (await _cambiar(api, inc["_id"], quien="inactivo")).status_code == 401


@pytest.mark.parametrize("quien", ["reportante_a", "tecnico_infra", "directivo"])
async def test_403_sin_permiso(api, quien):
    inc = await api.crear()
    assert (await _cambiar(api, inc["_id"], quien=quien)).status_code == 403


async def test_404_fuera_de_alcance(api):
    ajena = await api.crear(categoria="computo_redes")          # fuera del área del coordinador de infraestructura
    assert (await _cambiar(api, ajena["_id"])).status_code == 404
    assert (await _cambiar(api, str(ObjectId()))).status_code == 404
    assert (await api.doc(ajena["_id"]))["prioridad"] == "media"  # no se modificó


async def test_409_cerrada(api):
    inc = await api.crear_en("cerrada")
    assert (await _cambiar(api, inc["_id"])).status_code == 409
```

`password_hash` no necesita prueba explícita: `ClienteSeguro` la hace en cada petición.

---

## Checklist final (Definition of Done)

- [ ] CA-01 Contrato escrito en el PR; permiso existe en `CATALOGO_PERMISOS` (y en roles de sistema si es nuevo).
- [ ] CA-02 Schema con `extra="forbid"` y límites en **todo** campo.
- [ ] CA-03 `require_permiso("…")` correcto.
- [ ] CA-04 `filtro_alcance(usuario)` en toda consulta/actualización/pipeline, combinado con `$and`.
- [ ] CA-05 Fuera de alcance ⇒ 404 (`_en_alcance`); id malformado ⇒ 400 (`_oid`).
- [ ] CA-06 Escritura atómica; condiciones en el filtro; `fecha_actualizacion` en UTC.
- [ ] CA-07 `$jsonSchema` en `init_db.py` actualizado si cambia el documento; aprobación del DBA.
- [ ] CA-08 Respuesta con `a_json`; 201 al crear.
- [ ] CA-09 Rate limit por usuario si escribe (`request: Request` primero).
- [ ] CA-10 Router registrado en `main.py`; `MAX_BODY` solo si hace falta.
- [ ] CA-11 e2e: feliz, 400, 401, 403, 404/BOLA, 409 (si aplica), sin nulos; `pytest` verde.
- [ ] CA-12 Postman, Zod y `/docs` actualizados.
