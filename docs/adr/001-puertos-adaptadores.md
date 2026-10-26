# ADR 001: dominio y puertos/adaptadores

- Estado: aceptada
- Fecha: 2026-10-24

## Contexto

Las reglas de estados, etiquetas y folios estaban mezcladas con esquemas HTTP, Redis y MongoDB. Además, el router de incidencias llamaba directamente a funciones concretas del almacenamiento S3 compatible. Esto dificultaba probar el negocio sin servicios externos y sustituir B2/R2.

## Decisión

Se adopta una separación ligera de puertos y adaptadores:

- `app/dominio` contiene reglas puras y el protocolo `StoragePort`; solo usa la biblioteca estándar.
- `app/adaptadores/storage_b2.py` implementa ese puerto con boto3, firma S3v4 y creación diferida del cliente.
- `app/core/storage.py` compone la configuración con el adaptador y conserva la fachada anterior para scripts y pruebas existentes.
- El router recibe `StoragePort` mediante `Depends(get_storage)`. MongoDB y Redis permanecen en el router: no se abstraen porque T-015 limita el puerto a la integración variable de almacenamiento.
- Los esquemas Pydantic reexportan `TRANSICIONES` y `normalizar_tag` para mantener compatibilidad.

El incremento, TTL, resincronización y reintento del folio continúan en la capa de aplicación; el dominio únicamente determina fecha local y formato. La transición sigue validándose atómicamente en MongoDB mediante el estado de origen.

## Consecuencias

El dominio se prueba sin red y `FakeStorage` permite sustituir B2/R2. Se preservan rutas, permisos, respuestas y códigos HTTP. Agregar otro proveedor exige implementar cuatro operaciones (`url_subida`, `url_lectura`, `promover`, `tamano_objeto`) y exponer la expiración. La fachada de compatibilidad puede retirarse cuando scripts y pruebas heredadas consuman el puerto directamente.
