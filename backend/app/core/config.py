from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongodb_uri: str = "mongodb://localhost:27017"
    # Usuario con dbAdmin solo para scripts/init_db.py (collMod, índices). La API usa mongodb_uri.
    mongodb_admin_uri: str = ""
    mongodb_db: str = "utm_desk"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "cambia-esto"
    jwt_access_minutes: int = 15
    jwt_refresh_days: int = 7
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

    @field_validator("jwt_secret")
    @classmethod
    def _secreto_fuerte(cls, v: str) -> str:
        # Fail-closed: sin un secreto real la API no arranca (evita tokens falsificables).
        if v == "cambia-esto" or len(v) < 32:
            raise ValueError("JWT_SECRET debe tener al menos 32 caracteres (openssl rand -hex 32)")
        return v

    @field_validator("jwt_access_minutes")
    @classmethod
    def _access_token_quince_minutos(cls, v: int) -> int:
        if v != 15:
            raise ValueError("JWT_ACCESS_MINUTES debe ser 15")
        return v

    @field_validator("cors_origins")
    @classmethod
    def _sin_comodin(cls, v: str) -> str:
        # Con "*" cualquier página web podría llamar a la API desde el navegador de un usuario.
        if "*" in v:
            raise ValueError("CORS_ORIGINS no admite '*': lista los dominios del frontend separados por coma")
        return v

    @property
    def cors_lista(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
