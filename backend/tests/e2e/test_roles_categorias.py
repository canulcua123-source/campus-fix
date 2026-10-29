import pytest

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session")]


def _rol(**over):
    b = {
        "clave": "auditor_pruebas",
        "nombre": "Auditor",
        "descripcion": "rol e2e",
        "permisos": ["incidencias:ver", "analitica:ver"],
        "alcance": "global",
    }
    b.update(over)
    return b


async def test_crear_rol_y_duplicado(api):
    r = await api.c.post("/roles", json=_rol(), headers=api.h("superadmin"))
    assert r.status_code == 201, r.text
    assert r.json()["clave"] == "auditor_pruebas"
    assert await api.db.roles.find_one({"clave": "auditor_pruebas"})
    r = await api.c.post("/roles", json=_rol(nombre="Otro"), headers=api.h("superadmin"))
    assert r.status_code == 409


@pytest.mark.parametrize(
    "over",
    [
        {"clave": "Mal-Clave"},
        {"clave": "ab"},
        {"clave": {"$ne": ""}},
        {"permisos": ["incidencias:volar"]},
        {"permisos": ["incidencias:ver", "incidencias:ver"]},
        {"permisos": []},
        {"alcance": "universo"},
        {"nombre": "ab"},
        {"campo_desconocido": True},
    ],
    ids=[
        "clave_patron",
        "clave_corta",
        "clave_nosql",
        "permiso_desconocido",
        "permiso_dup",
        "sin_permisos",
        "alcance",
        "nombre",
        "campo_extra",
    ],
)
async def test_crear_rol_invalido(api, over):
    body = {**_rol(clave="rol_invalido"), **over}
    r = await api.c.post("/roles", json=body, headers=api.h("superadmin"))
    assert r.status_code == 400, r.text


@pytest.mark.parametrize("quien", ["reportante_a", "tecnico_infra", "coordinador_infra", "directivo", "jefe_a"])
async def test_roles_no_admin_403(api, quien):
    rol_base = await api.db.roles.find_one({"clave": "reportante"})
    assert (await api.c.post("/roles", json=_rol(clave="intruso"), headers=api.h(quien))).status_code == 403
    assert (await api.c.get("/roles", headers=api.h(quien))).status_code == 403
    assert (
        await api.c.patch(f"/roles/{rol_base['_id']}", json={"nombre": "Intruso"}, headers=api.h(quien))
    ).status_code == 403
    assert (await api.c.delete(f"/roles/{rol_base['_id']}", headers=api.h(quien))).status_code == 403


async def test_listar_roles_admin(api):
    r = await api.c.get("/roles", headers=api.h("admin"))
    assert r.status_code == 200
    claves = {x["clave"] for x in r.json()}
    assert {"reportante", "tecnico", "coordinador", "directivo", "admin", "jefe_edificio"} <= claves


async def test_escalada_privilegios(api):
    r = await api.c.post(
        "/roles", json=_rol(clave="escalada", permisos=["incidencias:ver", "analitica:ver"]), headers=api.h("gestor")
    )
    assert r.status_code == 403, r.text
    r = await api.c.post(
        "/roles",
        json=_rol(clave="escalada", permisos=["roles:gestionar", "usuarios:gestionar"]),
        headers=api.h("gestor"),
    )
    assert r.status_code == 403
    assert await api.db.roles.find_one({"clave": "escalada"}) is None
    # dentro de sus permisos sí puede
    r = await api.c.post("/roles", json=_rol(clave="solo_ver", permisos=["incidencias:ver"]), headers=api.h("gestor"))
    assert r.status_code == 201, r.text


async def test_superadmin_no_puede_editar_rol_base(api):
    antes = await api.db.roles.find_one({"clave": "directivo"})
    r = await api.c.patch(
        f"/roles/{antes['_id']}",
        json={"clave": "directivo_modificado", "permisos": ["incidencias:crear"]},
        headers=api.h("superadmin"),
    )
    assert r.status_code == 409, r.text
    despues = await api.db.roles.find_one({"_id": antes["_id"]})
    assert despues == antes


async def test_superadmin_no_puede_eliminar_rol_base(api):
    antes = await api.db.roles.find_one({"clave": "reportante"})
    r = await api.c.delete(f"/roles/{antes['_id']}", headers=api.h("superadmin"))
    assert r.status_code == 409, r.text
    assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes


