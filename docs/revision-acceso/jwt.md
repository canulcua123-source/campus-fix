# Revisión de acceso 3: JWT, permisos y revocación

## Política de access tokens

- La API emite JWT firmados únicamente con `HS256`. El verificador fija ese algoritmo y rechaza `none`, `HS512` y cualquier otro valor inesperado.
- Cada token exige `sub`, `iss`, `aud`, `iat` y `exp`. El emisor es `utm-desk`, la audiencia es `utm-desk-api` y `sub` debe ser un `ObjectId` de usuario válido.
- `iat` y `exp` son instantes UTC. La diferencia es de 15 minutos por defecto; la configuración rechaza valores de `JWT_ACCESS_MINUTES` fuera de 1 a 15.
- Los claims obligatorios no se pueden sobrescribir al emitir un token.

El JWT solo acredita la identidad. Aunque un token manipulado incluya `rol`, `permisos` o `alcance`, esos valores no se usan para autorizar.

## Autorización y revocación

En cada petición autenticada, `get_usuario_actual` consulta `usuarios` por `sub` y exige `activo: true`. Después, `require_permiso` consulta el rol vigente en `roles`. Por ello:

- desactivar o eliminar al usuario invalida de inmediato un access token todavía vigente;
- cambiar su rol, permisos o alcance surte efecto en la petición siguiente, sin volver a iniciar sesión;
- un rol inexistente queda sin permisos y con alcance `propio` (cierre seguro).

No se cachean roles ni permisos. Si se añade una caché en el futuro, deberá invalidarse de manera atómica al editar usuarios o roles para conservar esta garantía.

## Login y límite de intentos

Se conserva **10 solicitudes por minuto por IP**. Es el valor ya usado por la API y sus pruebas, y evita un límite demasiado agresivo para personas que comparten la salida NAT del campus. Se complementa con bloqueos de intentos fallidos: 10 en 15 minutos por combinación de cuenta e IP, y 50 en 15 minutos por cuenta entre todas las IP.

La constante `LIMITE_LOGIN` es la fuente de verdad del decorador de `/auth/login`; `docs/reglas/API.md` documenta el mismo valor y la prueba e2e verifica la constante y el comportamiento HTTP real.

## Refresh y logout

`POST /auth/refresh` consulta al usuario por `sub` y exige `activo: true` antes de rotar el token y emitir un access nuevo; un usuario desactivado recibe 401 (`test_refresh_usuario_desactivado_401`). Login, `get_usuario_actual` y refresh aplican el mismo criterio (`activo` debe ser exactamente `true`).

`JWT_ACCESS_MINUTES` acepta de 1 a 15 minutos: se puede acortar la vida del access token, nunca alargarla.

## Contrato público

Este cambio no agrega rutas ni modifica cuerpos de petición o respuesta. OpenAPI, Postman y los esquemas Zod no requieren cambios.
