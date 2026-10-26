#!/usr/bin/env bash
set -Eeuo pipefail

readonly BASE_DATOS="utm_desk"
readonly PREFIJO_RESPALDO="utm_desk"
readonly CONFIRMACION_CIFRADO="confirmado"

error() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

command -v mongodump >/dev/null 2>&1 || error "mongodump no está disponible en PATH"

for herramienta in awk chmod date dirname grep gzip ln mkdir mktemp realpath rm rmdir sed sha256sum wc; do
  command -v "$herramienta" >/dev/null 2>&1 || error "falta la herramienta requerida: $herramienta"
done

[[ -n "${MONGODB_URI_RESPALDO:-}" ]] || error "falta la configuración secreta MONGODB_URI_RESPALDO"
[[ -n "${RESPALDOS_DIR:-}" ]] || error "falta configurar RESPALDOS_DIR"
[[ "${RESPALDOS_DESTINO_CIFRADO:-}" == "$CONFIRMACION_CIFRADO" ]] || error \
  "el destino debe estar aprobado como almacenamiento cifrado"
[[ "$RESPALDOS_DIR" == /* ]] || error "RESPALDOS_DIR debe ser una ruta absoluta"

case "$MONGODB_URI_RESPALDO" in
  *$'\n'* | *$'\r'*) error "MONGODB_URI_RESPALDO contiene caracteres no permitidos" ;;
esac
uri_respaldo="$MONGODB_URI_RESPALDO"
unset MONGODB_URI_RESPALDO
case "$RESPALDOS_DIR" in
  *$'\n'* | *$'\r'*) error "RESPALDOS_DIR contiene caracteres no permitidos" ;;
esac

if ! mongodump --help 2>&1 | grep -q -- '--config'; then
  error "mongodump debe pertenecer a MongoDB Database Tools 100.3.0 o posterior"
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../.." && pwd -P)"
destino="$(realpath -m -- "$RESPALDOS_DIR")"
[[ -n "${HOME:-}" ]] || error "HOME no está configurado"
home_real="$(realpath -m -- "$HOME")"

[[ "$destino" != "/" ]] || error "RESPALDOS_DIR no puede ser la raíz del sistema"
[[ "$destino" != "$home_real" ]] || error "RESPALDOS_DIR debe ser una carpeta dedicada, no HOME"
case "$destino/" in
  "$repo_root/"*) error "RESPALDOS_DIR debe estar fuera del repositorio" ;;
esac

umask 077
mkdir -p -- "$destino" || error "no fue posible crear RESPALDOS_DIR"
destino="$(cd -- "$destino" && pwd -P)"
case "$destino/" in
  "$repo_root/"*) error "RESPALDOS_DIR resolvió dentro del repositorio" ;;
esac
chmod 700 -- "$destino" || error "no fue posible restringir los permisos de RESPALDOS_DIR"
[[ -w "$destino" ]] || error "RESPALDOS_DIR no permite escritura"

fecha_utc="$(date -u +%Y%m%d)"
[[ "$fecha_utc" =~ ^[0-9]{8}$ ]] || error "no fue posible obtener una fecha UTC válida"
nombre="${PREFIJO_RESPALDO}_${fecha_utc}.archive.gz"
archivo_final="$destino/$nombre"
checksum_final="$archivo_final.sha256"
lock_dir="$destino/.${PREFIJO_RESPALDO}_${fecha_utc}.lock"
trabajo=""
config_temporal=""
archivo_temporal=""
checksum_temporal=""
log_temporal=""
archivo_publicado=0
checksum_publicado=0
lock_adquirido=0

limpiar() {
  local estado=$?
  trap - EXIT INT TERM HUP
  set +e
  if [[ "$estado" -ne 0 ]]; then
    [[ "$checksum_publicado" -eq 1 ]] && rm -f -- "$checksum_final"
    [[ "$archivo_publicado" -eq 1 ]] && rm -f -- "$archivo_final"
  fi
  [[ -n "$config_temporal" ]] && rm -f -- "$config_temporal"
  [[ -n "$archivo_temporal" ]] && rm -f -- "$archivo_temporal"
  [[ -n "$checksum_temporal" ]] && rm -f -- "$checksum_temporal"
  [[ -n "$log_temporal" ]] && rm -f -- "$log_temporal"
  [[ -n "$trabajo" ]] && rmdir -- "$trabajo" 2>/dev/null
  [[ "$lock_adquirido" -eq 1 ]] && rmdir -- "$lock_dir" 2>/dev/null
  exit "$estado"
}
trap limpiar EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

[[ ! -e "$archivo_final" && ! -L "$archivo_final" ]] || error "ya existe el respaldo de la fecha UTC actual"
[[ ! -e "$checksum_final" && ! -L "$checksum_final" ]] || error "ya existe la suma del respaldo de la fecha UTC actual"
mkdir -- "$lock_dir" 2>/dev/null || error "otra ejecución o respaldo de la fecha actual ya está en curso"
lock_adquirido=1

trabajo="$(mktemp -d "$destino/.respaldo-${fecha_utc}.tmp.XXXXXX")" || error \
  "no fue posible crear el directorio temporal"
chmod 700 -- "$trabajo" || error "no fue posible proteger el directorio temporal"
config_temporal="$trabajo/conexion.yml"
archivo_temporal="$trabajo/$nombre.part"
checksum_temporal="$trabajo/$nombre.sha256.part"
log_temporal="$trabajo/mongodump.log"

{
  printf "uri: '"
  printf '%s' "$uri_respaldo" | sed "s/'/''/g"
  printf "'\n"
} >"$config_temporal"
chmod 600 -- "$config_temporal" || error "no fue posible proteger la configuración temporal"
uri_respaldo=""
unset uri_respaldo

printf 'Respaldo iniciado\n'
printf 'Base de datos: %s\n' "$BASE_DATOS"
printf 'Fecha UTC: %s\n' "$fecha_utc"
printf 'Destino: %s\n' "$archivo_final"

if ! mongodump \
  --config="$config_temporal" \
  --db="$BASE_DATOS" \
  --archive="$archivo_temporal" \
  --gzip \
  --quiet \
  > /dev/null 2>"$log_temporal"; then
  error "mongodump no pudo completar el respaldo; se eliminó el archivo parcial"
fi

[[ -s "$archivo_temporal" ]] || error "mongodump no produjo un archivo válido"
gzip -t -- "$archivo_temporal" 2>/dev/null || error "el archivo generado no supera la comprobación gzip"

hash="$(sha256sum -- "$archivo_temporal" | awk '{print $1}')"
[[ "$hash" =~ ^[0-9a-fA-F]{64}$ ]] || error "no fue posible calcular una suma SHA-256 válida"
printf '%s  %s\n' "$hash" "$nombre" >"$checksum_temporal"
chmod 600 -- "$archivo_temporal" "$checksum_temporal" || error "no fue posible proteger el respaldo"

[[ ! -e "$archivo_final" && ! -L "$archivo_final" ]] || error "el respaldo apareció durante la ejecución; no se sobrescribirá"
ln -- "$archivo_temporal" "$archivo_final" || error "no fue posible publicar el respaldo sin sobrescribir"
archivo_publicado=1
ln -- "$checksum_temporal" "$checksum_final" || error "no fue posible publicar la suma SHA-256"
checksum_publicado=1
rm -f -- "$archivo_temporal" "$checksum_temporal"

tamano="$(wc -c <"$archivo_final")"
printf 'Tamaño: %s bytes\n' "$tamano"
printf 'SHA-256: %s\n' "$hash"
printf 'Respaldo completado\n'
