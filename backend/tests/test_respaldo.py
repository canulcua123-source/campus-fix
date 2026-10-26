import asyncio
import gzip
import hashlib
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest

RAIZ = Path(__file__).resolve().parents[2]
SCRIPT = RAIZ / "backend" / "scripts" / "respaldo.sh"
SECRETO_FICTICIO = "valor-secreto-ficticio-t010"


def _buscar_bash() -> Path:
    candidatos = [
        shutil.which("bash"),
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ]
    for candidato in candidatos:
        if candidato and Path(candidato).is_file():
            return Path(candidato)
    raise RuntimeError("Las pruebas de respaldo requieren Bash (Git Bash, WSL o Linux)")


BASH = _buscar_bash()


@dataclass(frozen=True)
class ResultadoProceso:
    returncode: int
    stdout: str
    stderr: str


async def _ejecutar_bash_async(argumentos: tuple[str, ...], entorno: dict[str, str] | None) -> ResultadoProceso:
    proceso = await asyncio.create_subprocess_exec(
        str(BASH),
        *argumentos,
        cwd=str(RAIZ),
        env=entorno,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proceso.communicate(), timeout=15)
    except TimeoutError:
        proceso.kill()
        await proceso.wait()
        raise
    return ResultadoProceso(
        returncode=proceso.returncode or 0,
        stdout=stdout.decode("utf-8", errors="replace"),
        stderr=stderr.decode("utf-8", errors="replace"),
    )


def _ejecutar_bash(*argumentos: str, entorno: dict[str, str] | None = None) -> ResultadoProceso:
    return asyncio.run(_ejecutar_bash_async(argumentos, entorno))


def _ruta_bash(ruta: Path) -> str:
    if os.name != "nt":
        return str(ruta)
    resultado = _ejecutar_bash("-lc", 'cygpath -u -- "$1"', "t010", str(ruta))
    assert resultado.returncode == 0, resultado.stderr
    return resultado.stdout.strip()


def _path_bash() -> str:
    resultado = _ejecutar_bash("-lc", 'printf "%s" "$PATH"')
    assert resultado.returncode == 0, resultado.stderr
    return resultado.stdout


FAKE_MONGODUMP = r"""#!/usr/bin/env bash
set -eu

if [[ "${1:-}" == "--help" ]]; then
  [[ -z "${MONGODB_URI_RESPALDO:-}" ]] || exit 23
  if [[ "${MONGODUMP_FAKE_SIN_CONFIG:-0}" == "1" ]]; then
    printf '%s\n' 'mongodump simulado sin soporte requerido'
  else
    printf '%s\n' '  --config=<filename>'
  fi
  exit 0
fi

archivo=''
config=''
for argumento in "$@"; do
  case "$argumento" in
    --archive=*) archivo="${argumento#--archive=}" ;;
    --config=*) config="${argumento#--config=}" ;;
  esac
done

[[ -n "$archivo" && -n "$config" && -f "$config" ]] || exit 20
grep -q '^uri: ' "$config" || exit 21
printf '%s\n' "$@" >"$MONGODUMP_ARGS_LOG"

case "${MONGODUMP_FAKE_MODE:-correcto}" in
  correcto) printf '%s' 'respaldo BSON simulado' | gzip -c >"$archivo" ;;
  falla)
    printf '%s' 'parcial' >"$archivo"
    printf '%s\n' 'fallo interno simulado' >&2
    exit 9
    ;;
  vacio) : >"$archivo" ;;
  gzip_invalido) printf '%s' 'no es gzip' >"$archivo" ;;
  *) exit 22 ;;
esac
"""


@pytest.fixture
def entorno_respaldo(tmp_path: Path) -> tuple[dict[str, str], Path, Path]:
    binarios = tmp_path / "bin"
    binarios.mkdir()
    mongodump = binarios / "mongodump"
    mongodump.write_text(FAKE_MONGODUMP, encoding="utf-8", newline="\n")
    mongodump.chmod(0o700)

    destino = tmp_path / "volumen-cifrado" / "respaldos"
    argumentos = tmp_path / "argumentos-mongodump.txt"
    entorno = os.environ.copy()
    for variable in ("MONGODB_URI_RESPALDO", "RESPALDOS_DIR", "RESPALDOS_DESTINO_CIFRADO"):
        entorno.pop(variable, None)
    entorno.update(
        {
            "PATH": f"{_ruta_bash(binarios)}:{_path_bash()}",
            "MONGODB_URI_RESPALDO": SECRETO_FICTICIO,
            "RESPALDOS_DIR": _ruta_bash(destino),
            "RESPALDOS_DESTINO_CIFRADO": "confirmado",
            "MONGODUMP_ARGS_LOG": _ruta_bash(argumentos),
        }
    )
    return entorno, destino, argumentos


def _ejecutar_script(entorno: dict[str, str]) -> ResultadoProceso:
    return _ejecutar_bash(_ruta_bash(SCRIPT), entorno=entorno)


def _nombre_hoy() -> str:
    return f"utm_desk_{datetime.now(timezone.utc):%Y%m%d}.archive.gz"


