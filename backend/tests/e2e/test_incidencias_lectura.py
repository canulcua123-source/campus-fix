import re

import pytest
from bson import ObjectId

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

RE_OID = re.compile(r"^[0-9a-f]{24}$")


async def _listar(api, quien, **params):
    r = await api.c.get("/incidencias", params=params, headers=api.h(quien))
    assert r.status_code == 200, r.text
    return r.json()


async def test_alcance_listado(api):
    a_infra = await api.crear("reportante_a", "infraestructura", edificio="Edificio A")
    a_red = await api.crear("reportante_a", "computo_redes", edificio="Edificio B")
    b_infra = await api.crear("reportante_b", "infraestructura", edificio="Edificio B")
    b_acad = await api.crear("reportante_b", "academico", edificio="Edificio A")
    todos = {a_infra["_id"], a_red["_id"], b_infra["_id"], b_acad["_id"]}

    # reportante: solo las propias
    ids_a = {d["_id"] for d in await _listar(api, "reportante_a")}
    assert {a_infra["_id"], a_red["_id"]} <= ids_a and not ({b_infra["_id"], b_acad["_id"]} & ids_a)
    for d in await _listar(api, "reportante_b"):
        doc = await api.doc(d["_id"])
        assert doc["reportante"]["usuario_id"] == api.oid("reportante_b")

    # técnico / coordinador de infraestructura: solo esa categoría
    for quien in ("tecnico_infra", "coordinador_infra"):
        lista = await _listar(api, quien, edificio="Edificio B")
        assert all(d["categoria"] == "infraestructura" for d in lista), quien
        assert b_infra["_id"] in {d["_id"] for d in lista}
        assert a_red["_id"] not in {d["_id"] for d in lista}
    # tecnico_redes no ve infra
    assert all(d["categoria"] == "computo_redes" for d in await _listar(api, "tecnico_redes"))

    # jefe de edificio: solo Edificio A
    lista = await _listar(api, "jefe_a")
    assert lista and all(d["ubicacion"]["edificio"] == "Edificio A" for d in lista)

    # directivo y admin: todo
    for quien in ("directivo", "admin"):
        ids = {d["_id"] for d in await _listar(api, quien, edificio="Edificio A")} | {
            d["_id"] for d in await _listar(api, quien, edificio="Edificio B")}
        assert todos <= ids, quien


async def test_filtro_que_choca_con_alcance(api):
    """Un filtro del cliente sobre el mismo campo del alcance no debe ampliar ni ignorarse: intersección."""
    await api.crear("reportante_a", "infraestructura", edificio="Edificio B")
    await api.crear("reportante_a", "computo_redes", edificio="Edificio A")
    lista = await _listar(api, "jefe_a", edificio="Edificio B")
    assert all(d["ubicacion"]["edificio"] == "Edificio A" for d in lista), "fuga de alcance"
    lista_t = await _listar(api, "tecnico_infra", categoria="computo_redes")
    assert all(d["categoria"] == "infraestructura" for d in lista_t), "fuga de alcance"
    assert lista == [], "filtro edificio ignorado: debió devolver intersección vacía"
    assert lista_t == [], "filtro categoria ignorado: debió devolver intersección vacía"


async def test_listado_filtros(api):
    inc = await api.crear("reportante_a", "academico", edificio="Edificio C", prioridad="critica")
    await api.a_estado(inc["_id"], "en_espera")
    for params, campo in [({"estado": "en_espera"}, "estado"), ({"categoria": "academico"}, "categoria"),
                          ({"prioridad": "critica"}, "prioridad")]:
        lista = await _listar(api, "admin", **params)
        assert lista and all(d[campo] == list(params.values())[0] for d in lista), params
        assert inc["_id"] in {d["_id"] for d in lista}
    lista = await _listar(api, "admin", edificio="Edificio C", categoria="academico", estado="en_espera", prioridad="critica")
    assert inc["_id"] in {d["_id"] for d in lista}
    assert all(d["ubicacion"]["edificio"] == "Edificio C" for d in lista)


@pytest.mark.parametrize("params", [
    {"estado": "borrado"}, {"categoria": "otra"}, {"prioridad": "maxima"}, {"estado": "{\"$ne\": null}"},
])
async def test_listado_filtro_invalido(api, params):
    r = await api.c.get("/incidencias", params=params, headers=api.h("admin"))
    assert r.status_code == 400, r.text


