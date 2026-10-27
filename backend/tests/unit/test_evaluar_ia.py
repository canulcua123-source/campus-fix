import argparse
import asyncio
from pathlib import Path

import pytest

from scripts import evaluar_ia


def prediccion(
    esperada: str,
    predicha: str,
    confianza: float | None,
    latencia: float,
    *,
    entrada: int | None = None,
    salida: int | None = None,
) -> evaluar_ia.Prediccion:
    return evaluar_ia.Prediccion(
        imagen_id=f"img-{latencia}",
        repeticion=1,
        esperada=esperada,
        predicha=predicha,
        confianza=confianza,
        latencia_total_ms=latencia,
        latencia_proveedor_ms=latencia / 2,
        tokens_entrada=entrada,
        tokens_salida=salida,
    )


def test_metricas_con_predicciones_fijas():
    predicciones = [
        prediccion("computo_redes", "computo_redes", 0.9, 100, entrada=250, salida=125),
        prediccion("infraestructura", "computo_redes", 0.6, 200, entrada=250, salida=125),
        prediccion("academico", "academico", 0.7, 300, entrada=250, salida=125),
        prediccion("no_determinada", "no_determinada", 0.2, 400, entrada=250, salida=125),
    ]
    tarifa = {
        "usd_millon_tokens_entrada": 1,
        "usd_millon_tokens_salida": 2,
        "fuente": "https://ejemplo.invalid/precios-versionados",
        "fecha": "2026-10-26",
    }

    metricas = evaluar_ia.calcular_metricas(predicciones, tarifa=tarifa)

    assert metricas["exactitud_por_categoria"]["computo_redes"] == {
        "aciertos": 1,
        "total": 1,
        "proporcion": 1.0,
    }
    assert metricas["exactitud_por_categoria"]["infraestructura"]["proporcion"] == 0
    assert metricas["macro_f1"] == pytest.approx(2 / 3)
    assert metricas["matriz_confusion"]["infraestructura"]["computo_redes"] == 1
    assert [c["cantidad"] for c in metricas["calibracion"]["cubetas"]] == [1, 2, 1]
    assert [c["exactitud"] for c in metricas["calibracion"]["cubetas"]] == [1, 0.5, 1]
    assert metricas["calibracion"]["brier"] == pytest.approx(0.275)
    assert metricas["latencia_total_ms"] == {"p50": 200.0, "p95": 400.0}
    assert metricas["costo"]["estado"] == "estimado_con_uso_real"
    assert metricas["costo"]["usd"] == pytest.approx(0.002)


def test_orden_estable_y_clases_ausentes_no_dividen_entre_cero():
    metricas = evaluar_ia.calcular_metricas([prediccion("computo_redes", "respuesta_extra", 0.4, 10)])

    assert metricas["orden_categorias"] == list(evaluar_ia.CATEGORIAS)
    assert metricas["matriz_confusion"]["computo_redes"][evaluar_ia.COLUMNA_INVALIDA] == 1
    assert metricas["metricas_por_clase"]["academico"]["f1"] == 0
    assert metricas["macro_f1"] == 0


@pytest.mark.parametrize("confianza", [-0.01, 1.01, float("nan")])
def test_confianza_fuera_de_rango(confianza):
    with pytest.raises(ValueError, match="confianza"):
        evaluar_ia.calibracion([prediccion("computo_redes", "computo_redes", confianza, 10)])


def test_clasifica_respuesta_invalida_y_limite_de_cuota():
    class Limite(Exception):
        status_code = 429

    assert evaluar_ia._tipo_fallo(ValueError("json invalido")) == "respuesta_invalida"
    assert evaluar_ia._tipo_fallo(Limite("cuota")) == "limite_cuota"


def test_argumentos_invalidos_y_proveedor_desconocido():
    with pytest.raises(evaluar_ia.ErrorEvaluacion):
        evaluar_ia.validar_argumentos(argparse.Namespace(repeticiones=0))
    with pytest.raises(SystemExit) as salida:
        evaluar_ia.construir_parser().parse_args(["--proveedor", "otro", "--repeticiones", "3"])
    assert salida.value.code == 2


def test_manifiesto_mal_formado_e_incompleto(tmp_path):
    malformado = tmp_path / "mal.jsonl"
    malformado.write_text("{\n", encoding="utf-8")
    with pytest.raises(evaluar_ia.ManifiestoInvalido):
        evaluar_ia.cargar_jsonl(malformado)

    registros = evaluar_ia.cargar_jsonl(evaluar_ia.MANIFIESTO_PREDETERMINADO)
    evaluar_ia.validar_estructura_manifiesto(registros)
    with pytest.raises(evaluar_ia.EtiquetadoIncompleto, match="44 registros pendientes"):
        evaluar_ia.validar_set_completo(registros, evaluar_ia.MANIFIESTO_PREDETERMINADO.parent)


