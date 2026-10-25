import copy
import re
from datetime import datetime, timezone

import pytest
from bson import ObjectId
from pymongo.errors import WriteError

from .helpers import DETALLES, cuerpo, sin_nulos

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

RE_CODIGO = re.compile(r"^INC-\d{4}-\d{4}-(RED|INF|ACA)-\d{4}$")
PREFIJO = {"computo_redes": "RED", "infraestructura": "INF", "academico": "ACA"}


@pytest.mark.parametrize("categoria", ["computo_redes", "infraestructura", "academico"])
async def test_crear_por_categoria(api, categoria):
    b = cuerpo(categoria, tags=["Aire Acondicionado", "  Urgente ", "urgente"])
    r = await api.c.post("/incidencias", json=b, headers=api.h("reportante_a"))
    assert r.status_code == 201, r.text
    out = r.json()
    assert set(out) >= {"_id", "codigo", "estado"} and out["estado"] == "abierta"
    assert RE_CODIGO.match(out["codigo"]) and out["codigo"].split("-")[3] == PREFIJO[categoria]

    doc = await api.doc(out["_id"])
    assert doc["reportante"]["usuario_id"] == api.oid("reportante_a")
    assert len(doc["historial_seguimiento"]) == 1
    assert doc["historial_seguimiento"][0]["estado_nuevo"] == "abierta"
    assert sorted(doc["tags"]) == ["aire_acondicionado", "urgente"]
    assert doc["categoria"] == categoria == doc["detalle_especifico"]["categoria"]
    assert sin_nulos(doc) == []


async def test_crear_sin_piso_no_guarda_null(api):
    b = cuerpo("academico")
    b["ubicacion"] = {"edificio": "Edificio C", "piso": None, "aula": "Lab 3"}
    r = await api.c.post("/incidencias", json=b, headers=api.h("reportante_b"))
    assert r.status_code == 201, r.text
    doc = await api.doc(r.json()["_id"])
    assert "piso" not in doc["ubicacion"]
    assert sin_nulos(doc) == []


async def test_codigo_incrementa_por_categoria(api):
    a = await api.crear("reportante_a", "academico")
    b = await api.crear("reportante_a", "academico")
    c = await api.crear("reportante_a", "computo_redes")
    na, nb = int(a["codigo"][-4:]), int(b["codigo"][-4:])
    assert nb == na + 1
    assert a["codigo"][:-4] == b["codigo"][:-4]
    assert "-RED-" in c["codigo"]


@pytest.mark.parametrize(
    "quien,esperado",
    [
        ("reportante_a", 201),
        ("tecnico_infra", 201),
        ("coordinador_infra", 201),
        ("admin", 201),
        ("directivo", 403),
        ("jefe_a", 403),
    ],
)
async def test_crear_permisos(api, quien, esperado):
    r = await api.c.post("/incidencias", json=cuerpo("infraestructura", edificio="Edificio B"), headers=api.h(quien))
    assert r.status_code == esperado, r.text


async def test_directivo_no_puede_crear_403(api):
    antes = await api.db.incidencias_campus.count_documents({})
    r = await api.c.post(
        "/incidencias", json=cuerpo("infraestructura", edificio="Edificio B"), headers=api.h("directivo")
    )
    assert r.status_code == 403, r.text
    assert await api.db.incidencias_campus.count_documents({}) == antes
    assert (await api.c.get("/incidencias", headers=api.h("directivo"))).status_code == 200


async def test_crear_sin_token(api):
    r = await api.c.post("/incidencias", json=cuerpo())
    assert r.status_code == 401