def test_respaldo_exitoso_publica_archive_y_sha256(entorno_respaldo):
    entorno, destino, argumentos = entorno_respaldo

    resultado = _ejecutar_script(entorno)

    assert resultado.returncode == 0, resultado.stderr
    archivo = destino / _nombre_hoy()
    checksum = destino / f"{_nombre_hoy()}.sha256"
    assert archivo.is_file() and archivo.stat().st_size > 0
    assert checksum.is_file()
    with gzip.open(archivo, "rb") as comprimido:
        assert comprimido.read() == b"respaldo BSON simulado"
    hash_real = hashlib.sha256(archivo.read_bytes()).hexdigest()
    assert checksum.read_text(encoding="utf-8") == f"{hash_real}  {archivo.name}\n"

    invocacion = argumentos.read_text(encoding="utf-8")
    assert "--db=utm_desk" in invocacion
    assert "--archive=" in invocacion
    assert "--gzip" in invocacion
    assert "--quiet" in invocacion
    assert "--config=" in invocacion
    assert "--uri" not in invocacion
    assert SECRETO_FICTICIO not in invocacion
    assert SECRETO_FICTICIO not in resultado.stdout + resultado.stderr
    assert "Respaldo completado" in resultado.stdout
    assert not list(destino.glob(".respaldo-*.tmp.*"))
    assert not list(destino.glob("*.part*"))
    assert not list(destino.glob("*.lock"))


def test_falla_si_mongodump_no_esta_disponible(entorno_respaldo, tmp_path):
    entorno, destino, _argumentos = entorno_respaldo
    vacio = tmp_path / "path-vacio"
    vacio.mkdir()
    entorno["PATH"] = _ruta_bash(vacio)

    resultado = _ejecutar_script(entorno)

    assert resultado.returncode != 0
    assert "mongodump no está disponible" in resultado.stderr
    assert not destino.exists()


@pytest.mark.parametrize(
    ("variable", "mensaje"),
    [
        ("MONGODB_URI_RESPALDO", "falta la configuración secreta"),
        ("RESPALDOS_DIR", "falta configurar RESPALDOS_DIR"),
        ("RESPALDOS_DESTINO_CIFRADO", "almacenamiento cifrado"),
    ],
)
def test_exige_configuracion_autorizada(entorno_respaldo, variable, mensaje):
    entorno, destino, _argumentos = entorno_respaldo
    entorno.pop(variable)

    resultado = _ejecutar_script(entorno)

    assert resultado.returncode != 0
    assert mensaje in resultado.stderr
    assert SECRETO_FICTICIO not in resultado.stdout + resultado.stderr
    assert not destino.exists()


def test_rechaza_destino_dentro_del_repositorio_sin_crearlo(entorno_respaldo):
    entorno, _destino, _argumentos = entorno_respaldo
    destino_inseguro = RAIZ / f".respaldo-t010-{uuid4().hex}"
    entorno["RESPALDOS_DIR"] = _ruta_bash(destino_inseguro)

    resultado = _ejecutar_script(entorno)

    assert resultado.returncode != 0
    assert "fuera del repositorio" in resultado.stderr
    assert not destino_inseguro.exists()


def test_rechaza_ruta_relativa(entorno_respaldo):
    entorno, _destino, _argumentos = entorno_respaldo
    entorno["RESPALDOS_DIR"] = "respaldos-relativos"

    resultado = _ejecutar_script(entorno)

    assert resultado.returncode != 0
    assert "ruta absoluta" in resultado.stderr


def test_no_sobrescribe_respaldo_existente(entorno_respaldo):
    entorno, destino, _argumentos = entorno_respaldo
    destino.mkdir(parents=True)
    archivo = destino / _nombre_hoy()
    archivo.write_bytes(b"respaldo anterior")

    resultado = _ejecutar_script(entorno)

    assert resultado.returncode != 0
    assert "ya existe el respaldo" in resultado.stderr
    assert archivo.read_bytes() == b"respaldo anterior"
    assert not (destino / f"{archivo.name}.sha256").exists()


def test_no_elimina_bloqueo_de_otra_ejecucion(entorno_respaldo):
    entorno, destino, _argumentos = entorno_respaldo
    destino.mkdir(parents=True)
    fecha = datetime.now(timezone.utc).strftime("%Y%m%d")
    bloqueo_ajeno = destino / f".utm_desk_{fecha}.lock"
    bloqueo_ajeno.mkdir()

    resultado = _ejecutar_script(entorno)

    assert resultado.returncode != 0
    assert "otra ejecución" in resultado.stderr
    assert bloqueo_ajeno.is_dir()


@pytest.mark.parametrize(
    ("modo", "mensaje"),
    [
        ("falla", "mongodump no pudo completar"),
        ("vacio", "no produjo un archivo válido"),
        ("gzip_invalido", "no supera la comprobación gzip"),
    ],
)
def test_fallos_no_publican_archivos_parciales(entorno_respaldo, modo, mensaje):
    entorno, destino, _argumentos = entorno_respaldo
    entorno["MONGODUMP_FAKE_MODE"] = modo

    resultado = _ejecutar_script(entorno)

    assert resultado.returncode != 0
    assert mensaje in resultado.stderr
    assert SECRETO_FICTICIO not in resultado.stdout + resultado.stderr
    assert not (destino / _nombre_hoy()).exists()
    assert not (destino / f"{_nombre_hoy()}.sha256").exists()
    assert not list(destino.glob(".respaldo-*.tmp.*"))
    assert not list(destino.glob("*.part*"))


def test_rechaza_database_tools_sin_soporte_config(entorno_respaldo):
    entorno, destino, _argumentos = entorno_respaldo
    entorno["MONGODUMP_FAKE_SIN_CONFIG"] = "1"

    resultado = _ejecutar_script(entorno)

    assert resultado.returncode != 0
    assert "100.3.0 o posterior" in resultado.stderr
    assert not destino.exists()
