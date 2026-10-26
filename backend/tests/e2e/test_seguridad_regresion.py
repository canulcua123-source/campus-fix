"""Regresiones de la auditoría de seguridad (ronda 1): escalamiento por alcance, autoedición,
técnico asignado, bloqueo por cuenta, cupo de IA, tamaño de cuerpo y eco de valores en errores."""

import io

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.main import app
from app.routers import ia as ia_router

from .test_analitica_ia import ANALISIS, _imagen_png

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]

PERMISOS_GESTOR = [
    "usuarios:gestionar",
    "roles:gestionar",
    "incidencias:ver",
    "incidencias:buscar",
    "analitica:ver",
    "seguimiento:registrar",
]


async def _gestor_area(api) -> dict:
    """Gestor delegado con alcance de área (infraestructura): puede administrar, pero no más allá de su área."""
    if not await api.db.roles.find_one({"clave": "gestor_area"}):
        await api.db.roles.insert_many(
            [
                {
                    "clave": "gestor_area",
                    "nombre": "Gestor de área",
                    "descripcion": "Rol e2e",
                    "permisos": PERMISOS_GESTOR,
                    "alcance": "area",
                    "sistema": False,
                },
                {
                    "clave": "lector_area",
                    "nombre": "Lector de área",
                    "descripcion": "Rol e2e",
                    "permisos": ["incidencias:ver"],
                    "alcance": "area",
                    "sistema": False,
                },
            ]
        )
    return await api.usuario_temporal(rol="gestor_area", areas=["infraestructura"])


def _h(u: dict) -> dict:
    return {"Authorization": f"Bearer {u['token']}"}


def _nuevo(rol: str, **kw) -> dict:
    import uuid

    return {
        "nombre": "Usuario Nuevo",
        "correo": f"n_{uuid.uuid4().hex[:8]}@e2e.local",
        "password": "Password-Seguro-1",
        "rol": rol,
        **kw,
    }


async def test_gestor_no_crea_usuario_con_mas_alcance(api):
    g = await _gestor_area(api)
    # directivo: sus permisos caben en los del gestor, pero su alcance es global → escalamiento
    assert (await api.c.post("/usuarios", json=_nuevo("directivo"), headers=_h(g))).status_code == 403
    # mismo alcance y dentro de su área → permitido
    r = await api.c.post("/usuarios", json=_nuevo("lector_area", areas=["infraestructura"]), headers=_h(g))
    assert r.status_code == 201, r.text
    # área ajena → escalamiento
    r = await api.c.post("/usuarios", json=_nuevo("lector_area", areas=["computo_redes"]), headers=_h(g))
    assert r.status_code == 403


async def test_gestor_no_crea_rol_con_mas_alcance(api):
    g = await _gestor_area(api)
    base = {"nombre": "Rol delegado", "permisos": ["incidencias:ver"]}
    assert (
        await api.c.post("/roles", json={**base, "clave": "clon_global", "alcance": "global"}, headers=_h(g))
    ).status_code == 403
    assert (
        await api.c.post("/roles", json={**base, "clave": "clon_edificio", "alcance": "edificio"}, headers=_h(g))
    ).status_code == 403
    assert (
        await api.c.post("/roles", json={**base, "clave": "clon_propio", "alcance": "propio"}, headers=_h(g))
    ).status_code == 201


async def test_gestor_no_modifica_usuarios_con_mas_acceso(api):
    g = await _gestor_area(api)
    r = await api.c.patch(f"/usuarios/{api.oid('admin')}", json={"activo": False}, headers=_h(g))
    assert r.status_code == 403
    r = await api.c.patch(f"/usuarios/{api.oid('directivo')}", json={"nombre": "Cambiado"}, headers=_h(g))
    assert r.status_code == 403
    assert (await api.c.get("/auth/me", headers=api.h("admin"))).status_code == 200


