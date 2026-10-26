"""Adaptador S3 compatible para Backblaze B2 y Cloudflare R2."""

from collections.abc import Callable
from typing import Any
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.dominio.puertos import StorageNoDisponibleError

EXPIRA_SEGUNDOS = 300


class B2Storage:
    """Implementa el puerto de almacenamiento con la API S3 compatible."""

    def __init__(
        self,
        *,
        endpoint: str,
        access_key_id: str,
        secret_access_key: str,
        bucket: str,
        region: str,
        client_factory: Callable[..., Any] = boto3.client,
    ) -> None:
        self._endpoint = endpoint
        self._access_key_id = access_key_id
        self._secret_access_key = secret_access_key
        self._bucket = bucket
        self._region = region
        self._client_factory = client_factory
        self._client: Any | None = None

    @property
    def expira_segundos(self) -> int:
        return EXPIRA_SEGUNDOS

    def requerir_cliente(self) -> Any:
        """Crea el cliente en el primer uso y rechaza configuración incompleta."""
        if not (self._endpoint and self._access_key_id and self._secret_access_key):
            raise StorageNoDisponibleError("El almacenamiento de evidencias no está configurado")
        if self._client is None:
            self._client = self._client_factory(
                "s3",
                endpoint_url=self._endpoint,
                aws_access_key_id=self._access_key_id,
                aws_secret_access_key=self._secret_access_key,
                region_name=self._region,
                config=Config(signature_version="s3v4"),
            )
        return self._client

    def url_subida(self, clave: str, tipo_mime: str, peso_bytes: int) -> str:
        return self.requerir_cliente().generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._bucket,
                "Key": clave,
                "ContentType": tipo_mime,
                "ContentLength": peso_bytes,
            },
            ExpiresIn=self.expira_segundos,
        )

    def url_lectura(self, clave: str, nombre_archivo: str) -> str:
        disposicion = f"attachment; filename*=UTF-8''{quote(nombre_archivo)}"
        return self.requerir_cliente().generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self._bucket,
                "Key": clave,
                "ResponseContentDisposition": disposicion,
            },
            ExpiresIn=self.expira_segundos,
        )

    def promover(self, origen: str, destino: str) -> None:
        cliente = self.requerir_cliente()
        cliente.copy_object(
            Bucket=self._bucket,
            Key=destino,
            CopySource={"Bucket": self._bucket, "Key": origen},
        )
        cliente.delete_object(Bucket=self._bucket, Key=origen)

    def tamano_objeto(self, clave: str) -> int | None:
        try:
            return self.requerir_cliente().head_object(Bucket=self._bucket, Key=clave)["ContentLength"]
        except ClientError:
            return None
