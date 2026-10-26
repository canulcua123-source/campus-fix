import os

os.environ.setdefault(
    "JWT_SECRET",
    "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
)

from app.routers.roles import router as roles_router  # noqa: E402
from app.schemas.rol import CATALOGO_PERMISOS, RolIn  # noqa: E402
from scripts.init_db import esquema_roles, roles_sistema  # noqa: E402

PERMISOS_ESPERADOS = {
    "reportante": {
        "incidencias:crear",
        "incidencias:ver",
        "evidencias:subir",
        "ia:usar",
    },
    "tecnico": {
        "incidencias:crear",
        "incidencias:ver",
        "evidencias:subir",
        "ia:usar",
        "seguimiento:registrar",
        "tags:gestionar",
        "incidencias:buscar",
    },
    "coordinador": {
        "incidencias:crear",
        "incidencias:ver",
        "evidencias:subir",
        "ia:usar",
        "seguimiento:registrar",
        "tags:gestionar",
        "incidencias:buscar",
        "incidencias:asignar",
        "analitica:ver",
    },
    "directivo": {
        "incidencias:ver",
        "incidencias:buscar",
        "analitica:ver",
    },
    "admin": set(CATALOGO_PERMISOS),
}

ALCANCES_ESPERADOS = {
    "reportante": "propio",
    "tecnico": "area",
    "coordinador": "area",
    "directivo": "global",
    "admin": "global",
}

PERMISOS_ESCRITURA = {
    "incidencias:crear",
    "incidencias:asignar",
    "evidencias:subir",
    "seguimiento:registrar",
    "tags:gestionar",
    "usuarios:gestionar",
    "roles:gestionar",
    "categorias:gestionar",
    "ia:usar",
}


def _por_clave() -> dict[str, dict]:
    return {rol["clave"]: rol for rol in roles_sistema()}


def test_permisos_igual_tabla_3_3():
    roles = roles_sistema()
    por_clave = _por_clave()

    assert len(roles) == 5
    assert set(por_clave) == set(PERMISOS_ESPERADOS)

    catalogo = set(CATALOGO_PERMISOS)
    for clave, esperados in PERMISOS_ESPERADOS.items():
        permisos = por_clave[clave]["permisos"]
        assert len(permisos) == len(set(permisos)), clave
        assert set(permisos) <= catalogo, clave
        assert set(permisos) == esperados, clave


def test_alcance_por_rol():
    assert {clave: rol["alcance"] for clave, rol in _por_clave().items()} == ALCANCES_ESPERADOS


def test_roles_base_son_sistema_y_cumplen_contrato_t008():
    esquema = esquema_roles()["$jsonSchema"]
    campos_permitidos = set(esquema["properties"])
    campos_requeridos = set(esquema["required"])

    assert esquema["additionalProperties"] is False
    for rol in roles_sistema():
        assert rol["sistema"] is True
        assert campos_requeridos <= set(rol)
        assert set(rol) <= campos_permitidos
        RolIn.model_validate({campo: rol[campo] for campo in campos_requeridos})


def test_directivo_es_solo_lectura_y_coordinador_puede_cerrar():
    roles = _por_clave()

    assert set(roles["directivo"]["permisos"]).isdisjoint(PERMISOS_ESCRITURA)
    assert {"incidencias:ver", "incidencias:buscar", "analitica:ver"} == set(roles["directivo"]["permisos"])
    assert {"seguimiento:registrar", "incidencias:asignar"} <= set(roles["coordinador"]["permisos"])


def test_api_roles_no_expone_edicion_eliminacion_ni_desactivacion():
    metodos_mutacion = {"PATCH", "PUT", "DELETE"}
    rutas_roles = [ruta for ruta in roles_router.routes if ruta.path.startswith("/roles")]

    assert rutas_roles
    assert all(not (set(ruta.methods or set()) & metodos_mutacion) for ruta in rutas_roles)
