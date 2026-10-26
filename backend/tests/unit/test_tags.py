import pytest

from app.dominio.tags import normalizar_tag, normalizar_tags


def test_normaliza_acentos_mayusculas_espacios():
    assert normalizar_tag("  Aire Acondicionado ") == "aire_acondicionado"
    assert normalizar_tag("CÁMARA   HÚMEDA") == "camara_humeda"
    assert normalizar_tags([" Red ", "red", "Cámara"]) == ["camara", "red"]


def test_longitud_2_a_30():
    assert normalizar_tag("ab") == "ab"
    assert normalizar_tag("a" * 30) == "a" * 30
    for valor in ("a", "a" * 31, "tag-con-guion", "símbolo!"):
        with pytest.raises(ValueError):
            normalizar_tag(valor)