async def test_autoedicion_de_alcance_bloqueada(api):
    g = await _gestor_area(api)
    for cambio in (
        {"areas": ["infraestructura", "computo_redes", "academico"]},
        {"edificios": ["Edificio A"]},
        {"rol": "admin"},
        {"activo": False},
    ):
        r = await api.c.patch(f"/usuarios/{g['_id']}", json=cambio, headers=_h(g))
        assert r.status_code == 400, (cambio, r.text)
    r = await api.c.patch(f"/usuarios/{api.oid('admin')}", json={"areas": ["academico"]}, headers=api.h("admin"))
    assert r.status_code == 400


async def test_solo_el_tecnico_asignado_da_seguimiento(api):
    inc = await api.crear()
    r = await api.c.patch(
        f"/incidencias/{inc['_id']}/asignacion",
        json={"tecnico_id": str(api.oid("tecnico_infra"))},
        headers=api.h("coordinador_infra"),
    )
    assert r.status_code == 200, r.text
    assert (await api.seguimiento(inc["_id"], "en_proceso", quien="tecnico_infra2")).status_code == 403
    assert (await api.doc(inc["_id"]))["estado"] == "abierta"
    assert (await api.seguimiento(inc["_id"], "en_proceso", quien="tecnico_infra")).status_code == 200
    assert (await api.seguimiento(inc["_id"], "en_espera", quien="coordinador_infra")).status_code == 200


async def test_bloqueo_por_cuenta_e_ip(api, password):
    u = await api.usuario_temporal()

    async def login(ip, pwd):
        t = ASGITransport(app=app, raise_app_exceptions=False, client=(ip, 5000))
        async with AsyncClient(transport=t, base_url="http://test") as c:
            return (await c.post("/auth/login", json={"correo": u["correo"], "password": pwd})).status_code

    # 10 fallos desde una IP bloquean esa cuenta solo desde esa IP...
    for _ in range(10):
        assert await login("10.77.0.1", "incorrecta") == 401
    assert await login("10.77.0.1", password) == 429
    # ...pero el dueño entra desde otra red (un atacante no puede bloquear cuentas ajenas)
    assert await login("10.77.0.2", password) == 200
    # fuerza bruta distribuida: 50 fallos en total desde muchas IP bloquean la cuenta
    for i in range(40):
        assert await login(f"10.78.{i // 200}.{i % 200}", "incorrecta") == 401
    assert await login("10.79.0.1", password) == 429


async def test_seguimiento_conserva_ultimas_entradas_y_no_se_congela(api):
    inc = await api.crear()
    from app.routers.incidencias import MAX_HISTORIAL

    # historial lleno artificialmente: la incidencia debe seguir pudiendo avanzar
    relleno = [{"fecha": None, "estado_nuevo": "en_espera", "comentario": "relleno", "horas": 0}] * (MAX_HISTORIAL + 5)
    from bson import ObjectId

    await api.db.incidencias_campus.update_one(
        {"_id": ObjectId(inc["_id"])}, {"$set": {"historial_seguimiento": relleno}}
    )
    assert (await api.seguimiento(inc["_id"], "en_proceso")).status_code == 200
    d = await api.doc(inc["_id"])
    assert len(d["historial_seguimiento"]) == MAX_HISTORIAL
    assert d["historial_seguimiento"][-1]["estado_nuevo"] == "en_proceso"


async def test_tope_de_horas_por_incidencia(api):
    from bson import ObjectId

    inc = await api.crear()
    await api.db.incidencias_campus.update_one({"_id": ObjectId(inc["_id"])}, {"$set": {"horas_invertidas": 999.5}})
    assert (await api.seguimiento(inc["_id"], "en_proceso", horas=1)).status_code == 409
    assert (await api.seguimiento(inc["_id"], "en_proceso", horas=0.5)).status_code == 200


async def test_un_usuario_no_acapara_las_firmas(api):
    inc = await api.crear()
    body = {"nombre_archivo": "x.jpg", "tipo_mime": "image/jpeg", "peso_bytes": 100}
    url = f"/incidencias/{inc['_id']}/evidencias/firma"
    for _ in range(5):
        assert (await api.c.post(url, json=body, headers=api.h("tecnico_infra"))).status_code == 200
    assert (await api.c.post(url, json=body, headers=api.h("tecnico_infra"))).status_code == 409
    # el reportante todavía tiene lugar
    assert (await api.c.post(url, json=body, headers=api.h("reportante_a"))).status_code == 200


