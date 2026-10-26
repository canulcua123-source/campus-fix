"""Cupos del modo agéntico (T-034): 10 por usuario y día, 3 por aula y hora (configurables en configuracion_ia)."""

import hashlib
from datetime import datetime
from typing import Literal

from app.schemas.incidencia import Ubicacion

TTL_CUPO_USUARIO = 2 * 24 * 3600
TTL_CUPO_AULA = 2 * 3600

# Verifica ambos cupos y solo entonces incrementa los dos: atómico, sin consumos parciales.
_SCRIPT_CUPO_AGENTICO = """
local usos_usuario = tonumber(redis.call('GET', KEYS[1]) or '0')
local usos_aula = tonumber(redis.call('GET', KEYS[2]) or '0')
if usos_usuario >= tonumber(ARGV[1]) then return 1 end
if usos_aula >= tonumber(ARGV[2]) then return 2 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 0
"""


class CupoAgenticoAgotado(Exception):
    def __init__(self, alcance: Literal["usuario", "aula"], limite: int):
        self.alcance = alcance
        self.limite = limite
        if alcance == "usuario":
            mensaje = f"Alcanzaste el cupo agéntico de {limite} reportes por día; continúa con el formulario."
        else:
            mensaje = f"Esta aula alcanzó el cupo agéntico de {limite} reportes por hora; continúa con el formulario."
        super().__init__(mensaje)


def _identificador_aula(ubicacion: Ubicacion) -> str:
    texto = f"{ubicacion.edificio}\x1f{ubicacion.piso}\x1f{ubicacion.aula}".casefold().encode()
    return hashlib.sha256(texto).hexdigest()


def clave_cupo_usuario(usuario_id: object, ahora: datetime) -> str:
    return f"ia:agentico:usuario:{usuario_id}:{ahora:%Y-%m-%d}"


def clave_cupo_aula(ubicacion: Ubicacion, ahora: datetime) -> str:
    return f"ia:agentico:aula:{_identificador_aula(ubicacion)}:{ahora:%Y-%m-%dT%H}"


async def cupo_usuario_disponible(redis, usuario_id: object, ahora: datetime, *, limite: int) -> bool:
    """Lectura previa (sin consumir) para G9: se consulta ANTES de llamar a la IA."""
    usos = await redis.get(clave_cupo_usuario(usuario_id, ahora))
    return int(usos or 0) < limite


async def consumir_cupo_agentico(
    redis, usuario_id: object, ubicacion: Ubicacion, ahora: datetime, *, limite_usuario: int, limite_aula: int
) -> None:
    resultado = await redis.eval(
        _SCRIPT_CUPO_AGENTICO,
        2,
        clave_cupo_usuario(usuario_id, ahora),
        clave_cupo_aula(ubicacion, ahora),
        limite_usuario,
        limite_aula,
        TTL_CUPO_USUARIO,
        TTL_CUPO_AULA,
    )
    if int(resultado) == 1:
        raise CupoAgenticoAgotado("usuario", limite_usuario)
    if int(resultado) == 2:
        raise CupoAgenticoAgotado("aula", limite_aula)
