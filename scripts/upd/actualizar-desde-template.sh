#!/usr/bin/env bash
# UPD.1 · Baja la plantilla en un repo hijo por merge, sin commitear, y revisa
# el cambio como diff. Nunca hace commit ni push (R8). Uso:
#   scripts/upd/actualizar-desde-template.sh [<remoto>/<rama>]
#   (por defecto template/main, o plantilla/main si el remoto se llama así)
# Salida: 0 listo para revisar; 1 rechazado antes de tocar el árbol; 2 conflictos
# por resolver; 3 árbol sucio, rama upd ya existente, HEAD desacoplado, sin
# historia común, merge fallido, argumentos o tsx faltante.
set -euo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tsx="${UPD_TSX:-$raiz/node_modules/.bin/tsx}"
if [ ! -x "$tsx" ]; then
  echo "UPD: no encuentro tsx en $tsx; corre 'npm ci' en $raiz o define UPD_TSX" >&2
  exit 3
fi
chequeo() {
  "$tsx" --tsconfig "$raiz/tsconfig.json" "$raiz/scripts/upd/revisar-cambio.cli.ts" "$@" --repo "$PWD"
}

if [ -n "${1:-}" ]; then
  destino="$1"
elif git remote | grep -qx template; then
  destino="template/main"
elif git remote | grep -qx plantilla; then
  destino="plantilla/main"
else
  echo "UPD: no hay remoto 'template' ni 'plantilla'; agrega uno o pasa <remoto>/<rama>." >&2
  exit 3
fi
remoto="${destino%%/*}"
rama="${destino#*/}"
fecha="${UPD_FECHA:-$(date +%F)}"
nueva="upd/${fecha}"

if [ -n "$(git status --porcelain)" ]; then
  echo "UPD: el árbol de trabajo tiene cambios sin commitear; guárdalos o descártalos antes de actualizar." >&2
  exit 3
fi

if ! partida="$(git symbolic-ref --short -q HEAD)"; then
  echo "UPD: HEAD está desacoplado; ponte en una rama antes de actualizar." >&2
  exit 3
fi
if git show-ref --verify --quiet "refs/heads/$nueva"; then
  echo "UPD: ya existe la rama $nueva; bórrala o define UPD_FECHA." >&2
  exit 3
fi
git fetch "$remoto" "$rama"
if ! git merge-base HEAD "$remoto/$rama" >/dev/null 2>&1; then
  echo "UPD: este repo no comparte historia con $remoto/$rama (¿creado con 'Use this template'?)." >&2
  echo "UPD: haz el primer merge a mano con --allow-unrelated-histories; ver docs/actualizar-desde-template.md." >&2
  exit 3
fi

# Se revisa el cambio ANTES de tocar el árbol: un merge reemplaza archivos
# ignorados (p. ej. un .env versionado en la plantilla pisaría el de la empresa).
set +e
chequeo --rango "HEAD...$remoto/$rama"
codigo=$?
set -e
if [ "$codigo" -ne 0 ]; then
  echo "UPD: cambio rechazado; el árbol quedó como estaba en $partida." >&2
  [ "$codigo" -eq 1 ] && exit 1
  exit 3
fi

git switch -q -c "$nueva"
set +e
git merge --no-commit --no-ff "$remoto/$rama"
merge=$?
set -e

if [ "$merge" -ne 0 ]; then
  if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    echo "UPD: resuelve los conflictos, commitea y abre la PR $nueva."
    exit 2
  fi
  git switch -q "$partida"
  git branch -D "$nueva" >/dev/null
  echo "UPD: git merge falló sin dejar merge en curso; el árbol quedó como estaba en $partida." >&2
  exit 3
fi

echo
git diff --cached --stat HEAD
dir="$(mktemp -d "${TMPDIR:-/tmp}/upd-XXXXXX")"
git diff --cached HEAD > "$dir/cambio.diff"
echo "Diff completo: $dir/cambio.diff"
echo
echo "UPD: revisa el diff, commitea y abre la PR $nueva (nada se commitea ni se sube solo)."
