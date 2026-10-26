import re
import uuid

import pytest
from bson import ObjectId

from app.core import storage
from app.core.config import settings

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

EXT = {"image/jpeg": {"jpg", "jpeg"}, "image/png": {"png"}, "image/webp": {"webp"}, "application/pdf": {"pdf"}}


def _meta(mime="image/jpeg", nombre="foto.jpg", peso=500_000):
    return {"nombre_archivo": nombre, "tipo_mime": mime, "peso_bytes": peso}


async def _firma(api, inc_id, quien="reportante_a", **kw):
    return await api.c.post(f"/incidencias/{inc_id}/evidencias/firma", json=_meta(**kw), headers=api.h(quien))


async def _registrar(api, inc_id, evidencia_id: str, quien="reportante_a"):
    return await api.c.post(
        f"/incidencias/{inc_id}/evidencias", json={"evidencia_id": evidencia_id}, headers=api.h(quien)
    )


@pytest.mark.parametrize("mime", list(EXT))
async def test_firma_ok(api, mime):
    inc = await api.crear()
    r = await _firma(api, inc["_id"], mime=mime)
    assert r.status_code == 200, r.text
    f = r.json()
    assert uuid.UUID(f["evidencia_id"]).version == 4
    m = re.fullmatch(r"evidencias/(?P<codigo>[^/]+)/(?P<eid>[0-9a-f-]{36})\.(?P<ext>\w+)", f["url_storage"])
    assert m, f["url_storage"]
    assert m["codigo"] == inc["codigo"] and m["eid"] == f["evidencia_id"] and m["ext"] in EXT[mime]
    assert "X-Amz-Signature" in f["upload_url"] and f["expira_en"] == 300
    # tipo y tamaño quedan dentro de la firma
    assert "content-length" in f["upload_url"].lower() and "content-type" in f["upload_url"].lower()


@pytest.mark.parametrize(
    "kw",
    [
        {"mime": "image/gif"},
        {"mime": "text/html"},
        {"peso": 0},
        {"peso": 10 * 1024 * 1024 + 1},
        {"nombre": "../../etc/passwd"},
        {"nombre": "a/b.jpg"},
        {"nombre": "a\\b.jpg"},
        {"nombre": "..jpg"},
        {"nombre": ""},
    ],
    ids=["gif", "html", "peso0", "peso_grande", "traversal", "slash", "backslash", "dotdot", "vacio"],
)
async def test_firma_invalida_400(api, kw):
    inc = await api.crear()
    r = await _firma(api, inc["_id"], **kw)
    assert r.status_code == 400, r.text


async def test_firma_permisos_alcance(api):
    inc = await api.crear(edificio="Edificio B")
    assert (await _firma(api, inc["_id"], quien="directivo")).status_code == 403
    assert (await _firma(api, inc["_id"], quien="reportante_b")).status_code == 404
    assert (await _firma(api, inc["_id"], quien="tecnico_redes")).status_code == 404
    assert (await _firma(api, str(ObjectId()), quien="admin")).status_code == 404
    assert (await _firma(api, "malo", quien="admin")).status_code == 400
    assert (await _firma(api, inc["_id"], quien="tecnico_infra")).status_code == 200


async def test_registrar_y_url(api):
    inc = await api.crear()
    f = (await _firma(api, inc["_id"], mime="image/png", nombre="foto.png", peso=2048)).json()
    r = await _registrar(api, inc["_id"], f["evidencia_id"])
    assert r.status_code == 201, r.text
    d = await api.doc(inc["_id"])
    assert len(d["evidencias_adjuntas"]) == 1
    ev = d["evidencias_adjuntas"][0]
    # los metadatos salen de lo que firmó el servidor, no del cliente
    assert ev["url_storage"] == f["url_storage"] and ev["tipo_mime"] == "image/png" and ev["peso_kb"] == 2

    r = await api.c.get(f"/incidencias/{inc['_id']}/evidencias/{f['evidencia_id']}/url", headers=api.h("reportante_a"))
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert "X-Amz-Signature" in url and r.json()["expira_en"] == 300
    assert f["url_storage"] in url and "attachment" in url

    # reusar la misma firma: ya se consumió
    assert (await _registrar(api, inc["_id"], f["evidencia_id"])).status_code == 400
    r = await api.c.get(f"/incidencias/{inc['_id']}/evidencias/{uuid.uuid4()}/url", headers=api.h("reportante_a"))
    assert r.status_code == 404
    for quien in ("reportante_b", "tecnico_redes"):
        r = await api.c.get(f"/incidencias/{inc['_id']}/evidencias/{f['evidencia_id']}/url", headers=api.h(quien))
        assert r.status_code == 404


