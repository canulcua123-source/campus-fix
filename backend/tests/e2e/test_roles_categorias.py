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
    r = await api.c.post("/roles", json=_rol(), headers=api.h("admin"))
    assert r.status_code == 201, r.text
    assert r.json()["clave"] == "auditor_pruebas"
    assert await api.db.roles.find_one({"clave": "auditor_pruebas"})
    r = await api.c.post("/roles", json=_rol(nombre="Otro"), headers=api.h("admin"))
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
    r = await api.c.post("/roles", json=body, headers=api.h("admin"))
    assert r.status_code == 400, r.text


@pytest.mark.parametrize("quien", ["reportante_a", "tecnico_infra", "coordinador_infra", "directivo", "jefe_a"])
async def test_roles_no_admin_403(api, quien):
    assert (await api.c.post("/roles", json=_rol(clave="intruso"), headers=api.h(quien))).status_code == 403
    assert (await api.c.get("/roles", headers=api.h(quien))).status_code == 403


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
