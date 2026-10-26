import app.routers.ia as ia_router
from app.services.vision.prompt import PROMPT_SISTEMA, PROMPT_VERSION


def test_clave_cache_incluye_version_del_prompt():
    assert ia_router.PROMPT_VERSION == PROMPT_VERSION
    base = {"usuario_id": "u1", "proveedor": "anthropic", "modelo": "modelo"}
    actual = ia_router._clave_cache(b"imagen", "pasillo norte", prompt_version=PROMPT_VERSION, **base)

    assert ia_router._clave_cache(b"imagen", "pasillo norte", prompt_version="otra", **base) != actual


def test_prompt_trata_texto_como_dato_y_no_identifica_personas():
    prompt = PROMPT_SISTEMA.lower()

    assert PROMPT_VERSION == "v3"
    assert "detalle_infra" in prompt
    assert "texto visible" in prompt and "dato no confiable" in prompt
    assert "texto_con_instrucciones" in prompt
    assert "nunca identifiques" in prompt