def test_kappa_y_ausencia_de_dos_anotaciones_reales():
    completos = [
        {"etiqueta_evaluador_a": "computo_redes", "etiqueta_evaluador_b": "computo_redes"},
        {"etiqueta_evaluador_a": "infraestructura", "etiqueta_evaluador_b": "academico"},
        {"etiqueta_evaluador_a": "academico", "etiqueta_evaluador_b": "academico"},
        {"etiqueta_evaluador_a": "no_determinada", "etiqueta_evaluador_b": "no_determinada"},
    ]
    resultado = evaluar_ia.calcular_kappa(completos)
    assert resultado["calculable"] is True
    assert resultado["kappa"] == pytest.approx(2 / 3)
    assert evaluar_ia.calcular_kappa([{"etiqueta_evaluador_a": "computo_redes"}])["calculable"] is False


def test_deteccion_de_exif():
    con_exif = b"\xff\xd8\xff\xe1\x00\x08Exif\x00\x00\xff\xd9"
    sin_exif = b"\xff\xd8\xff\xd9"
    assert evaluar_ia.contiene_exif(con_exif) is True
    assert evaluar_ia.contiene_exif(sin_exif) is False


def test_lee_dimensiones_del_jpeg_procesado():
    sof = b"\xff\xd8\xff\xc0\x00\x0b\x08\x00\x64\x00\xc8\x01\x01\x11\x00\xff\xd9"
    assert evaluar_ia.dimensiones_jpeg(sof) == (200, 100)


def _registro_temporal(tmp_path: Path) -> dict:
    imagen = tmp_path / "imagen.jpg"
    imagen.write_bytes(b"\xff\xd8\xff\xd9")
    return {
        "id": "imagen-01",
        "grupo": "computo",
        "ruta_procesada": imagen.name,
        "etiqueta_final": "computo_redes",
    }


def test_repeticiones_error_timeout_y_salida_sin_secretos(tmp_path, capsys):
    registro = _registro_temporal(tmp_path)
    llamadas = 0

    async def proveedor(_nombre, _datos, _media_type):
        nonlocal llamadas
        llamadas += 1
        if llamadas == 1:
            raise TimeoutError("token-super-secreto")
        if llamadas == 2:
            raise evaluar_ia.CredencialesNoDisponibles("api-key-super-secreta")
        return evaluar_ia.RespuestaProveedor(
            analisis={
                "es_incidencia_valida": True,
                "categoria": "computo_redes",
                "titulo": "Falla visible",
                "descripcion": "Se observa una falla visible en el equipo",
                "prioridad_sugerida": "media",
                "tags": ["falla_visible"],
                "campos_detectados": [],
                "confianza": 0.9,
                "advertencias": [],
            },
            latencia_proveedor_ms=1,
        )

    predicciones, fallos = asyncio.run(evaluar_ia.ejecutar_evaluacion([registro], tmp_path, "claude", 3, proveedor))
    salida = capsys.readouterr()
    assert llamadas == 3
    assert len(predicciones) == 1
    assert [f.tipo for f in fallos] == ["timeout", "credenciales_no_disponibles"]
    assert "token-super-secreto" not in salida.out + salida.err
    assert "api-key-super-secreta" not in salida.out + salida.err


def test_reporte_conserva_metricas_por_repeticion_y_consistencia():
    predicciones = [
        evaluar_ia.Prediccion("a", 1, "computo_redes", "computo_redes", 0.9),
        evaluar_ia.Prediccion("a", 2, "computo_redes", "infraestructura", 0.6),
    ]
    registros = [
        {
            "etiqueta_evaluador_a": "computo_redes",
            "etiqueta_evaluador_b": "computo_redes",
        }
    ]
    reporte = evaluar_ia.construir_reporte("claude", 2, predicciones, [], None, registros)
    assert len(reporte["por_repeticion"]) == 2
    assert reporte["consistencia"]["categoria"] == 0
    assert reporte["variacion_macro_f1"]["min"] == 0


