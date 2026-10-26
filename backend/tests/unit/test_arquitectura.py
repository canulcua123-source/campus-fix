import ast
from pathlib import Path

DOMINIO = Path(__file__).parents[2] / "app" / "dominio"
SOLO_STDLIB = {"collections", "datetime", "math", "re", "typing", "unicodedata", "zoneinfo"}


def test_dominio_sin_dependencias_externas():
    for archivo in DOMINIO.glob("*.py"):
        permitidos = SOLO_STDLIB | ({"app", "pydantic"} if archivo.name == "detalle.py" else set())
        arbol = ast.parse(archivo.read_text(encoding="utf-8"), filename=str(archivo))
        for nodo in ast.walk(arbol):
            if isinstance(nodo, ast.Import):
                modulos = {alias.name.split(".")[0] for alias in nodo.names}
            elif isinstance(nodo, ast.ImportFrom) and nodo.module:
                modulos = {nodo.module.split(".")[0]}
            else:
                continue
            assert modulos <= permitidos, f"{archivo.name} importa {sorted(modulos - permitidos)}"


def test_router_depende_del_puerto_y_no_de_boto3():
    router = (DOMINIO.parent / "routers" / "incidencias.py").read_text(encoding="utf-8")
    assert "StoragePort" in router
    assert "Depends(get_storage)" in router
    assert "boto3" not in router