async def test_rol_personalizado_se_puede_editar_y_eliminar(api):
    creado = await api.c.post(
        "/roles", json=_rol(clave="temporal_editable", permisos=["incidencias:ver"]), headers=api.h("superadmin")
    )
    assert creado.status_code == 201, creado.text
    rol_id = creado.json()["_id"]

    editado = await api.c.patch(
        f"/roles/{rol_id}",
        json={"clave": "temporal_editado", "nombre": "Temporal editado", "permisos": ["incidencias:buscar"]},
        headers=api.h("superadmin"),
    )
    assert editado.status_code == 200, editado.text
    assert editado.json()["clave"] == "temporal_editado"
    assert editado.json()["permisos"] == ["incidencias:buscar"]

    eliminado = await api.c.delete(f"/roles/{rol_id}", headers=api.h("superadmin"))
    assert eliminado.status_code == 200, eliminado.text
    assert eliminado.json() == {"ok": True}
    assert await api.db.roles.find_one({"clave": "temporal_editado"}) is None


async def test_rol_personalizado_asignado_no_pierde_su_referencia(api):
    antes = await api.db.roles.find_one({"clave": "gestor_roles"})
    r = await api.c.patch(f"/roles/{antes['_id']}", json={"clave": "gestor_renombrado"}, headers=api.h("superadmin"))
    assert r.status_code == 409, r.text
    assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes

    r = await api.c.delete(f"/roles/{antes['_id']}", headers=api.h("superadmin"))
    assert r.status_code == 409, r.text
    assert await api.db.roles.find_one({"_id": antes["_id"]}) == antes


async def test_categorias(api):
    assert (await api.c.get("/categorias")).status_code == 401
    for quien in ("reportante_a", "tecnico_infra", "directivo", "jefe_a", "admin"):
        r = await api.c.get("/categorias", headers=api.h(quien))
        assert r.status_code == 200, quien
        # Otras pruebas crean categorías dinámicas en la misma BD: aquí solo se exigen las del sistema.
        assert {"computo_redes", "infraestructura", "academico"} <= {c["clave"] for c in r.json()}


def _categoria(**over):
    body = {
        "clave": "laboratorios_especiales",
        "nombre": "Laboratorios especiales",
        "prefijo": "LAB",
        "area_responsable": "Servicios Generales",
        "campos": [
            {
                "nombre": "tipo_equipo",
                "etiqueta": "Tipo de equipo",
                "tipo": "lista",
                "requerido": True,
                "opciones": ["microscopio", "proyector"],
            }
        ],
    }
    body.update(over)
    return body


async def test_crear_categoria_201(api):
    respuesta = await api.c.post("/categorias", json=_categoria(), headers=api.h("admin"))

    assert respuesta.status_code == 201, respuesta.text
    categoria = respuesta.json()
    assert categoria["clave"] == "laboratorios_especiales"
    assert categoria["version"] == 1
    assert categoria["activa"] is True
    assert categoria["sistema"] is False
    guardada = await api.db.categorias.find_one({"clave": "laboratorios_especiales"})
    assert guardada is not None and guardada["campos"][0]["nombre"] == "tipo_equipo"


async def test_categoria_duplicada_409(api):
    primera = _categoria(clave="Servicios Médicos", nombre="Servicios médicos", prefijo="SMD")
    segunda = _categoria(clave=" servicios-medicos ", nombre="Otra categoría", prefijo="OTR")

    assert (await api.c.post("/categorias", json=primera, headers=api.h("admin"))).status_code == 201
    respuesta = await api.c.post("/categorias", json=segunda, headers=api.h("admin"))

    assert respuesta.status_code == 409, respuesta.text
    assert await api.db.categorias.count_documents({"clave": "servicios_medicos"}) == 1


async def test_categoria_campo_con_dolar_400(api):
    body = _categoria(
        clave="campo_inseguro",
        prefijo="INS",
        campos=[{"nombre": "$ne", "etiqueta": "Campo inseguro", "tipo": "texto", "requerido": True}],
    )

    respuesta = await api.c.post("/categorias", json=body, headers=api.h("admin"))

    assert respuesta.status_code == 400, respuesta.text
    assert await api.db.categorias.find_one({"clave": "campo_inseguro"}) is None


