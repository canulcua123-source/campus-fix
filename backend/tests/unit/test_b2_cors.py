"""La regla CORS del bucket B2 versionada en docs/infra/b2-cors.json (T-006)."""

import json
from pathlib import Path

REGLAS = json.loads((Path(__file__).resolve().parents[3] / "docs/infra/b2-cors.json").read_text())


def test_b2_cors_solo_pwa_y_operaciones_de_evidencias():
    assert len(REGLAS) == 1
    regla = REGLAS[0]
    assert "*" not in regla["allowedOrigins"]
    assert all(o.startswith(("https://", "http://localhost")) and not o.endswith("/") for o in regla["allowedOrigins"])
    assert set(regla["allowedOperations"]) == {"s3_put", "s3_get", "s3_head"}
    # El PUT firmado manda Content-Type = tipo_mime; ETag lo lee el cliente tras subir.
    assert regla["allowedHeaders"] == ["content-type"]
    assert regla["exposeHeaders"] == ["etag"]
