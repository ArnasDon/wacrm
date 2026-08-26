# WACRM ↔ ERP Inventory API — Catálogo Comercial + Agente IA

## Nomenclatura oficial

### En el ERP
El módulo es genérico:

`Configuración → Integraciones → Inventory API`

No debe llamarse WACRM.

La integración concreta se identifica por proveedor/sistema:

`Inventory API → Proveedor: Budun ERP`

La misma arquitectura debe permitir futuros consumidores:
- otros CRM;
- otros agentes IA;
- otras aplicaciones;
- otras integraciones.

### En WACRM
La integración concreta se llama:

`Settings → Integrations → Budun ERP`

El agente utiliza una Tool:

`Budun Catalog`

Esta nomenclatura evita acoplar el ERP a WACRM.

---

## Objetivo

Permitir que el agente IA de WACRM consulte en tiempo real el catálogo comercial del ERP y responda al cliente con:

- producto;
- marca;
- modelo;
- SKU;
- descripción comercial;
- variantes;
- colores;
- capacidad/talla cuando aplique;
- precio;
- moneda;
- cantidad disponible;
- disponibilidad;
- fotos comerciales.

La integración inicial es READ-ONLY.

## Información prohibida

El catálogo comercial no debe devolver:

- IMEI 1;
- IMEI 2;
- número de serie;
- costo de compra;
- margen;
- proveedor;
- movimientos internos;
- usuarios internos;
- clientes privados;
- pagos;
- caja;
- contabilidad;
- RR. HH.;
- nómina;
- datos sensibles.

El endpoint comercial no debe devolver esos campos ni siquiera enmascarados.

## Arquitectura

```text
Cliente WhatsApp
      ↓
WACRM
      ↓
AI Agent
      ↓
Tool: Budun Catalog
      ↓
ERP Inventory API / Catalog API
      ↓
Producto + variantes + precio + disponibilidad + fotos
      ↓
AI Agent
      ↓
WACRM
      ↓
WhatsApp
```

## Tools del agente

Crear una integración interna de WACRM llamada:

`Budun Catalog`

Tools:

1. `buscar_producto_budun`
2. `consultar_disponibilidad_budun`
3. `obtener_producto_budun`

### buscar_producto_budun

Entrada:

```json
{
  "query": "Samsung S25",
  "color": "negro"
}
```

Respuesta comercial:

```json
{
  "products": [
    {
      "id": "public-product-id",
      "name": "Samsung Galaxy S25 256 GB",
      "brand": "Samsung",
      "model": "S25",
      "sku": "SAM-S25-256",
      "description": "Descripción comercial",
      "price": 34900,
      "currency": "DOP",
      "available_quantity": 4,
      "available": true,
      "colors": ["Negro", "Azul"],
      "variants": [],
      "primary_image": {
        "url": "https://erp.example.com/media/catalog/s25-negro.webp",
        "alt": "Samsung Galaxy S25 negro"
      },
      "images": [
        {
          "url": "https://erp.example.com/media/catalog/s25-negro.webp",
          "alt": "Samsung Galaxy S25 negro"
        }
      ]
    }
  ]
}
```

### consultar_disponibilidad_budun

Debe consultar disponibilidad por producto y, cuando corresponda, por color/variante.

### obtener_producto_budun

Devuelve el detalle comercial sin información interna.

## Variantes y colores

La API debe poder representar:

- color;
- capacidad;
- almacenamiento;
- talla;
- presentación;
- otras variantes configurables.

Disponibilidad por variante cuando corresponda.

Ejemplo:

```text
Samsung S25 256 GB
- Negro: 4
- Azul: 3
- Verde: 1
```

## Fotos

El ERP debe entregar:

- `primary_image`
- `images[]`

Las URLs deben ser absolutas y accesibles por el CRM/servicio de WhatsApp.

Las imágenes comerciales deben estar separadas de documentos privados.