async def test_listado_inyeccion_en_query(api):
    r = await api.c.get("/incidencias?estado[$ne]=x&edificio[$ne]=x", headers=api.h("reportante_b"))
    assert r.status_code in (200, 400)
    if r.status_code == 200:
        for d in r.json():
            assert (await api.doc(d["_id"]))["reportante"]["usuario_id"] == api.oid("reportante_b")


# ---------- búsqueda ----------

async def test_buscar(api):
    infra = await api.crear("reportante_a", "infraestructura", titulo="Transformador zumbando fuerte",
                            descripcion="El transformador del pasillo hace un zumbido constante")
    infra2 = await api.crear("reportante_a", "infraestructura", titulo="Puerta atorada del aula",
                             descripcion="Se escucha un leve zumbido cerca del transformador")
    redes = await api.crear("reportante_a", "computo_redes", titulo="Switch con zumbido",
                            descripcion="Switch del rack con zumbido extraño y pérdida de paquetes")

    r = await api.c.get("/incidencias/buscar", params={"q": "transformador zumbido"}, headers=api.h("admin"))
    assert r.status_code == 200, r.text
    res = r.json()
    ids = [d["_id"] for d in res]
    assert {infra["_id"], infra2["_id"]} <= set(ids)
    scores = [d["score"] for d in res]
    assert scores == sorted(scores, reverse=True)

    r = await api.c.get("/incidencias/buscar", params={"q": "zumbido"}, headers=api.h("tecnico_redes"))
    assert r.status_code == 200
    ids = {d["_id"] for d in r.json()}
    assert redes["_id"] in ids and infra["_id"] not in ids and infra2["_id"] not in ids
    assert all(d["categoria"] == "computo_redes" for d in r.json())

    r = await api.c.get("/incidencias/buscar", params={"q": "zumbido"}, headers=api.h("jefe_a"))
    assert r.status_code == 200
    assert all(d["ubicacion"]["edificio"] == "Edificio A" for d in r.json())


@pytest.mark.parametrize("quien,q,esperado", [
    ("reportante_a", "zumbido", 403),
    ("tecnico_infra", "z", 400),
    ("tecnico_infra", "x" * 101, 400),
    ("tecnico_infra", None, 400),
    ("directivo", "zumbido", 200),
])
async def test_buscar_validaciones(api, quien, q, esperado):
    params = {} if q is None else {"q": q}
    r = await api.c.get("/incidencias/buscar", params=params, headers=api.h(quien))
    assert r.status_code == esperado, r.text


# ---------- detalle ----------

async def test_detalle(api):
    inc = await api.crear("reportante_a", "infraestructura", edificio="Edificio A")
    r = await api.c.get(f"/incidencias/{inc['_id']}", headers=api.h("reportante_a"))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["_id"] == inc["_id"] and d["codigo"] == inc["codigo"]
    assert RE_OID.match(d["reportante"]["usuario_id"])
    assert all(RE_OID.match(h["usuario_id"]) for h in d["historial_seguimiento"])
    for campo in ("titulo", "descripcion", "detalle_especifico", "historial_seguimiento", "evidencias_adjuntas",
                  "tags", "fecha_creacion", "horas_invertidas", "ubicacion", "prioridad"):
        assert campo in d, campo

    for quien in ("tecnico_infra", "coordinador_infra", "jefe_a", "directivo", "admin"):
        r = await api.c.get(f"/incidencias/{inc['_id']}", headers=api.h(quien))
        assert r.status_code == 200, quien


async def test_detalle_fuera_de_alcance_404(api):
    infra_b = await api.crear("reportante_a", "infraestructura", edificio="Edificio B")
    for quien in ("reportante_b", "tecnico_redes", "jefe_a"):
        r = await api.c.get(f"/incidencias/{infra_b['_id']}", headers=api.h(quien))
        assert r.status_code == 404, f"{quien}: {r.status_code}"
    r = await api.c.get(f"/incidencias/{ObjectId()}", headers=api.h("admin"))
    assert r.status_code == 404
    for malo in ("no-es-oid", "123", "zzzzzzzzzzzzzzzzzzzzzzzz"):
        r = await api.c.get(f"/incidencias/{malo}", headers=api.h("admin"))
        assert r.status_code == 400, malo
