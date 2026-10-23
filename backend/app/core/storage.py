"""URLs firmadas del almacenamiento de evidencias (API S3: Backblaze B2 o Cloudflare R2)."""

from functools import lru_cache

from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.core.config import settings

EXPIRA_SEGUNDOS = 300


@lru_cache
def _cliente():
    endpoint = settings.storage_endpoint or (
        f"https://{settings.r2_account_id}.r2.cloudflarestorage.com" if settings.r2_account_id else ""
    )
    if not (endpoint and settings.r2_access_key_id and settings.r2_secret_access_key):
        return None
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name=settings.storage_region,
        config=Config(signature_version="s3v4"),
    )


def _requerir_cliente():
    cliente = _cliente()
    if cliente is None:
        raise HTTPException(503, "El almacenamiento de evidencias no está configurado")
    return cliente


def url_subida(clave: str, tipo_mime: str, peso_bytes: int) -> str:
    # Content-Type y Content-Length quedan firmados: R2 rechaza la subida si el navegador manda otro tipo o tamaño.
    return _requerir_cliente().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.r2_bucket, "Key": clave, "ContentType": tipo_mime, "ContentLength": peso_bytes},
        ExpiresIn=EXPIRA_SEGUNDOS,
    )


def url_lectura(clave: str, nombre_archivo: str) -> str:
    # attachment: el navegador descarga el archivo en lugar de interpretarlo en el origen de R2.
    disposicion = f"attachment; filename*=UTF-8''{quote(nombre_archivo)}"
    return _requerir_cliente().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket, "Key": clave, "ResponseContentDisposition": disposicion},
        ExpiresIn=EXPIRA_SEGUNDOS,
    )


def promover(origen: str, destino: str) -> None:
    """Copia el objeto verificado de staging/ a su ruta definitiva y borra el temporal."""
    cliente = _requerir_cliente()
    cliente.copy_object(
        Bucket=settings.r2_bucket, Key=destino, CopySource={"Bucket": settings.r2_bucket, "Key": origen}
    )
    cliente.delete_object(Bucket=settings.r2_bucket, Key=origen)


def tamano_objeto(clave: str) -> int | None:
    """Tamaño real del objeto en R2, o None si no existe."""
    try:
        return _requerir_cliente().head_object(Bucket=settings.r2_bucket, Key=clave)["ContentLength"]
    except ClientError:
        return None
