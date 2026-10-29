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
    # Admin pierde lo exclusivo del superadmin: configuración, roles y cuentas privilegiadas.
    "admin": set(CATALOGO_PERMISOS) - {"configuracion:gestionar", "roles:gestionar", "sistema:administrar"},
    "superadmin": set(CATALOGO_PERMISOS),
}

ALCANCES_ESPERADOS = {
    "reportante": "propio",
    "tecnico": "area",
    "coordinador": "area",
    "directivo": "global",
    "admin": "global",
    "superadmin": "global",
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

    assert len(roles) == 6
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


def test_api_roles_expone_edicion_y_eliminacion_pero_no_put():
    metodos = set()
    for ruta in roles_router.routes:
        if ruta.path.startswith("/roles"):
            metodos |= set(ruta.methods or set())

    assert {"GET", "POST", "PATCH", "DELETE"} <= metodos
    assert "PUT" not in metodos


def test_superadmin_esta_por_encima_de_admin():
    roles = _por_clave()
    admin, superadmin = set(roles["admin"]["permisos"]), set(roles["superadmin"]["permisos"])

    assert admin < superadmin
    assert superadmin - admin == {"configuracion:gestionar", "roles:gestionar", "sistema:administrar"}


def test_permisos_exclusivos_compartidos_con_la_api():
    from app.core.security import PERMISO_SUPERADMIN
    from app.schemas.rol import PERMISOS_EXCLUSIVOS_SUPERADMIN

    assert PERMISO_SUPERADMIN in PERMISOS_EXCLUSIVOS_SUPERADMIN
    assert set(PERMISOS_EXCLUSIVOS_SUPERADMIN).isdisjoint(_por_clave()["admin"]["permisos"])
