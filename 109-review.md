Gracias por el PR: usa `Card`, `EmptyState`, `ErrorState`, `Skeleton` y `Badge` de `ui`, el hook `useBuscar`, el esquema `busquedaSchema`, cubre los estados de consulta corta, carga, vacío y error, y muestra el score respetando el orden del backend. Buen trabajo.

Qué se corrigió en este PR y por qué:
- **Bug de foco en la barra de búsqueda:** `BuscadorGlobal` tenía `key={pathname+search}`. Cuando el debounce navegaba a `/buscar?q=re`, el `key` cambiaba, React remontaba el input y se perdía el foco y el texto a mitad de escritura ("red" se quedaba en "re"). Se quitó el `key` y el texto se sincroniza desde la URL con un `useEffect` solo ante navegación externa, sin pisar lo que se está escribiendo.
- **Resaltado:** ahora resalta palabras completas que empiezan con el término, sin distinguir acentos ni mayúsculas (antes marcaba subcadenas como "red" dentro de "Predeterminado" y no resaltaba "conexión" al buscar "conexion"; además `toLocaleLowerCase` podía desalinear los cortes).
- **Máximo de resultados:** el backend devuelve como máximo 20; ahora se avisa "Mostrando los 20 resultados más relevantes. Afina tu búsqueda".
- **Pruebas:** el debounce usa fake timers (299 ms no navega, 300 ms sí) en lugar de esperar tiempo real; se agregó una prueba que sigue escribiendo después del debounce y verifica que el input sigue montado y con foco; y pruebas de carga, error, aviso de máximo y resaltado.

Pendiente para ti: adjuntar capturas móvil/escritorio y la revisión manual del checklist.