async def test_categoria_sin_permiso_403(api):
    body = _categoria(clave="categoria_protegida_rbac", prefijo="RBK")
    crear = await api.c.post("/categorias", json=body, headers=api.h("reportante_a"))
    assert crear.status_code == 403
    assert await api.db.categorias.find_one({"clave": "categoria_protegida_rbac"}) is None

    assert (await api.c.post("/categorias", json=body, headers=api.h("admin"))).status_code == 201
    for cambio in ({"nombre": "Cambio no autorizado"}, {"activa": False}):
        respuesta = await api.c.patch(
            "/categorias/categoria_protegida_rbac", json=cambio, headers=api.h("reportante_a")
        )
        assert respuesta.status_code == 403
    guardada = await api.db.categorias.find_one({"clave": "categoria_protegida_rbac"})
    assert guardada["nombre"] == "Laboratorios especiales" and guardada["activa"] is True


async def test_no_desactiva_categoria_sistema(api):
    for clave in ("computo_redes", "infraestructura", "academico"):
        respuesta = await api.c.patch(f"/categorias/{clave}", json={"activa": False}, headers=api.h("admin"))
        assert respuesta.status_code == 409, (clave, respuesta.text)
        guardada = await api.db.categorias.find_one({"clave": clave})
        assert guardada["activa"] is True


async def test_editar_versionar_y_desactivar_categoria_personalizada(api):
    body = _categoria(clave="servicios_dinamicos", prefijo="DIN")
    assert (await api.c.post("/categorias", json=body, headers=api.h("admin"))).status_code == 201

    campos = [{"nombre": "cantidad", "etiqueta": "Cantidad", "tipo": "entero", "requerido": True, "min": 1}]
    editada = await api.c.patch("/categorias/servicios_dinamicos", json={"campos": campos}, headers=api.h("admin"))
    assert editada.status_code == 200, editada.text
    assert editada.json()["version"] == 2

    descripcion = await api.c.patch(
        "/categorias/servicios_dinamicos", json={"nombre": "Servicios dinámicos"}, headers=api.h("admin")
    )
    assert descripcion.status_code == 200 and descripcion.json()["version"] == 2

    desactivada = await api.c.patch("/categorias/servicios_dinamicos", json={"activa": False}, headers=api.h("admin"))
    assert desactivada.status_code == 200 and desactivada.json()["activa"] is False
    guardada = await api.db.categorias.find_one({"clave": "servicios_dinamicos"})
    assert guardada is not None and guardada["version"] == 2


async def test_categoria_patch_inexistente_404_y_escritura_sin_token_401(api):
    assert (await api.c.post("/categorias", json=_categoria(clave="sin_token", prefijo="STK"))).status_code == 401
    respuesta = await api.c.patch(
        "/categorias/categoria_inexistente", json={"nombre": "Categoría inexistente"}, headers=api.h("admin")
    )
    assert respuesta.status_code == 404


async def _rol_personalizado(api, clave: str, **over) -> dict:
    doc = {
        "clave": clave,
        "nombre": "Rol de prueba",
        "descripcion": "rol e2e",
        "permisos": ["incidencias:ver", "analitica:ver"],
        "alcance": "global",
        "sistema": False,
        **over,
    }
    await api.db.roles.delete_one({"clave": clave, "sistema": False})
    res = await api.db.roles.insert_one(doc)
    return {**doc, "_id": res.inserted_id}


async def test_gestor_no_degrada_ni_elimina_rol_con_mas_acceso(api):
    # El gestor (roles:gestionar + incidencias:ver) no tiene analitica:ver: el rol objetivo le supera.
    rol = await _rol_personalizado(api, "mas_poderoso")
    antes = await api.db.roles.find_one({"_id": rol["_id"]})
    r = await api.c.patch(f"/roles/{rol['_id']}", json={"permisos": ["incidencias:ver"]}, headers=api.h("gestor"))
    assert r.status_code == 403, r.text
    r = await api.c.delete(f"/roles/{rol['_id']}", headers=api.h("gestor"))
    assert r.status_code == 403, r.text
    assert await api.db.roles.find_one({"_id": rol["_id"]}) == antes
    # El superadministrador sí puede.
    assert (await api.c.delete(f"/roles/{rol['_id']}", headers=api.h("superadmin"))).status_code == 200


async def test_gestor_edita_y_elimina_rol_dentro_de_su_acceso(api):
    rol = await _rol_personalizado(api, "dentro_del_acceso", permisos=["incidencias:ver"])
    r = await api.c.patch(f"/roles/{rol['_id']}", json={"nombre": "Renombrado"}, headers=api.h("gestor"))
    assert r.status_code == 200, r.text
    assert (await api.c.delete(f"/roles/{rol['_id']}", headers=api.h("gestor"))).status_code == 200