WACRM puede usar la URL para enviar una imagen al cliente.

## Configuración en WACRM

Agregar:

`Settings → Integrations → Budun ERP`

Campos:

- ERP Inventory API Base URL;
- Application ID / App Key;
- Application Secret;
- Catalog API Key o Access Credential;
- scopes;
- estado de conexión;
- última prueba;
- último error.

Acciones:

- Probar conexión;
- Rotar credencial;
- Revocar credencial;
- Guardar configuración.

Guardar secretos únicamente server-side y cifrados usando el patrón de secretos existente en WACRM.

No enviar secretos al LLM ni al navegador.

## Credenciales

Diseño recomendado:

```text
Application ID / App Key
Application Secret
Access Credential / API Key
Scopes
```

No es necesario enviar `APP_SECRET` en cada consulta.

Preferir:

```text
Application credentials
      ↓
access token/credential
      ↓
Inventory API / Catalog API
```

cuando el ERP lo soporte.

Si inicialmente el ERP utiliza Bearer API Key, WACRM puede almacenar la API Key de forma segura y utilizarla server-side.

## Scopes iniciales

Para el agente comercial:

- `catalog:read`
- `catalog:availability:read`
- `catalog:media:read`

No conceder:

- escritura de inventario;
- ventas;
- pagos;
- nómina;
- contabilidad;
- clientes privados.

## Regla del agente

Cuando el cliente pregunte por:

- productos;
- precios;
- colores;
- variantes;
- disponibilidad;

debe consultar la herramienta del catálogo.

Nunca inventar precio, stock o variantes.

Si no hay disponibilidad, ofrecer alternativas solo cuando aparezcan en resultados reales.

## Knowledge Base

La Knowledge Base de WACRM debe contener información estable:

- horarios;
- ubicación;
- garantías;
- devoluciones;
- envíos;
- métodos de pago;
- políticas;
- preguntas frecuentes.

No cargar stock dinámico en la Knowledge Base.

Stock, precio, variantes y fotos vienen del ERP en tiempo real.

## Envío de fotos

Flujo:

```text
ERP Catalog API
      ↓
image URL
      ↓
AI Agent
      ↓
WACRM media send
      ↓
WhatsApp
```

La Tool no debe manejar directamente las credenciales de WhatsApp.

## Prueba de conexión

La configuración de WACRM debe permitir:

`Probar conexión`

y verificar:
1. URL;
2. credencial;
3. autenticación;
4. scope;
5. endpoint de catálogo;
6. respuesta;
7. latencia;
8. error seguro.

## Seguridad

- Nunca incluir API Key/App Secret en prompts.
- Nunca exponer credenciales al modelo.
- Nunca saltarse tenant isolation.
- Integración inicialmente READ-ONLY.
- No crear reserva/pedido/venta desde esta primera integración.
- Registrar errores sin secretos.
- Auditar creación/rotación/revocación de credenciales.

## Criterios de aceptación

1. WACRM guarda credenciales del ERP.
2. La prueba de conexión funciona.
3. El agente busca productos.
4. Responde precio.
5. Responde stock.
6. Responde colores/variantes.
7. Recibe URLs de fotos.
8. Puede enviar fotos por WhatsApp usando el mecanismo existente.
9. Nunca muestra IMEI/Serial.
10. Nunca muestra costo/margen/proveedor.
11. No cruza tenants.
12. No modifica el ERP.
13. Las credenciales no llegan al LLM.
14. El Playground de WACRM funciona con datos reales de prueba.

## Nota técnica

La implementación debe inspeccionar el repositorio WACRM real antes de modificarlo.

Reutilizar sus patrones existentes para:
- AI Agents;
- tool registry;
- integrations/settings;
- encrypted secrets;
- API clients;
- media/message sending.

No inventar APIs internas.

## Fuente técnica

La integración debe basarse en la versión real y actual del repositorio WACRM en el momento de la implementación.
