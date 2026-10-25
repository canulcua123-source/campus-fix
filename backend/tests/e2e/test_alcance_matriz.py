"""Matriz e2e independiente para el alcance de incidencias y usuarios."""

import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from bson import ObjectId

from .helpers import cuerpo

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

ROLES = {
    "REP": "reportante_a",
    "TEC": "tecnico_infra",
    "COO": "coordinador_infra",
    "DIR": "directivo",
    "ADM": "admin",
}
ENDPOINTS = (
    "crear",
    "listar",
    "buscar",
    "detalle",
    "seguimiento",
    "tags",
    "asignacion",
    "firma",
    "evidencia",
    "analitica",
)
CASOS = [(rol, endpoint) for rol in ROLES for endpoint in ENDPOINTS]
MARCA = f"alcance_{uuid.uuid4().hex[:8]}"


def _ids_visibles(rol: str, recursos: dict[str, dict]) -> set[str]:
    if rol == "REP":
        return {recursos["propio"]["_id"]}
    if rol in {"TEC", "COO"}:
        return {recursos["propio"]["_id"], recursos["misma_area"]["_id"]}
    return {r["_id"] for r in recursos.values()}


@pytest_asyncio.fixture(scope="module", loop_scope="session")
async def recursos_alcance(entorno):
    por_endpoint: dict[str, dict[str, dict]] = {}
    for endpoint in ENDPOINTS:
        token = f"matriz{endpoint}{uuid.uuid4().hex[:8]}"
        edificios = {
            "propio": f"{token}-A",
            "misma_area": f"{token}-B",
            "otra_area": f"{token}-C",
        }
        recursos = {
            "propio": await entorno.crear(
                "reportante_a",
                "infraestructura",
                titulo=f"{token} propio",
                edificio=edificios["propio"],
                tags=[MARCA],
            ),
            "misma_area": await entorno.crear(
                "reportante_b",
                "infraestructura",
                titulo=f"{token} misma area",
                edificio=edificios["misma_area"],
                tags=[MARCA],
            ),
            "otra_area": await entorno.crear(
                "reportante_b",
                "computo_redes",
                titulo=f"{token} otra area",
                edificio=edificios["otra_area"],
                tags=[MARCA],
            ),
        }
        por_endpoint[endpoint] = {"token": token, "edificios": edificios, **recursos}

    evidencia = por_endpoint["evidencia"]
    for recurso in (evidencia["propio"], evidencia["misma_area"], evidencia["otra_area"]):
        await entorno.db.incidencias_campus.update_one(
            {"_id": ObjectId(recurso["_id"])},
            {
                "$push": {
                    "evidencias_adjuntas": {
                        "evidencia_id": "11111111-1111-4111-8111-111111111111",
                        "nombre_archivo": "evidencia-ficticia.jpg",
                        "tipo_mime": "image/jpeg",
                        "peso_kb": 1,
                        "url_storage": "evidencias/ficticias/alcance.jpg",
                        "fecha_carga": datetime.now(timezone.utc),
                        "subido_por": entorno.oid("admin"),
                    }
                }
            },
        )

    analitica = por_endpoint["analitica"]
    for recurso in (analitica["propio"], analitica["misma_area"], analitica["otra_area"]):
        await entorno.a_estado(recurso["_id"], "resuelta")

    yield por_endpoint
    await entorno.db.incidencias_campus.delete_many({"tags": MARCA})