async def test_gestor_no_edita_rol_para_exceder_su_acceso(api):
    rol = await _rol_personalizado(api, "sube_de_nivel", permisos=["incidencias:ver"])
    r = await api.c.patch(f"/roles/{rol['_id']}", json={"permisos": ["analitica:ver"]}, headers=api.h("gestor"))
    assert r.status_code == 403, r.text
    assert (await api.db.roles.find_one({"_id": rol["_id"]}))["permisos"] == ["incidencias:ver"]


async def test_roles_patch_delete_400_404(api):
    inexistente = "0123456789abcdef01234567"
    assert (await api.c.patch("/roles/no-es-id", json={"nombre": "Otro"}, headers=api.h("superadmin"))).status_code == 400
    assert (await api.c.delete("/roles/no-es-id", headers=api.h("superadmin"))).status_code == 400
    assert (
        await api.c.patch(f"/roles/{inexistente}", json={"nombre": "Otro"}, headers=api.h("superadmin"))
    ).status_code == 404
    assert (await api.c.delete(f"/roles/{inexistente}", headers=api.h("superadmin"))).status_code == 404
    assert (await api.c.patch(f"/roles/{inexistente}", json={"nombre": "Otro"})).status_code == 401


async def test_roles_patch_rechaza_campos_extra_y_cuerpo_vacio(api):
    rol = await _rol_personalizado(api, "campos_extra", permisos=["incidencias:ver"])
    for cuerpo in ({"sistema": True}, {"permisos": ["incidencias:ver"], "extra": 1}, {}):
        r = await api.c.patch(f"/roles/{rol['_id']}", json=cuerpo, headers=api.h("superadmin"))
        assert r.status_code == 400, (cuerpo, r.text)
    assert (await api.db.roles.find_one({"_id": rol["_id"]}))["sistema"] is False


async def test_fallo_sin_coincidencia_distingue_404_de_409(api):
    from app.routers.roles import _fallo_sin_coincidencia

    base = await api.db.roles.find_one({"clave": "reportante"})
    assert (await _fallo_sin_coincidencia(base["_id"])).status_code == 409
    from bson import ObjectId

    assert (await _fallo_sin_coincidencia(ObjectId())).status_code == 404


async def test_sembrar_base_repara_rol_base_conservando_id(api):
    from scripts.init_db import roles_sistema, sembrar_base

    esperado = next(r for r in roles_sistema() if r["clave"] == "directivo")
    antes = await api.db.roles.find_one({"clave": "directivo"})
    try:
        await api.db.roles.update_one(
            {"_id": antes["_id"]}, {"$set": {"permisos": ["incidencias:crear"], "alcance": "propio", "sistema": False}}
        )
        await sembrar_base(api.db)
        despues = await api.db.roles.find_one({"clave": "directivo"})
        assert despues["_id"] == antes["_id"]
        assert despues["permisos"] == esperado["permisos"]
        assert despues["alcance"] == esperado["alcance"] and despues["sistema"] is True
        assert await api.db.roles.count_documents({"clave": "directivo"}) == 1
        # Idempotente y sin tocar roles personalizados.
        await sembrar_base(api.db)
        assert await api.db.roles.find_one({"clave": "directivo"}) == despues
        assert await api.db.roles.find_one({"clave": "gestor_roles"}) is not None
    finally:
        await api.db.roles.update_one(
            {"_id": antes["_id"]}, {"$set": {k: antes[k] for k in ("permisos", "alcance", "sistema")}}
        )


async def test_sembrar_base_conserva_permisos_limitados_del_admin(api):
    from scripts.init_db import sembrar_base

    antes = await api.db.roles.find_one({"clave": "admin"})
    limitados = ["incidencias:ver", "usuarios:gestionar"]
    try:
        # Re-sembrar no pisa lo que el superadmin limitó, pero sí retira los permisos exclusivos.
        await api.db.roles.update_one(
            {"_id": antes["_id"]}, {"$set": {"permisos": [*limitados, "roles:gestionar", "sistema:administrar"]}}
        )
        await sembrar_base(api.db)
        despues = await api.db.roles.find_one({"clave": "admin"})
        assert despues["_id"] == antes["_id"]
        assert despues["permisos"] == limitados
        assert despues["alcance"] == "global" and despues["sistema"] is True
    finally:
        await api.db.roles.update_one({"_id": antes["_id"]}, {"$set": {"permisos": antes["permisos"]}})