async def test_limite_de_escritura_por_usuario(api, monkeypatch):
    monkeypatch.setattr(settings, "limite_escritura", "3/minute")
    from .helpers import cuerpo

    t = ASGITransport(app=app, raise_app_exceptions=False, client=("10.90.0.1", 5000))
    async with AsyncClient(transport=t, base_url="http://test") as c:
        a = await api.usuario_temporal()
        b = await api.usuario_temporal()
        codigos = [(await c.post("/incidencias", json=cuerpo(), headers=_h(a))).status_code for _ in range(4)]
        assert codigos == [201, 201, 201, 429]
        # otro usuario detrás de la misma IP (NAT del campus) no queda bloqueado
        assert (await c.post("/incidencias", json=cuerpo(), headers=_h(b))).status_code == 201


async def test_cupo_diario_de_ia(api, monkeypatch):
    async def fake(*_a, **_k):
        return ANALISIS

    monkeypatch.setattr(ia_router, "analizar_imagen", fake)
    monkeypatch.setattr(settings, "ia_limite_diario", 2)
    u = await api.usuario_temporal()

    # Imágenes distintas: con caché por imagen, repetir la misma no consumiría cupo.
    def archivos(numero: int):
        return {"imagen": ("f.png", io.BytesIO(_imagen_png(200 + numero, 200)), "image/png")}

    for numero in range(2):
        assert (await api.c.post("/ia/analizar-imagen", files=archivos(numero), headers=_h(u))).status_code == 200
    assert (await api.c.post("/ia/analizar-imagen", files=archivos(2), headers=_h(u))).status_code == 429


async def test_cuerpo_demasiado_grande_413(api):
    grande = b'{"titulo":"' + b"x" * 100_000 + b'"}'
    r = await api.c.post(
        "/incidencias", content=grande, headers={**api.h("reportante_a"), "Content-Type": "application/json"}
    )
    assert r.status_code == 413
    # sin token también se corta antes de parsear
    r = await api.c.post(
        "/ia/analizar-imagen", content=b"0" * (7 * 1024 * 1024), headers={"Content-Type": "application/octet-stream"}
    )
    assert r.status_code == 413


async def test_errores_de_validacion_no_reflejan_valores(api):
    secreto = "MiContraseñaSecreta-" + "z" * 200  # > 128: falla la validación
    t = ASGITransport(app=app, raise_app_exceptions=False, client=("10.88.0.1", 5000))
    async with AsyncClient(transport=t, base_url="http://test") as c:
        r = await c.post("/auth/login", json={"correo": "alguien@e2e.local", "password": secreto})
    assert r.status_code == 400
    assert secreto not in r.text and "input" not in r.json()["detalle"][0]


async def test_filtro_cliente_no_amplia_ni_ignora_alcance(api):
    await api.crear(edificio="Edificio B")
    r = await api.c.get("/incidencias", params={"edificio": "Edificio B"}, headers=api.h("jefe_a"))
    assert r.status_code == 200 and r.json() == []


async def test_gestor_delegado_solo_ve_y_edita_su_ambito(api):
    g = await _gestor_area(api)
    r = await api.c.get("/usuarios", headers=_h(g))
    assert r.status_code == 200
    visibles = {u["_id"] for u in r.json()}
    assert str(api.oid("admin")) not in visibles and str(api.oid("reportante_a")) not in visibles
    # reportantes de todo el campus y pares del mismo rol quedan fuera de su gestión
    assert (
        await api.c.patch(f"/usuarios/{api.oid('reportante_a')}", json={"activo": False}, headers=_h(g))
    ).status_code == 403
    par = await api.usuario_temporal(rol="gestor_area", areas=["infraestructura"])
    assert (
        await api.c.patch(f"/usuarios/{par['_id']}", json={"nombre": "Par cambiado"}, headers=_h(g))
    ).status_code == 403
