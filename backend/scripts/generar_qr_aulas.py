"""Genera QR de aulas desde un CSV local; nunca consulta ni modifica MongoDB.

Uso:
  python scripts/generar_qr_aulas.py nuevo-id
  python scripts/generar_qr_aulas.py generar aulas.csv --base-url https://campus.example --salida ./qr
"""

import argparse
import csv
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlencode, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.ubicacion import generar_id_aula, id_aula_valido  # noqa: E402

COLUMNAS = ("id_publico", "edificio", "piso", "aula")


@dataclass(frozen=True)
class AulaQR:
    id_publico: str
    edificio: str
    piso: int
    aula: str


def _texto(valor: str, campo: str, fila: int) -> str:
    limpio = valor.strip()
    if not limpio or len(limpio) > 60:
        raise ValueError(f"Fila {fila}: {campo} debe tener entre 1 y 60 caracteres")
    return limpio


def leer_aulas_csv(ruta: Path) -> list[AulaQR]:
    if not ruta.is_file():
        raise ValueError(f"No existe el CSV: {ruta}")
    with ruta.open(encoding="utf-8-sig", newline="") as archivo:
        lector = csv.DictReader(archivo)
        if tuple(lector.fieldnames or ()) != COLUMNAS:
            raise ValueError(f"El CSV debe contener exactamente: {', '.join(COLUMNAS)}")
        aulas: list[AulaQR] = []
        ids: set[str] = set()
        ubicaciones: set[tuple[str, int, str]] = set()
        for numero, fila in enumerate(lector, start=2):
            aula_id = (fila["id_publico"] or "").strip()
            if not id_aula_valido(aula_id):
                raise ValueError(f"Fila {numero}: id_publico inválido")
            try:
                piso = int((fila["piso"] or "").strip())
            except ValueError as exc:
                raise ValueError(f"Fila {numero}: piso debe ser entero") from exc
            if not -5 <= piso <= 50:
                raise ValueError(f"Fila {numero}: piso fuera de -5..50")
            edificio = _texto(fila["edificio"] or "", "edificio", numero)
            nombre_aula = _texto(fila["aula"] or "", "aula", numero)
            ubicacion = (edificio.casefold(), piso, nombre_aula.casefold())
            if aula_id in ids:
                raise ValueError(f"Fila {numero}: id_publico duplicado")
            if ubicacion in ubicaciones:
                raise ValueError(f"Fila {numero}: ubicación duplicada")
            ids.add(aula_id)
            ubicaciones.add(ubicacion)
            aulas.append(AulaQR(aula_id, edificio, piso, nombre_aula))
    if not aulas:
        raise ValueError("El CSV no contiene aulas")
    return aulas


def construir_url(base_url: str, aula_id: str) -> str:
    if not id_aula_valido(aula_id):
        raise ValueError("Identificador de aula inválido")
    base = base_url.strip().rstrip("/")
    partes = urlsplit(base)
    local = partes.hostname in {"localhost", "127.0.0.1", "::1"}
    if partes.scheme not in ({"https"} if not local else {"http", "https"}) or not partes.netloc:
        raise ValueError("La URL base debe ser HTTPS (HTTP solo se permite en localhost)")
    if partes.username or partes.password:
        raise ValueError("La URL base no debe incluir credenciales")
    if partes.query or partes.fragment or not re.fullmatch(r"/?", partes.path):
        raise ValueError("La URL base debe contener solo esquema y dominio")
    return f"{base}/reportar?{urlencode({'aula': aula_id})}"


def generar_qr(aulas: list[AulaQR], base_url: str, salida: Path, sobrescribir: bool = False) -> list[Path]:
    try:
        import qrcode
    except ImportError as exc:  # pragma: no cover - depende de la instalación del entorno
        raise RuntimeError("Falta qrcode; instala backend/requirements.txt") from exc
    salida.mkdir(parents=True, exist_ok=True)
    destinos = [salida / f"{aula.id_publico}.png" for aula in aulas]
    existentes = [ruta for ruta in destinos if ruta.exists()]
    if existentes and not sobrescribir:
        raise FileExistsError(f"Ya existe {existentes[0]}; usa --sobrescribir de forma explícita")
    for aula, destino in zip(aulas, destinos, strict=True):
        imagen = qrcode.make(construir_url(base_url, aula.id_publico))
        imagen.save(destino)
    return destinos


def main() -> int:
    parser = argparse.ArgumentParser(description="Generador local de QR para el catálogo de aulas")
    sub = parser.add_subparsers(dest="comando", required=True)
    sub.add_parser("nuevo-id", help="Imprime un identificador opaco nuevo")
    generar = sub.add_parser("generar", help="Genera un PNG por fila de un CSV controlado")
    generar.add_argument("csv", type=Path)
    generar.add_argument("--base-url", required=True)
    generar.add_argument("--salida", type=Path, required=True)
    generar.add_argument("--sobrescribir", action="store_true")
    args = parser.parse_args()
    if args.comando == "nuevo-id":
        print(generar_id_aula())
        return 0
    try:
        aulas = leer_aulas_csv(args.csv)
        creados = generar_qr(aulas, args.base_url, args.salida, args.sobrescribir)
    except (OSError, ValueError, RuntimeError) as exc:
        parser.error(str(exc))
    print(f"OK: {len(creados)} QR generados en {args.salida.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