def test_costo_no_disponible_sin_tarifa_o_uso():
    p = [prediccion("computo_redes", "computo_redes", 0.9, 1)]
    assert evaluar_ia.calcular_costo(p, None)["estado"] == "no_disponible"
    tarifa = {
        "usd_millon_tokens_entrada": 1,
        "usd_millon_tokens_salida": 1,
        "fuente": "https://ejemplo.invalid",
        "fecha": "2026-10-26",
    }
    assert evaluar_ia.calcular_costo(p, tarifa)["estado"] == "no_disponible"


def test_metricas_de_decision_por_grupo_validez_accion_y_prioridad():
    predicciones = [
        evaluar_ia.Prediccion(
            "adv-01",
            1,
            "infraestructura",
            "infraestructura",
            0.9,
            grupo="adversaria",
            incidencia_valida_esperada=True,
            incidencia_valida_predicha=True,
            prioridad_esperada="media",
            prioridad_predicha="alta",
            accion_predicha="autollenar",
        ),
        evaluar_ia.Prediccion(
            "noi-01",
            1,
            "no_determinada",
            "academico",
            0.8,
            grupo="no_incidencia",
            incidencia_valida_esperada=False,
            incidencia_valida_predicha=False,
            prioridad_esperada="baja",
            prioridad_predicha="critica",
            accion_predicha="autollenar",
        ),
    ]

    metricas = evaluar_ia.metricas_decision(predicciones)
    assert metricas["exactitud_por_grupo"]["adversaria"]["proporcion"] == 1
    assert metricas["recall_no_incidencia"] == 1
    assert metricas["precision_autollenar"] == 0.5
    assert metricas["prioridad_exacta"] == 0
    assert metricas["prioridad_dentro_de_un_nivel"] == 0.5
    assert metricas["adversarias"] == {"cambios_clasificacion": 0, "total": 1}


def test_jsonl_tiene_composicion_solicitada():
    registros = evaluar_ia.cargar_jsonl(evaluar_ia.MANIFIESTO_PREDETERMINADO)
    evaluar_ia.validar_estructura_manifiesto(registros)
    conteos = {grupo: sum(r["grupo"] == grupo for r in registros) for grupo in evaluar_ia.GRUPOS_ESPERADOS}
    assert conteos == evaluar_ia.GRUPOS_ESPERADOS
    assert len(registros) == 44


def test_usa_el_puerto_proveedorvision_sin_contexto(monkeypatch):
    import app.services.vision as vision
    from app.core.config import settings
    from app.schemas.ia import AnalisisImagen

    llamadas = []
    analisis = AnalisisImagen(
        es_incidencia_valida=True,
        categoria="computo_redes",
        titulo="Switch apagado",
        descripcion="Switch sin luces",
        prioridad_sugerida="media",
        tags=["switch"],
        campos_detectados=[],
        confianza=0.8,
        advertencias=[],
    )

    class Falso:
        nombre = "gemini"
        modelo = "modelo-falso"

        async def analizar(self, imagen, media_type, pistas):
            llamadas.append((imagen, media_type, pistas))
            return analisis

    monkeypatch.setattr(settings, "gemini_modelo", "modelo-falso")
    monkeypatch.setitem(vision._instancias, ("gemini", "modelo-falso"), Falso())
    respuesta = asyncio.run(evaluar_ia.llamar_proveedor_produccion("gemini", b"img", "image/jpeg"))

    assert llamadas == [(b"img", "image/jpeg", None)]
    assert respuesta.analisis["categoria"] == "computo_redes"
    assert "detalle_infra" not in respuesta.analisis


def test_errores_del_puerto_se_clasifican():
    from app.services.vision.puerto import ErrorProveedor, error_http

    assert evaluar_ia._tipo_fallo(error_http(429)) == "limite_cuota"
    assert evaluar_ia._tipo_fallo(ErrorProveedor("x", transitorio=True, tipo="timeout")) == "timeout"
    assert evaluar_ia._tipo_fallo(ErrorProveedor("x", tipo="respuesta_invalida")) == "respuesta_invalida"
    assert evaluar_ia._tipo_fallo(ErrorProveedor("x", tipo="configuracion")) == "proveedor_no_disponible"


def test_capa_gratuita_bloquea_la_corrida(monkeypatch):
    import app.services.vision as vision
    from app.core.config import settings

    vision.reiniciar_proveedores()
    monkeypatch.setattr(settings, "gemini_api_key", "clave-de-prueba")
    monkeypatch.setattr(settings, "gemini_capa", "gratuita")
    monkeypatch.setattr(settings, "ia_permitir_capa_gratuita", False)
    with pytest.raises(evaluar_ia.ProveedorNoDisponible):
        evaluar_ia.validar_disponibilidad_proveedor("gemini")
