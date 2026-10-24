# Políticas de la empresa (`config/policies.yaml`)

`config/policies.yaml` es la fuente de las políticas nativas de wacrm de una empresa (R14): usuarios y
roles, etiquetas, etapas del embudo, automatizaciones de bienvenida y fuera de horario, y el
interruptor del bot. El script `scripts/empresa/aplicar-policies.mjs` las deja en la base de la
empresa. El ejemplo del template vive en `config.ejemplo/policies.yaml`.

## Esquema

Todas las llaves están en español y el esquema es estricto: una llave desconocida (por ejemplo
`asignacion:` o `visibilidad:`, que son de los módulos de la Fase 4) invalida el archivo.

```yaml
version: 1

usuarios: # al menos uno; exactamente un owner
  - { correo: dueno@ejemplo.co, nombre: 'Dueño', rol: owner } # owner | admin | asesor

etiquetas: # opcional
  - { nombre: VIP, color: '#f59e0b' } # color opcional (#rrggbb)

embudo: # opcional
  nombre: Ventas
  etapas: # al menos una; el orden del archivo es la posición
    - { nombre: Nuevo, color: '#3b82f6' }

automatizaciones: # opcional
  bienvenida: { activa: true, texto: '...' }
  fuera_de_horario:
    activa: true
    texto: '...'
    horario: '18:00-08:00' # HH:mm-HH:mm: franja en la que se envía el mensaje
    zona: America/Bogota # zona IANA

bot: # opcional
  activo: false
  respuesta_automatica: false
  tope_por_conversacion: 3 # 1 a 20
```

`asesor` es el rol `agent` de wacrm. El rol `viewer` no se expone.

## Aplicar

Desde el checkout del repo hijo, con `npm ci` hecho, la base arriba (`docker compose up -d --wait`)
y las migraciones de `supabase/migrations` aplicadas:

```bash
node scripts/empresa/aplicar-policies.mjs --plan   # muestra qué haría, sin escribir
node scripts/empresa/aplicar-policies.mjs          # aplica
```

Lee `.env` del repo (`NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_INTERNAL_URL`, y
`SUPABASE_SERVICE_ROLE_KEY`); lo que esté en el entorno manda sobre `.env`. Habla con la base por
PostgREST y la API admin de GoTrue a través de Kong (Postgres no se publica, R1). `--dir <ruta>`
apunta a otro checkout.

### Códigos de salida

| Código | Significado                                                                            |
| ------ | -------------------------------------------------------------------------------------- |
| 0      | Aplicado, o sin cambios ("Sin cambios: la base ya coincide con config/policies.yaml")  |
| 1      | `policies.yaml` inválido o falta una variable de entorno. No se tocó la red ni la base |
| 2      | La base choca con el archivo (ver "Conflictos"). No se escribió nada                   |
| 3      | Falló durante la escritura. Volver a correr es seguro: solo se aplica lo que falte     |

## Qué hace

- **Idempotente.** Compara la base con el archivo y aplica solo la diferencia; correrlo dos veces
  no duplica nada.
- **Identidad de cada cosa.** Etiqueta por nombre (sin distinguir mayúsculas), embudo por nombre,
  etapa por nombre dentro del embudo, usuario por correo, automatización por un marcador en su
  `description` (`policies.yaml:bienvenida`, `policies.yaml:fuera_de_horario`): cambiar el texto
  actualiza la automatización existente en vez de crear otra.
- **Cuenta.** La cuenta de la empresa es la del usuario `owner` del archivo; si no existe, se crea.
- **Usuarios nuevos.** Se crean con una contraseña temporal aleatoria que se imprime **una sola
  vez** en la terminal (no se escribe en disco). A un usuario que ya existe no se le cambia la
  contraseña.
- **Bot.** Fija `activo`, `respuesta_automatica` y `tope_por_conversacion`. Si la cuenta aún no tiene
  configuración de IA, avisa y sigue (no falla ni inventa una llave).

## Qué no hace

- **No borra.** Lo que no esté en el archivo (etiquetas, etapas, usuarios, automatizaciones) se
  queda: puede tener contactos, negocios o historial.
- **No transfiere el dueño** de la cuenta (se hace en la UI).
- **No carga proveedor, modelo ni llave de IA**, ni la base de conocimiento del bot: se hacen en
  Ajustes > IA.
- **No toca** reglas de asignación ni visibilidad (módulos, Fase 4) ni plantillas de Meta.

## Conflictos (código 2)

Se detectan antes de escribir y se listan todos juntos:

- Un usuario del archivo ya existe y pertenece a **otra** cuenta con datos (se registró por su
  lado). Moverlo dejaría huérfanos sus datos. Si su cuenta personal está vacía, se mueve.
- El `owner` del archivo ya existe pero no es el dueño actual de su cuenta.
- A un usuario que es dueño de la cuenta se le pide otro rol.
