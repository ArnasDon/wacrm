# Checklist antes de producción

Esta instancia se configuró para **pruebas en local**. Un par de
ajustes de Supabase Auth se relajaron a propósito para poder crear
cuentas sin fricción, y **hay que revertirlos antes de exponer la app
a usuarios reales**. Ninguno de los dos vive en el código ni en las
migraciones: son toggles del dashboard de Supabase, así que no hay
nada en el repo que te los recuerde. De ahí este archivo.

Proyecto de pruebas: `mxketdpkcrkmivombqab` (WA CRM).

## 1. Reactivar "Confirm email"

**Dónde:** Dashboard → Authentication → Sign In / Providers → Email →
**Confirm email**

**Estado actual:** desactivado (`mailer_autoconfirm: true`).

**Por qué se desactivó:** con la confirmación activa, Supabase exige
hacer clic en un enlace enviado por correo antes del primer login, y
el servicio de email integrado de los proyectos nuevos solo entrega a
la dirección del dueño del proyecto y con un tope de pocos envíos por
hora. Para registrarse una vez en local es un estorbo sin ninguna
ganancia.

**Por qué hay que revertirlo:** apagado, cualquiera puede registrarse
con un correo que no le pertenece. Nadie comprueba que quien escribe
`jefe@empresa.com` tenga acceso a ese buzón. Eso permite suplantar
identidades, y además rompe la recuperación de contraseña: el enlace
de reseteo viaja al correo real, que está en manos de otra persona.

**Al reactivarlo**, configura también un SMTP propio (Authentication →
Emails → SMTP Settings). El servicio integrado de Supabase no sirve
para producción: sus límites de envío son para desarrollo.

## 2. Activar "Leaked Password Protection"

**Dónde:** Dashboard → Authentication → Policies (o Password Security)

**Estado actual:** desactivado — es el valor por defecto de Supabase,
no algo que se cambiara aquí.

**Qué hace:** contrasta cada contraseña nueva contra la base de
HaveIBeenPwned, usando k-anonymity (se envía un prefijo del hash,
nunca la contraseña). Si esa contraseña ya apareció en una filtración
conocida, la rechaza.

**Por qué importa:** el ataque más común contra un login no es
adivinar contraseñas, es probar las que ya se filtraron en otros
sitios. Un usuario que reutiliza su contraseña de siempre queda
expuesto desde el primer día. Este toggle corta esa vía y no cuesta
nada.

## Otras cosas que conviene mirar el día del despliegue

- **`NEXT_PUBLIC_SITE_URL`** apunta a `http://localhost:8080` en
  `.env.local`. Debe pasar a la URL pública real. Ojo: se hornea en el
  bundle del cliente en tiempo de build, así que exige reconstruir la
  imagen, no basta con reiniciar.
- **`AUTOMATION_CRON_SECRET`** está sin definir. Sin él,
  `GET /api/automations/cron` y `GET /api/flows/cron` devuelven 503, y
  los pasos "Wait" de automatizaciones y flujos nunca avanzan. Hace
  falta además un scheduler externo que los invoque.
- **`ENCRYPTION_KEY`** — la de local es de pruebas. Si generas una
  nueva en producción, ten presente que rotarla deja ilegibles todos
  los tokens de WhatsApp cifrados con la anterior: los usuarios tienen
  que volver a guardar su configuración.
- **Webhook de Meta** — necesita una URL pública alcanzable. Desde
  `localhost` no llega nada.
- **`get_advisors`** del MCP de Supabase (o el Advisor del dashboard)
  lista avisos de seguridad y rendimiento. Vale la pena repasarlo
  después de cualquier cambio de esquema.
