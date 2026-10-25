# Revisión de acceso 3: JWT, permisos y revocación

## Política de access tokens

- La API emite JWT firmados únicamente con `HS256`. El verificador fija ese algoritmo y rechaza `none`, `HS512` y cualquier otro valor inesperado.
- Cada token exige `sub`, `iss`, `aud`, `iat` y `exp`. El emisor es `utm-desk`, la audiencia es `utm-desk-api` y `sub` debe ser un `ObjectId` de usuario válido.
- `iat` y `exp` son instantes UTC. La diferencia es siempre de 15 minutos; la configuración rechaza cualquier otro valor para `JWT_ACCESS_MINUTES`.
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

La constante `LIMITE_LOGIN` es la fuente de verdad del decorador de `/auth/login`. `docs/reglas/API.md` documenta el mismo valor y la prueba e2e verifica la constante, el documento y el comportamiento HTTP real.

## Estado de refresh y logout (dependencia #14)

En la revisión de `dev` usada para este cambio no existen `POST /auth/refresh`, `POST /auth/logout`, cookies de refresh, `jti` ni familias de rotación. No se añadieron contratos parciales o simulados: hacerlo aquí duplicaría o volvería incompatible T-014.

Cuando T-014 se implemente, el refresh deberá consultar al usuario por `sub` y exigir `activo: true` antes de rotar o emitir tokens. La prueba `test_refresh_usuario_desactivado_401` corresponde a esa implementación y no puede representar comportamiento real mientras el endpoint no exista.

## Contrato público

Este cambio no agrega rutas ni modifica cuerpos de petición o respuesta. OpenAPI, Postman y los esquemas Zod no requieren cambios.