@pytest.mark.parametrize("rol,endpoint", CASOS, ids=[f"{rol}-{endpoint}" for rol, endpoint in CASOS])
async def test_rol_endpoint_alcance(api, recursos_alcance, rol, endpoint):
    """Contrasta cada rol con expectativas declaradas aquí, no con filtro_alcance."""
    quien = ROLES[rol]
    recursos = recursos_alcance[endpoint]
    visibles = _ids_visibles(rol, {k: recursos[k] for k in ("propio", "misma_area", "otra_area")})
    todos = {recursos[k]["_id"] for k in ("propio", "misma_area", "otra_area")}
    ocultos = todos - visibles

    if endpoint == "crear":
        r = await api.c.post(
            "/incidencias",
            json=cuerpo("computo_redes", titulo=f"Creación de alcance {uuid.uuid4().hex[:8]}", tags=[MARCA]),
            headers=api.h(quien),
        )
        if rol == "DIR":
            assert r.status_code == 403
        else:
            assert r.status_code == 201
            creado = await api.doc(r.json()["_id"])
            assert creado["reportante"]["usuario_id"] == api.oid(quien)
        return

    if endpoint == "listar":
        r = await api.c.get("/incidencias", params={"limite": 100}, headers=api.h(quien))
        assert r.status_code == 200
        devueltos = {d["_id"] for d in r.json()} & todos
        assert devueltos == visibles
        return

    if endpoint == "buscar":
        r = await api.c.get("/incidencias/buscar", params={"q": recursos["token"]}, headers=api.h(quien))
        if rol == "REP":
            assert r.status_code == 403
        else:
            assert r.status_code == 200
            assert {d["_id"] for d in r.json()} & todos == visibles
        return

    if endpoint == "detalle":
        for incidencia_id in visibles:
            assert (await api.c.get(f"/incidencias/{incidencia_id}", headers=api.h(quien))).status_code == 200
        inexistente = str(ObjectId())
        no_encontrado = await api.c.get(f"/incidencias/{inexistente}", headers=api.h(quien))
        assert no_encontrado.status_code == 404
        for incidencia_id in ocultos:
            fuera = await api.c.get(f"/incidencias/{incidencia_id}", headers=api.h(quien))
            assert fuera.status_code == 404 and fuera.json() == no_encontrado.json()
        return

    if endpoint == "seguimiento":
        payload = {"estado_nuevo": "en_proceso", "comentario": "Revisión de alcance", "horas": 0}
        if rol in {"REP", "DIR"}:
            r = await api.c.patch(
                f"/incidencias/{recursos['propio']['_id']}/seguimiento", json=payload, headers=api.h(quien)
            )
            assert r.status_code == 403
        else:
            clave = {"TEC": "propio", "COO": "misma_area", "ADM": "otra_area"}[rol]
            permitido = recursos[clave]["_id"]
            assert (
                await api.c.patch(f"/incidencias/{permitido}/seguimiento", json=payload, headers=api.h(quien))
            ).status_code == 200
            for incidencia_id in ocultos:
                assert (
                    await api.c.patch(f"/incidencias/{incidencia_id}/seguimiento", json=payload, headers=api.h(quien))
                ).status_code == 404
        return

    if endpoint == "tags":
        payload = {"tags": ["auditoria_alcance"]}
        if rol in {"REP", "DIR"}:
            r = await api.c.post(f"/incidencias/{recursos['propio']['_id']}/tags", json=payload, headers=api.h(quien))
            assert r.status_code == 403
        else:
            permitido = recursos["propio"]["_id"] if rol != "ADM" else recursos["otra_area"]["_id"]
            assert (
                await api.c.post(f"/incidencias/{permitido}/tags", json=payload, headers=api.h(quien))
            ).status_code == 200
            for incidencia_id in ocultos:
                assert (
                    await api.c.post(f"/incidencias/{incidencia_id}/tags", json=payload, headers=api.h(quien))
                ).status_code == 404
        return

    if endpoint == "asignacion":
        payload = {"tecnico_id": str(api.oid("tecnico_infra"))}
        if rol not in {"COO", "ADM"}:
            r = await api.c.patch(
                f"/incidencias/{recursos['propio']['_id']}/asignacion", json=payload, headers=api.h(quien)
            )
            assert r.status_code == 403
        else:
            assert (
                await api.c.patch(
                    f"/incidencias/{recursos['propio']['_id']}/asignacion", json=payload, headers=api.h(quien)
                )
            ).status_code == 200
            for incidencia_id in ocultos:
                assert (
                    await api.c.patch(f"/incidencias/{incidencia_id}/asignacion", json=payload, headers=api.h(quien))
                ).status_code == 404
        return

    if endpoint == "evidencia":
        evidencia_id = "11111111-1111-4111-8111-111111111111"
        for incidencia_id in visibles:
            r = await api.c.get(f"/incidencias/{incidencia_id}/evidencias/{evidencia_id}/url", headers=api.h(quien))
            assert r.status_code == 200 and "url" in r.json()
        for incidencia_id in ocultos:
            r = await api.c.get(f"/incidencias/{incidencia_id}/evidencias/{evidencia_id}/url", headers=api.h(quien))
            assert r.status_code == 404 and "url" not in r.json()
        return

    if endpoint == "firma":
        payload = {"nombre_archivo": "alcance.jpg", "tipo_mime": "image/jpeg", "peso_bytes": 100}
        if rol == "DIR":
            r = await api.c.post(
                f"/incidencias/{recursos['propio']['_id']}/evidencias/firma", json=payload, headers=api.h(quien)
            )
            assert r.status_code == 403
        else:
            for incidencia_id in visibles:
                r = await api.c.post(
                    f"/incidencias/{incidencia_id}/evidencias/firma", json=payload, headers=api.h(quien)
                )
                assert r.status_code == 200 and "upload_url" in r.json()
            for incidencia_id in ocultos:
                r = await api.c.post(
                    f"/incidencias/{incidencia_id}/evidencias/firma", json=payload, headers=api.h(quien)
                )
                assert r.status_code == 404 and "upload_url" not in r.json()
        return

    r = await api.c.get("/analitica/edificios", headers=api.h(quien))
    if rol in {"REP", "TEC"}:
        assert r.status_code == 403
    else:
        assert r.status_code == 200
        edificios = {d["edificio"] for d in r.json()} & set(recursos["edificios"].values())
        esperados = {
            recursos["edificios"][clave]
            for clave in ("propio", "misma_area", "otra_area")
            if recursos[clave]["_id"] in visibles
        }
        assert edificios == esperados