async def test_registrar_sin_firma_o_firma_ajena(api):
    inc = await api.crear()
    otra = await api.crear()
    f_otra = (await _firma(api, otra["_id"])).json()
    # UUID inventado: el servidor nunca lo firmó
    assert (await _registrar(api, inc["_id"], str(uuid.uuid4()))).status_code == 400
    # firma emitida para otra incidencia
    assert (await _registrar(api, inc["_id"], f_otra["evidencia_id"])).status_code == 400
    assert (await _registrar(api, inc["_id"], "no-uuid")).status_code == 400
    assert (await api.doc(inc["_id"]))["evidencias_adjuntas"] == []
    # firma de otro usuario (tecnico_infra firma, reportante_a intenta registrarla)
    f_tec = (await _firma(api, inc["_id"], quien="tecnico_infra")).json()
    assert (await _registrar(api, inc["_id"], f_tec["evidencia_id"], quien="reportante_a")).status_code == 400
    # fuera de alcance / sin permiso
    f = (await _firma(api, inc["_id"])).json()
    assert (await _registrar(api, inc["_id"], f["evidencia_id"], quien="reportante_b")).status_code == 404
    assert (await _registrar(api, inc["_id"], f["evidencia_id"], quien="directivo")).status_code == 403


async def test_registro_verifica_objeto_en_r2(api, monkeypatch):
    inc = await api.crear()
    monkeypatch.setattr(settings, "r2_verificar_subida", True)
    f = (await _firma(api, inc["_id"], peso=1000)).json()
    monkeypatch.setattr(storage, "tamano_objeto", lambda clave: None)  # no se subió
    assert (await _registrar(api, inc["_id"], f["evidencia_id"])).status_code == 400
    f = (await _firma(api, inc["_id"], peso=1000)).json()
    monkeypatch.setattr(storage, "tamano_objeto", lambda clave: 999)  # tamaño distinto al firmado
    assert (await _registrar(api, inc["_id"], f["evidencia_id"])).status_code == 400
    f = (await _firma(api, inc["_id"], peso=1000)).json()
    monkeypatch.setattr(storage, "tamano_objeto", lambda clave: 1000)
    movidos = []
    monkeypatch.setattr(storage, "promover", lambda origen, destino: movidos.append((origen, destino)))
    assert (await _registrar(api, inc["_id"], f["evidencia_id"])).status_code == 201
    # se sube a staging/ y al verificarse se copia a la ruta definitiva
    assert movidos == [(f"staging/{f['url_storage']}", f["url_storage"])]


async def test_maximo_10_evidencias(api):
    inc = await api.crear()
    for i in range(10):
        f = (await _firma(api, inc["_id"], nombre=f"f{i}.jpg")).json()
        r = await _registrar(api, inc["_id"], f["evidencia_id"])
        assert r.status_code == 201, f"{i}: {r.text}"
    assert (await _firma(api, inc["_id"], nombre="f10.jpg")).status_code == 409
    assert len((await api.doc(inc["_id"]))["evidencias_adjuntas"]) == 10


async def test_firmas_pendientes_limitadas(api):
    """No se pueden pedir firmas ilimitadas (objetos huérfanos en R2): cuentan contra el máximo de 10."""
    inc = await api.crear()
    for quien in ("reportante_a", "tecnico_infra"):
        for i in range(5):
            assert (await _firma(api, inc["_id"], quien=quien, nombre=f"p{i}.jpg")).status_code == 200
    assert (await _firma(api, inc["_id"], quien="coordinador_infra", nombre="p10.jpg")).status_code == 409
