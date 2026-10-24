# Módulos de la empresa

Un módulo es una pieza opcional del fork que se engancha al flujo de entrada de WhatsApp
(contrato I3, `contracts/mod/module.ts`). Con todos apagados la app se comporta igual que wacrm.

## Declarar un módulo

El módulo se escribe con `definirModulo({ nombre, configSchema, migraciones, alEntrarMensaje? })` y se
agrega a la lista de `src/modulos/registro.ts`. El nombre es `[a-z][a-z0-9]*`.

## Encenderlo

La empresa lo enciende en `config/modules.yaml` (forma de CT.1):

```yaml
modulos:
  demo:
    activo: true
    config:
      limite: 2
```

- Archivo ausente o vacío: todo apagado.
- Módulo apagado: su config no se valida.
- Encendido con config inválida, o encendido y no registrado: el arranque falla (código 1).
- Apagado y no registrado: se ignora.

La carpeta se toma de `CONFIG_EMPRESA_DIR` (por defecto `./config`). En Docker el servicio `app`
monta `./config:/app/config:ro`.

## Qué pasa al arrancar y por mensaje

`src/instrumentation.ts` carga y valida los módulos al iniciar el servidor. El flujo se guarda en
`globalThis`, porque Next compila `instrumentation` y las rutas en bundles distintos; si la ruta no lo
encuentra, lo arma perezosamente.

El webhook (`processMessage`) llama a `despacharEntradaAModulos` después de guardar el mensaje y antes de
flows, automatizaciones e IA. Reenvíos, reacciones y estados de entrega nunca llegan ahí. El error de un
enganche se registra (`[modulos]`) y no afecta la respuesta a Meta.

## Migraciones

`mod_<nombre>_NNN[_descripcion].sql` en `supabase/migrations/`. El glob `/migrations/*.sql` las ordena
después de todas las de wacrm (`NNN_*.sql`), así que corren al final. El Supabase CLI ignora los archivos
que no empiezan por dígitos: un despliegue con `supabase db push` debe aplicarlas aparte. CI lo ejercita
con `supabase/ci/modulos/mod_demo_001.sql` (`migrations.yml`).
