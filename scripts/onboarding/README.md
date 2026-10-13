# Formularios de alta (Google Forms)

`alta-formularios.gs` crea los tres formularios de alta (hotel, clínica,
comercio y servicios) con las preguntas de `src/lib/onboarding/spec.ts` y
manda cada respuesta a SANDÍA.

## Instalación (una sola vez)

1. Abre https://script.google.com con la cuenta de Google donde quieres
   tener los formularios y crea un proyecto nuevo.
2. Pega el contenido de `alta-formularios.gs` y guarda.
3. Ve a **Configuración del proyecto → Propiedades de la secuencia de
   comandos** y agrega `SANDIA_SECRET` con el valor que muestra
   `/admin → Formularios de alta`.
4. Elige `crearFormularios` y pulsa **Ejecutar**. Autoriza los permisos
   (Forms, Sheets, conexiones externas y activadores).
5. En `/admin → Formularios de alta` deben aparecer los tres formularios
   como registrados.

## Uso

En `/admin`, abre la empresa → **Formulario de alta** → elige el
formulario → **Copiar enlace** y mándaselo al dueño. Cuando lo envíe,
llega un correo y la respuesta aparece en esa misma sección, lista para
**Aplicar**.

## Si cambian las preguntas

Después de desplegar un cambio en `spec.ts`, ejecuta `recrearFormularios`.
Crea formularios nuevos y los registra; los enlaces de `/admin` se
regeneran solos con el mismo código de cada empresa. Los formularios
viejos dejan de usarse (puedes borrarlos de Drive).

## Si una respuesta no llegó

Google te avisa por correo cuando el activador falla. Ejecuta
`reenviarRespuestas` para volver a mandarlas todas; reenviar la misma
respuesta solo la sobrescribe.
