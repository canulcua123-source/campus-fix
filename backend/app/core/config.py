import re
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_core import PydanticCustomError
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongodb_uri: str = "mongodb://localhost:27017"
    # Usuario con dbAdmin solo para scripts/init_db.py (collMod, índices). La API usa mongodb_uri.
    mongodb_admin_uri: str = ""
    mongodb_db: str = "utm_desk"
    redis_url: str = "redis://localhost:6379/0"
    dominio_correo: str = "utm.edu.mx"
    jwt_secret: str = "cambia-esto"
    jwt_access_minutes: int = 15
    jwt_refresh_days: int = 7
    refresh_cookie_secure: bool = True
    refresh_cookie_samesite: Literal["lax", "none"] = "lax"
    limite_refresh: str = "10/minute"
    cors_origins: str = "http://localhost:5173"
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "utm-desk-evidencias"
    # Cualquier almacenamiento compatible con S3. Vacío = Cloudflare R2 (usa r2_account_id).
    # Backblaze B2: https://s3.<region>.backblazeb2.com  (p. ej. https://s3.us-east-005.backblazeb2.com)
    storage_endpoint: str = ""
    storage_region: str = "auto"
    # Al registrar una evidencia, comprobar con HEAD que el archivo exista en R2 con el tamaño firmado.
    r2_verificar_subida: bool = True
    ia_limite_diario: int = 20
    ia_limite_global_diario: int = 300  # tope de gasto total de IA por día
    limite_escritura: str = "60/minute"  # altas y seguimiento por usuario
    limite_general: str = "300/minute"  # cualquier endpoint, por usuario (o IP sin token)
    limite_consulta_pesada: str = "30/minute"  # $text y pipelines de analítica
    anthropic_api_key: str = ""
    ia_habilitada: bool = True
    ia_modelo: str = "claude-opus-5-5"
    # Puerto ProveedorVision (T-028): cambiar de proveedor no requiere tocar el router.
    ia_proveedor: Literal["claude", "gemini"] = "claude"
    gemini_api_key: str = ""
    gemini_modelo: str = "gemini-3.5-flash"
    # La capa gratuita de Gemini usa el contenido para mejorar productos: solo para el set de evaluación.
    gemini_capa: Literal["gratuita", "pagada"] = "gratuita"
    ia_permitir_capa_gratuita: bool = False
    ia_umbral_costo_diario_usd: float | None = Field(default=None, ge=0, allow_inf_nan=False)

    @field_validator("jwt_secret")
    @classmethod
    def _secreto_fuerte(cls, v: str) -> str:
        # Fail-closed: sin un secreto real la API no arranca (evita tokens falsificables).
        if v == "cambia-esto" or len(v) < 32:
            raise ValueError("JWT_SECRET debe tener al menos 32 caracteres (openssl rand -hex 32)")
        return v

    @field_validator("jwt_access_minutes")
    @classmethod
    def _access_token_maximo_quince_minutos(cls, v: int) -> int:
        if not 1 <= v <= 15:
            raise ValueError("JWT_ACCESS_MINUTES debe estar entre 1 y 15")
        return v

    @field_validator("dominio_correo")
    @classmethod
    def _dominio_correo_valido(cls, v: str) -> str:
        dominio = v.strip().lower()
        if len(dominio) > 253 or not re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+",
            dominio,
        ):
            raise ValueError("DOMINIO_CORREO debe contener un dominio sin protocolo ni @")
        return dominio

    @field_validator("cors_origins")
    @classmethod
    def _sin_comodin(cls, v: str) -> str:
        # Con "*" cualquier página web podría llamar a la API desde el navegador de un usuario.
        if "*" in v:
            raise ValueError("CORS_ORIGINS no admite '*': lista los dominios del frontend separados por coma")
        return v

    @model_validator(mode="after")
    def _cookie_refresh_segura(self):
        if self.refresh_cookie_samesite == "none" and not self.refresh_cookie_secure:
            raise ValueError("SameSite=None requiere REFRESH_COOKIE_SECURE=true")
        return self

    @property
    def cors_lista(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

PATRON_CORREO = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


def validar_dominio_correo(correo: str, permitidos: tuple[str, ...] = ()) -> str:
    """Exige el dominio institucional vigente (DOMINIO_CORREO), leído en cada validación y no al importar."""
    if correo in permitidos or correo.rpartition("@")[2] == settings.dominio_correo:
        return correo
    raise PydanticCustomError("string_pattern_mismatch", "El correo debe pertenecer al dominio institucional")