def _invalidos():
    casos = {}
    acad_vlan = cuerpo("academico")
    acad_vlan["detalle_especifico"]["vlan"] = 10
    casos["academico_con_vlan"] = acad_vlan
    cruzado = cuerpo("academico")
    cruzado["detalle_especifico"] = {**DETALLES["computo_redes"], "categoria": "academico"}
    casos["detalle_de_otra_categoria"] = cruzado
    casos["campo_extra"] = cuerpo(extra="x")
    extra_det = cuerpo("infraestructura")
    extra_det["detalle_especifico"]["color"] = "rojo"
    casos["campo_extra_detalle"] = extra_det
    for nombre, valor in [("ip_mala", "999.1.1.1"), ("ip_texto", "no-ip"), ("vlan_0", 0), ("vlan_4095", 4095)]:
        b = cuerpo("computo_redes")
        b["detalle_especifico"]["ip" if nombre.startswith("ip") else "vlan"] = valor
        casos[nombre] = b
    casos["titulo_corto"] = cuerpo(titulo="abcd")
    casos["descripcion_corta"] = cuerpo(descripcion="corta")
    casos["prioridad_invalida"] = cuerpo(prioridad="urgentisima")
    casos["tag_invalido"] = cuerpo(tags=["a"])
    casos["tag_caracteres"] = cuerpo(tags=["$where"])
    casos["mas_de_15_tags"] = cuerpo(tags=[f"tag{i}" for i in range(16)])
    casos["nosql_titulo"] = cuerpo(titulo={"$ne": ""})
    casos["nosql_prioridad"] = cuerpo(prioridad={"$gt": ""})
    casos["nosql_edificio"] = cuerpo(ubicacion={"edificio": {"$ne": None}, "aula": "1"})
    sin_cat = cuerpo()
    del sin_cat["detalle_especifico"]["categoria"]
    casos["detalle_sin_categoria"] = sin_cat
    sin_det = cuerpo()
    del sin_det["detalle_especifico"]
    casos["sin_detalle"] = sin_det
    return casos


@pytest.mark.parametrize("nombre,body", list(_invalidos().items()), ids=list(_invalidos()))
async def test_crear_invalido_400(api, nombre, body):
    antes = await api.db.incidencias_campus.count_documents({})
    r = await api.c.post("/incidencias", json=body, headers=api.h("reportante_a"))
    assert r.status_code == 400, f"{nombre}: {r.status_code} {r.text}"
    assert r.json().get("error") == "validacion", r.text
    assert await api.db.incidencias_campus.count_documents({}) == antes


async def test_crear_json_malformado(api):
    r = await api.c.post(
        "/incidencias", content=b"{no json", headers={**api.h("reportante_a"), "Content-Type": "application/json"}
    )
    assert r.status_code == 400


# ---------- Validación a nivel BD ($jsonSchema) ----------


def _doc_valido(uid: ObjectId) -> dict:
    ahora = datetime.now(timezone.utc)
    return {
        "schema_version": 1,
        "codigo": f"INC-DB-{ObjectId()}",
        "titulo": "Documento directo",
        "descripcion": "Insertado directamente en la BD",
        "categoria": "academico",
        "estado": "abierta",
        "prioridad": "baja",
        "ubicacion": {"edificio": "Edificio C", "piso": 2, "aula": "201"},
        "reportante": {"usuario_id": uid, "nombre": "X"},
        "detalle_especifico": copy.deepcopy(DETALLES["academico"]),
        "fecha_creacion": ahora,
        "fecha_actualizacion": ahora,
        "tags": [],
        "historial_seguimiento": [],
        "evidencias_adjuntas": [],
        "horas_invertidas": 0,
    }


async def test_bd_documento_valido_se_acepta(api):
    doc = _doc_valido(api.oid("admin"))
    res = await api.db.incidencias_campus.insert_one(doc)
    await api.db.incidencias_campus.delete_one({"_id": res.inserted_id})


@pytest.mark.parametrize(
    "caso", ["faltan_campos", "categoria_no_coincide", "piso_null", "evidencias_11", "tags_duplicados"]
)
async def test_bd_rechaza_121(api, caso):
    doc = _doc_valido(api.oid("admin"))
    if caso == "faltan_campos":
        for k in ("estado", "prioridad", "historial_seguimiento"):
            del doc[k]
    elif caso == "categoria_no_coincide":
        doc["detalle_especifico"] = copy.deepcopy(DETALLES["computo_redes"])
    elif caso == "piso_null":
        doc["ubicacion"]["piso"] = None
    elif caso == "evidencias_11":
        ev = {
            "nombre_archivo": "a.jpg",
            "tipo_mime": "image/jpeg",
            "peso_kb": 1,
            "url_storage": "x",
            "fecha_carga": datetime.now(timezone.utc),
        }
        doc["evidencias_adjuntas"] = [dict(ev) for _ in range(11)]
    elif caso == "tags_duplicados":
        doc["tags"] = ["a1", "a1"]
    with pytest.raises(WriteError) as ei:
        await api.db.incidencias_campus.insert_one(doc)
    assert ei.value.code == 121
