from app.schemas.rol import CATALOGO_PERMISOS
from scripts.init_db import roles_sistema


# Expectativa independiente tomada de la tabla 3.3 del catálogo de permisos.
PERMISOS_TABLA_3_3 = {
    "reportante": {"incidencias:crear", "incidencias:ver", "evidencias:subir", "ia:usar"},
    "tecnico": {
        "incidencias:crear",
        "incidencias:ver",
        "incidencias:buscar",
        "evidencias:subir",
        "seguimiento:registrar",
        "tags:gestionar",
        "ia:usar",
    },
    "coordinador": {
        "incidencias:crear",
        "incidencias:ver",
        "incidencias:asignar",
        "incidencias:buscar",
        "evidencias:subir",
        "seguimiento:registrar",
        "tags:gestionar",
        "analitica:ver",
        "ia:usar",
    },
    "directivo": {"incidencias:ver", "incidencias:buscar", "analitica:ver"},
    "admin": set(CATALOGO_PERMISOS),
}


def _por_clave() -> dict[str, dict]:
    return {rol["clave"]: rol for rol in roles_sistema()}


def test_permisos_igual_tabla_3_3():
    reales = {clave: set(rol["permisos"]) for clave, rol in _por_clave().items()}
    diferencias = {}
    for clave in PERMISOS_TABLA_3_3.keys() | reales.keys():
        esperados = PERMISOS_TABLA_3_3.get(clave, set())
        actuales = reales.get(clave, set())
        if esperados != actuales:
            diferencias[clave] = {
                "faltan": sorted(esperados - actuales),
                "sobran": sorted(actuales - esperados),
            }
    assert diferencias == {}


def test_alcance_por_rol():
    roles = _por_clave()
    assert roles["reportante"]["alcance"] == "propio"
    assert "incidencias:crear" in roles["reportante"]["permisos"]
    assert "analitica:ver" not in roles["reportante"]["permisos"]

    assert roles["tecnico"]["alcance"] == "area"
    assert {"seguimiento:registrar", "tags:gestionar", "incidencias:buscar"} <= set(roles["tecnico"]["permisos"])
    assert not {"incidencias:asignar", "usuarios:gestionar", "roles:gestionar"} & set(roles["tecnico"]["permisos"])

    assert roles["coordinador"]["alcance"] == "area"
    assert {"seguimiento:registrar", "incidencias:asignar", "analitica:ver"} <= set(roles["coordinador"]["permisos"])

    assert roles["directivo"]["alcance"] == "global"
    assert set(roles["directivo"]["permisos"]) == {
        "incidencias:ver",
        "incidencias:buscar",
        "analitica:ver",
    }

    assert roles["admin"]["alcance"] == "global"
    assert set(roles["admin"]["permisos"]) == set(CATALOGO_PERMISOS)


def test_roles_sistema_tienen_identidad_unica_y_marca_inmutable():
    primera = roles_sistema()
    segunda = roles_sistema()
    assert primera == segunda
    assert len({rol["clave"] for rol in primera}) == len(primera) == 5
    assert all(rol["sistema"] is True for rol in primera)
    assert all(len(rol["permisos"]) == len(set(rol["permisos"])) for rol in primera)


def test_roles_sistema_no_contienen_permisos_desconocidos():
    conocidos = set(CATALOGO_PERMISOS)
    assert all(set(rol["permisos"]) <= conocidos for rol in roles_sistema())
