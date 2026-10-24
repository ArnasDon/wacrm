# Actualizar un repo hijo desde la plantilla

Para un repo hijo creado desde `wacrm-tenant-template`. La plantilla se baja por merge y el cambio
se revisa como diff antes de aplicarlo (R5, R8). Nada se sincroniza solo ni con wacrm upstream.

## Una vez

```bash
git remote add template https://github.com/juancadavidc/wacrm-tenant-template.git
npm ci   # el chequeo corre con tsx (o define UPD_TSX con la ruta de un binario tsx)
```

## Cada actualización

```bash
scripts/upd/actualizar-desde-template.sh            # por defecto template/main
```

El remoto por defecto es `template/main`; si no existe `template` pero sí `plantilla`
(el nombre que usa `docs/repo-hijo.md`), usa `plantilla/main`. También acepta `<remoto>/<rama>`.

El procedimiento, en orden:

1. Se niega a arrancar si el árbol tiene cambios sin commitear, si HEAD está desacoplado, si ya
   existe la rama `upd/<fecha>` o si el hijo no comparte historia con la plantilla (ver abajo).
2. Hace `git fetch`.
3. Revisa el cambio (`HEAD...<remoto>/<rama>`) **antes de tocar el árbol**, con el chequeo del
   hijo. Si rechaza, sale con 1 y no se modificó nada (un merge reemplazaría hasta archivos
   ignorados como `.env`).
4. Crea la rama `upd/<AAAA-MM-DD>` y hace `git merge --no-commit --no-ff`: el merge queda
   preparado, sin commit. Con conflictos sale con 2; si git falla sin dejar merge en curso,
   borra la rama y sale con 3.
5. Muestra `git diff --cached --stat HEAD` y guarda el diff completo en un directorio temporal
   (imprime la ruta, `cambio.diff`).

## Primer merge de un hijo creado con "Use this template"

Ese hijo no comparte historia con la plantilla y el script sale con 3. Haz el primer merge a
mano, en una rama aparte y con el árbol limpio:

```bash
git fetch template main
git switch -c upd/primero
git merge --no-commit --no-ff --allow-unrelated-histories template/main
```

Espera conflictos "add/add" en todo archivo que exista en ambos lados. Revisa que ninguna ruta de
la empresa (`config/`, `.env*`) cambie y resuelve el resto a favor de la plantilla. Desde la
siguiente actualización el script funciona. Un hijo creado con `git clone` ya comparte historia.

Si pasa: lee el diff, commitea, `git push -u origin upd/<fecha>` y abre la PR. El check
`UPD · chequeo de actualización` vuelve a correr ahí (con la versión ya mergeada del chequeo).
El script nunca hace commit ni push.

## Qué revisa el chequeo

- Que el cambio no toque rutas de la empresa (`esRutaDeEmpresa`, contrato CT.1): `config/`,
  `.env*` salvo los ejemplos.
- Si toca `docker-compose.yml`: que pase la topología de CT.2 y que no quite ni renombre un
  servicio obligatorio ni ningún volumen (los datos de la empresa quedarían huérfanos). Agregar o
  quitar `supabase-studio` o `tunnel` solo se informa.

## Códigos de salida

| Código | Significado |
|---|---|
| 0 | Pasa; merge preparado para revisar |
| 1 | Rechazado antes de tocar el árbol |
| 2 | Conflictos fuera de rutas de la empresa; resuélvelos a mano |
| 3 | Árbol sucio, HEAD desacoplado, rama `upd/<fecha>` existente, sin historia común, merge fallido, argumentos inválidos o falta `tsx` |

## Si rechaza

No toques `config/` ni `.env*` para "hacerlo pasar": el arreglo va en la plantilla.

Nota: el chequeo que corre en el procedimiento es la copia del hijo (la de antes del merge), así
que un cambio del propio chequeo en la plantilla se aplica desde la actualización siguiente.
