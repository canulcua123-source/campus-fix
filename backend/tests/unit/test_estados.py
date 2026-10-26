import pytest

from app.dominio.estados import (
    TRANSICIONES,
    TransicionEstadoInvalida,
    origenes_permitidos,
    transicion_permitida,
    validar_transicion,
)


def test_transiciones_validas():
    for origen, destinos in TRANSICIONES.items():
        for destino in destinos:
            assert transicion_permitida(origen, destino)
            validar_transicion(origen, destino)
    assert origenes_permitidos("en_proceso") == ["abierta", "en_espera", "resuelta"]


def test_transicion_invalida_lanza():
    assert not transicion_permitida("abierta", "cerrada")
    assert not transicion_permitida("desconocida", "abierta")
    with pytest.raises(TransicionEstadoInvalida):
        validar_transicion("abierta", "cerrada")


def test_retirada_es_terminal_y_no_es_destino_del_flujo_general():
    assert TRANSICIONES["retirada"] == []
    assert origenes_permitidos("retirada") == []
    assert not transicion_permitida("abierta", "retirada")