async def test_alcance_edificio_personalizado(api):
    token = uuid.uuid4().hex[:8]
    dentro = await api.crear("reportante_a", "computo_redes", edificio="Edificio A", tags=[MARCA], titulo=f"edi{token}")
    fuera = await api.crear(
        "reportante_b", "infraestructura", edificio="Edificio B", tags=[MARCA], titulo=f"edi{token}"
    )
    r = await api.c.get("/incidencias", headers=api.h("jefe_a"))
    ids = {d["_id"] for d in r.json()}
    assert dentro["_id"] in ids and fuera["_id"] not in ids
    assert (await api.c.get(f"/incidencias/{fuera['_id']}", headers=api.h("jefe_a"))).status_code == 404


async def test_patch_usuario_no_gestionable_404(api):
    sufijo = uuid.uuid4().hex[:8]
    clave_gestor = f"gestor_{sufijo}"
    clave_lector = f"lector_{sufijo}"
    permisos_gestor = ["usuarios:gestionar", "incidencias:ver"]
    await api.db.roles.insert_many(
        [
            {"clave": clave_gestor, "nombre": "Gestor de prueba", "permisos": permisos_gestor, "alcance": "area"},
            {"clave": clave_lector, "nombre": "Lector de prueba", "permisos": ["incidencias:ver"], "alcance": "area"},
        ]
    )
    actor = await api.usuario_temporal(rol=clave_gestor, areas=["infraestructura"])
    gestionable = await api.usuario_temporal(rol=clave_lector, areas=["infraestructura"])
    fuera = await api.usuario_temporal(rol=clave_lector, areas=["computo_redes"])
    inexistente = ObjectId()
    antes_fuera = await api.db.usuarios.find_one({"_id": fuera["_id"]})

    cuerpo = {"nombre": "Nombre que no debe aplicarse"}
    respuesta_fuera = await api.c.patch(
        f"/usuarios/{fuera['_id']}", json=cuerpo, headers={"Authorization": f"Bearer {actor['token']}"}
    )
    respuesta_inexistente = await api.c.patch(
        f"/usuarios/{inexistente}", json=cuerpo, headers={"Authorization": f"Bearer {actor['token']}"}
    )
    assert respuesta_fuera.status_code == respuesta_inexistente.status_code == 404
    assert respuesta_fuera.json() == respuesta_inexistente.json() == {"detail": "Usuario no encontrado"}
    assert respuesta_fuera.headers["content-type"] == respuesta_inexistente.headers["content-type"]
    assert respuesta_fuera.headers.get("content-length") == respuesta_inexistente.headers.get("content-length")
    assert await api.db.usuarios.find_one({"_id": inexistente}) is None
    assert await api.db.usuarios.find_one({"_id": fuera["_id"]}) == antes_fuera
    texto = respuesta_fuera.text.lower()
    assert not any(
        valor in texto
        for valor in (
            fuera["correo"].lower(),
            antes_fuera["nombre"].lower(),
            clave_lector,
            "computo_redes",
            "areas",
            "edificios",
            str(fuera["_id"]),
        )
    )

    permitido = await api.c.patch(
        f"/usuarios/{gestionable['_id']}",
        json={"nombre": "Usuario gestionable"},
        headers={"Authorization": f"Bearer {actor['token']}"},
    )
    assert permitido.status_code == 200 and permitido.json()["nombre"] == "Usuario gestionable"
    autoescalado = await api.c.patch(
        f"/usuarios/{actor['_id']}",
        json={"areas": ["infraestructura", "computo_redes"]},
        headers={"Authorization": f"Bearer {actor['token']}"},
    )
    assert autoescalado.status_code == 400
