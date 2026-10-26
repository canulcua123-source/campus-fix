"""Estado atómico de familias de refresh tokens en Redis."""

from enum import StrEnum

from redis.asyncio import Redis


class ResultadoRefresh(StrEnum):
    OK = "OK"
    INVALIDO = "INVALIDO"
    REVOCADO = "REVOCADO"
    REUTILIZADO = "REUTILIZADO"


def _clave_familia(family_id: str) -> str:
    return f"refresh:familia:{family_id}"


def _clave_token(jti: str) -> str:
    return f"refresh:token:{jti}"


_INICIAR_FAMILIA = """
local ahora = tonumber(redis.call('TIME')[1])
local expira = tonumber(ARGV[3])
if expira <= ahora or redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then
  return 'INVALIDO'
end
redis.call('HSET', KEYS[1], 'sub', ARGV[1], 'estado', 'activa')
redis.call('EXPIREAT', KEYS[1], expira)
redis.call('HSET', KEYS[2], 'sub', ARGV[1], 'familia', ARGV[2], 'estado', 'activo')
redis.call('EXPIREAT', KEYS[2], expira)
return 'OK'
"""


_LUA_ROTACION = """
local familia = redis.call('HMGET', KEYS[1], 'sub', 'estado')
if not familia[1] or familia[1] ~= ARGV[1] then return 'INVALIDO' end
if familia[2] ~= 'activa' then return 'REVOCADO' end

local anterior = redis.call('HMGET', KEYS[2], 'sub', 'familia', 'estado')
if not anterior[1] or anterior[1] ~= ARGV[1] or anterior[2] ~= ARGV[2] then
  return 'INVALIDO'
end
if anterior[3] ~= 'activo' then
  if anterior[3] == 'usado' or anterior[3] == 'revocado' then
    redis.call('HSET', KEYS[1], 'estado', 'revocada')
    return 'REUTILIZADO'
  end
  return 'INVALIDO'
end

local ahora = tonumber(redis.call('TIME')[1])
local expira = tonumber(ARGV[3])
if expira <= ahora or redis.call('EXISTS', KEYS[3]) == 1 then return 'INVALIDO' end

redis.call('HSET', KEYS[2], 'estado', 'usado')
redis.call('EXPIREAT', KEYS[2], expira)
redis.call('HSET', KEYS[3], 'sub', ARGV[1], 'familia', ARGV[2], 'estado', 'activo')
redis.call('EXPIREAT', KEYS[3], expira)
redis.call('EXPIREAT', KEYS[1], expira)
return 'OK'
"""


_REVOCAR_FAMILIA = """
local token = redis.call('HMGET', KEYS[2], 'sub', 'familia')
if not token[1] or token[1] ~= ARGV[1] or token[2] ~= ARGV[2] then return 'INVALIDO' end
local familia = redis.call('HMGET', KEYS[1], 'sub')
if not familia[1] or familia[1] ~= ARGV[1] then return 'INVALIDO' end
redis.call('HSET', KEYS[2], 'estado', 'revocado')
redis.call('HSET', KEYS[1], 'estado', 'revocada')
return 'OK'
"""


async def iniciar_familia(
    redis: Redis,
    *,
    sub: str,
    jti: str,
    family_id: str,
    family_exp: int,
) -> ResultadoRefresh:
    resultado = await redis.eval(
        _INICIAR_FAMILIA,
        2,
        _clave_familia(family_id),
        _clave_token(jti),
        sub,
        family_id,
        family_exp,
    )
    return ResultadoRefresh(resultado)


async def rotar_token(
    redis: Redis,
    *,
    sub: str,
    jti_anterior: str,
    jti_nuevo: str,
    family_id: str,
    family_exp: int,
) -> ResultadoRefresh:
    resultado = await redis.eval(
        _LUA_ROTACION,
        3,
        _clave_familia(family_id),
        _clave_token(jti_anterior),
        _clave_token(jti_nuevo),
        sub,
        family_id,
        family_exp,
    )
    return ResultadoRefresh(resultado)


async def revocar_familia(
    redis: Redis,
    *,
    sub: str,
    jti: str,
    family_id: str,
) -> ResultadoRefresh:
    resultado = await redis.eval(
        _REVOCAR_FAMILIA,
        2,
        _clave_familia(family_id),
        _clave_token(jti),
        sub,
        family_id,
    )
    return ResultadoRefresh(resultado)
