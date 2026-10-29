"""Rol superadmin por encima de admin: permisos exclusivos, invariantes y Centro de control (/sistema/*)."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId

from app.core.db import get_redis
from app.schemas.rol import CATALOGO_PERMISOS

from .helpers import PASSWORD

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


def _nuevo(rol: str, **extra) -> dict:
    return {
        "nombre": "Cuenta superadmin e2e",
        "correo": f"sa_{uuid.uuid4().hex[:10]}@e2e.local",
        "password": PASSWORD,
        "rol": rol,
        **extra,
    }


async def _rol_clon_superadmin(api) -> str:
    """Rol personalizado con todos los permisos: puede gestionar al superadmin sin serlo (para el invariante)."""
    clave = "clon_superadmin"
    await api.db.roles.update_one(
        {"clave": clave},
        {
            "$setOnInsert": {
                "clave": clave,
                "nombre": "Clon de superadmin",
                "descripcion": "e2e",
                "permisos": list(CATALOGO_PERMISOS),
                "alcance": "global",
                "sistema": False,
            }
        },
        upsert=True,
    )
    return clave


# ---------- permisos exclusivos ----------


async def test_admin_pierde_configuracion_y_gestion_de_roles(api):
    assert (await api.c.get("/config/ia", headers=api.h("admin"))).status_code == 403
    assert (await api.c.patch("/config/ia", json={"habilitada": True}, headers=api.h("admin"))).status_code == 403
    r = await api.c.post(
        "/roles",
        json={"clave": "rol_de_admin", "nombre": "Rol admin", "permisos": ["incidencias:ver"], "alcance": "propio"},
        headers=api.h("admin"),
    )
    assert r.status_code == 403
    # Pero conserva la lectura de roles para asignarlos a usuarios no privilegiados.
    assert (await api.c.get("/roles", headers=api.h("admin"))).status_code == 200


async def test_superadmin_tiene_configuracion_y_roles(api):
    assert (await api.c.get("/config/ia", headers=api.h("superadmin"))).status_code == 200
    roles = (await api.c.get("/roles", headers=api.h("superadmin"))).json()
    assert {"admin", "superadmin"} <= {r["clave"] for r in roles}
    me = (await api.c.get("/auth/me", headers=api.h("superadmin"))).json()
    assert set(me["permisos"]) == set(CATALOGO_PERMISOS)


async def test_admin_no_asigna_roles_privilegiados(api):
    for rol in ("admin", "superadmin"):
        r = await api.c.post("/usuarios", json=_nuevo(rol), headers=api.h("admin"))
        assert r.status_code == 403, (rol, r.text)
    # Tampoco puede promover a un usuario existente.
    tmp = await api.usuario_temporal()
    r = await api.c.patch(f"/usuarios/{tmp['_id']}", json={"rol": "admin"}, headers=api.h("admin"))
    assert r.status_code == 403, r.text
    assert (await api.db.usuarios.find_one({"_id": tmp["_id"]}))["rol"] == "reportante"
    # Sigue gestionando usuarios no privilegiados.
    r = await api.c.post("/usuarios", json=_nuevo("reportante"), headers=api.h("admin"))
    assert r.status_code == 201, r.text
    r = await api.c.patch(f"/usuarios/{tmp['_id']}", json={"activo": False}, headers=api.h("admin"))
    assert r.status_code == 200, r.text


async def test_superadmin_crea_y_edita_admins(api):
    r = await api.c.post("/usuarios", json=_nuevo("admin"), headers=api.h("superadmin"))
    assert r.status_code == 201, r.text
    nuevo_id = r.json()["_id"]
    r = await api.c.patch(f"/usuarios/{nuevo_id}", json={"activo": False}, headers=api.h("superadmin"))
    assert r.status_code == 200 and r.json()["activo"] is False
    r = await api.c.post("/usuarios", json=_nuevo("superadmin"), headers=api.h("superadmin"))
    assert r.status_code == 201, r.text


async def test_admin_no_ve_ni_edita_cuentas_privilegiadas(api):
    otro_admin = await api.usuario_temporal(rol="admin")
    visibles = {u["_id"] for u in (await api.c.get("/usuarios", headers=api.h("admin"))).json()}
    assert str(api.oid("superadmin")) not in visibles
    assert str(otro_admin["_id"]) not in visibles
    assert str(api.oid("admin")) in visibles  # su propio perfil sí
    for objetivo in (api.oid("superadmin"), otro_admin["_id"]):
        r = await api.c.patch(f"/usuarios/{objetivo}", json={"activo": False}, headers=api.h("admin"))
        assert r.status_code == 404, r.text
    assert (await api.db.usuarios.find_one({"_id": api.oid("superadmin")}))["activo"] is True
    # El superadmin sí ve a todos.
    visibles_sa = {u["_id"] for u in (await api.c.get("/usuarios", headers=api.h("superadmin"))).json()}
    assert {str(api.oid("admin")), str(otro_admin["_id"]), str(api.oid("superadmin"))} <= visibles_sa


async def test_metricas_ia_y_auditoria_exclusivas_del_superadmin(api):
    for ruta in ("/analitica/ia", "/auditoria"):
        assert (await api.c.get(ruta, headers=api.h("superadmin"))).status_code == 200, ruta
        assert (await api.c.get(ruta, headers=api.h("admin"))).status_code == 403, ruta


# ---------- el superadmin limita al rol admin ----------


async def _restaurar_rol_admin(api, antes: dict) -> None:
    await api.db.roles.update_one({"_id": antes["_id"]}, {"$set": {"permisos": antes["permisos"]}})


async def test_superadmin_limita_permisos_del_rol_admin(api):
    antes = await api.db.roles.find_one({"clave": "admin"})
    limitados = [p for p in antes["permisos"] if p != "categorias:gestionar"]
    try:
        r = await api.c.patch(f"/roles/{antes['_id']}", json={"permisos": limitados}, headers=api.h("superadmin"))
        assert r.status_code == 200, r.text
        assert set(r.json()["permisos"]) == set(limitados)
        despues = await api.db.roles.find_one({"_id": antes["_id"]})
        assert set(despues["permisos"]) == set(limitados)
        assert {k: despues[k] for k in ("clave", "nombre", "alcance", "sistema")} == {
            k: antes[k] for k in ("clave", "nombre", "alcance", "sistema")
        }
        # Efecto inmediato: el admin pierde la gestión de categorías.
        r = await api.c.post(
            "/categorias",
            json={"clave": "cat_limitada", "nombre": "Limitada", "prefijo": "LIM", "area_responsable": "TI"},
            headers=api.h("admin"),
        )
        assert r.status_code == 403, r.text
        evento = await api.db.auditoria.find_one(
            {"recurso": "roles", "recurso_id": "admin", "accion": "editar", "actor_id": api.oid("superadmin")}
        )
        assert evento is not None
    finally:
        await _restaurar_rol_admin(api, antes)


@pytest.mark.parametrize("exclusivo", ["roles:gestionar", "configuracion:gestionar", "sistema:administrar"])
async def test_superadmin_no_otorga_permisos_exclusivos_al_admin(api, exclusivo):
    antes = await api.db.roles.find_one({"clave": "admin"})
    try:
        r = await api.c.patch(
            f"/roles/{antes['_id']}", json={"permisos": [*antes["permisos"], exclusivo]}, headers=api.h("superadmin")
        )
        assert r.status_code == 403, r.text
        assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes
    finally:
        await _restaurar_rol_admin(api, antes)


@pytest.mark.parametrize(
    "cuerpo",
    [
        {"clave": "admin_nuevo"},
        {"alcance": "area"},
        {"nombre": "Administrador TI"},
        {"descripcion": "otra"},
        {"permisos": ["incidencias:ver"], "alcance": "propio"},
    ],
)
async def test_superadmin_solo_edita_permisos_del_admin(api, cuerpo):
    antes = await api.db.roles.find_one({"clave": "admin"})
    r = await api.c.patch(f"/roles/{antes['_id']}", json=cuerpo, headers=api.h("superadmin"))
    assert r.status_code == 409, r.text
    assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes


async def test_admin_no_edita_su_propio_rol(api):
    antes = await api.db.roles.find_one({"clave": "admin"})
    r = await api.c.patch(f"/roles/{antes['_id']}", json={"permisos": list(CATALOGO_PERMISOS)}, headers=api.h("admin"))
    assert r.status_code == 403, r.text
    assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes


async def test_rol_admin_no_se_elimina(api):
    antes = await api.db.roles.find_one({"clave": "admin"})
    r = await api.c.delete(f"/roles/{antes['_id']}", headers=api.h("superadmin"))
    assert r.status_code == 409, r.text
    assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes


@pytest.mark.parametrize("clave", ["superadmin", "coordinador", "reportante"])
async def test_otros_roles_de_sistema_siguen_inmutables(api, clave):
    antes = await api.db.roles.find_one({"clave": clave})
    r = await api.c.patch(f"/roles/{antes['_id']}", json={"permisos": ["incidencias:ver"]}, headers=api.h("superadmin"))
    assert r.status_code == 409, r.text
    assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes


async def test_rol_con_gestion_de_roles_sin_superadmin_no_limita_admin(api):
    clave = "gestor_sin_sistema"
    await api.db.roles.update_one(
        {"clave": clave},
        {
            "$setOnInsert": {
                "clave": clave,
                "nombre": "Gestor sin sistema",
                "descripcion": "e2e",
                "permisos": [p for p in CATALOGO_PERMISOS if p != "sistema:administrar"],
                "alcance": "global",
                "sistema": False,
            }
        },
        upsert=True,
    )
    gestor = await api.usuario_temporal(rol=clave)
    antes = await api.db.roles.find_one({"clave": "admin"})
    r = await api.c.patch(
        f"/roles/{antes['_id']}",
        json={"permisos": ["incidencias:ver"]},
        headers={"Authorization": f"Bearer {gestor['token']}"},
    )
    assert r.status_code == 409, r.text
    assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes


# ---------- invariantes ----------


async def test_superadmin_no_se_quita_su_rol_ni_se_desactiva(api):
    for cambio in ({"rol": "admin"}, {"activo": False}):
        r = await api.c.patch(f"/usuarios/{api.oid('superadmin')}", json=cambio, headers=api.h("superadmin"))
        assert r.status_code == 400, r.text
    doc = await api.db.usuarios.find_one({"_id": api.oid("superadmin")})
    assert doc["rol"] == "superadmin" and doc["activo"] is True


async def test_no_se_desactiva_ni_degrada_al_ultimo_superadmin(api):
    clave = await _rol_clon_superadmin(api)
    clon = await api.usuario_temporal(rol=clave)
    h = {"Authorization": f"Bearer {clon['token']}"}
    # Deja al superadmin del fixture como único activo (desactiva otros creados por pruebas previas).
    otros = [
        u["_id"]
        async for u in api.db.usuarios.find(
            {"rol": "superadmin", "activo": True, "_id": {"$ne": api.oid("superadmin")}}
        )
    ]
    await api.db.usuarios.update_many({"_id": {"$in": otros}}, {"$set": {"activo": False}})
    try:
        for cambio in ({"activo": False}, {"rol": "admin"}):
            r = await api.c.patch(f"/usuarios/{api.oid('superadmin')}", json=cambio, headers=h)
            assert r.status_code == 409, (cambio, r.text)
        doc = await api.db.usuarios.find_one({"_id": api.oid("superadmin")})
        assert doc["rol"] == "superadmin" and doc["activo"] is True
        # Con otro superadmin activo sí se puede desactivar a uno de ellos.
        segundo = await api.usuario_temporal(rol="superadmin")
        r = await api.c.patch(f"/usuarios/{segundo['_id']}", json={"activo": False}, headers=h)
        assert r.status_code == 200, r.text
    finally:
        await api.db.usuarios.update_many({"_id": {"$in": otros}}, {"$set": {"activo": True}})


# ---------- Centro de control ----------


async def test_salud_sistema(api):
    r = await api.c.get("/sistema/salud", headers=api.h("superadmin"))
    assert r.status_code == 200, r.text
    datos = r.json()
    assert datos["estado"] in {"ok", "degradado"}
    assert datos["mongo"]["estado"] in {"ok", "advertencia"} and datos["mongo"]["latencia_ms"] >= 0
    assert datos["redis"]["estado"] in {"ok", "advertencia"}
    assert datos["almacenamiento"]["estado"] == "ok"
    assert datos["ia"]["proveedor"] in {"claude", "gemini"} and datos["ia"]["limite_diario"] >= 1
    assert datos["version"] and datos["uptime_segundos"] >= 0
    # Nunca expone secretos.
    assert "test" not in {v for v in datos["almacenamiento"].values() if isinstance(v, str)}


@pytest.mark.parametrize("ruta", ["/sistema/salud", "/sistema/resumen"])
@pytest.mark.parametrize("quien", ["admin", "directivo", "coordinador_infra", "reportante_a"])
async def test_sistema_403_sin_permiso_superadmin(api, ruta, quien):
    assert (await api.c.get(ruta, headers=api.h(quien))).status_code == 403


@pytest.mark.parametrize("ruta", ["/sistema/salud", "/sistema/resumen"])
async def test_sistema_401_sin_token(api, ruta):
    assert (await api.c.get(ruta)).status_code == 401


async def test_resumen_kpis_y_alerta_critica_sin_asignar(api):
    inc = await api.crear(prioridad="critica")
    await api.db.incidencias_campus.update_one(
        {"_id": ObjectId(inc["_id"])}, {"$set": {"fecha_creacion": datetime.now(timezone.utc) - timedelta(hours=30)}}
    )
    r = await api.c.get("/sistema/resumen", headers=api.h("superadmin"))
    assert r.status_code == 200, r.text
    datos = r.json()
    kpis = datos["kpis"]
    assert kpis["abiertas"] >= 1 and kpis["criticas_sin_asignar"] >= 1 and kpis["vencidas"] >= 1
    tipos = {a["tipo"]: a for a in datos["alertas"]}
    assert tipos["criticas_sin_asignar"]["total"] >= 1 and tipos["criticas_sin_asignar"]["enlace"] == "/tablero"
    assert tipos["vencidas"]["severidad"] == "advertencia"
    assert all(isinstance(t["clave"], str) and t["total"] >= 1 for t in datos["top_categorias"])
    assert len(datos["top_edificios"]) <= 5
    for carga in datos["carga_tecnicos"]:
        assert carga["nombre"] and carga["incidencias_activas"] >= 1


async def test_resumen_alerta_cupo_ia(api):
    limite = (await api.c.get("/config/ia", headers=api.h("superadmin"))).json()["limite_diario_global"]
    clave = f"ia:uso:global:{datetime.now(timezone.utc):%Y-%m-%d}"
    redis = get_redis()
    previo = await redis.get(clave)
    await redis.set(clave, int(limite * 0.9) + 1, ex=3600)
    try:
        datos = (await api.c.get("/sistema/resumen", headers=api.h("superadmin"))).json()
        alerta = next(a for a in datos["alertas"] if a["tipo"] == "cupo_ia")
        assert alerta["severidad"] == "advertencia" and alerta["enlace"] == "/admin/configuracion"
        salud = (await api.c.get("/sistema/salud", headers=api.h("superadmin"))).json()
        assert salud["ia"]["porcentaje_cupo"] >= 80
    finally:
        if previo is None:
            await redis.delete(clave)
        else:
            await redis.set(clave, previo, ex=3600)
