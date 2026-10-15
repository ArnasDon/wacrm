# Recepción del hotel y recuperación automática

Las solicitudes que requieren una decisión de recepción (pagos, cancelaciones, cambios, vouchers, tarifas especiales, cotizaciones de grupos y petición de una persona) no generan texto ni adjuntos al huésped. Se registra un pendiente interno y se conserva el responsable existente.

El pendiente limita ese asunto, sin desactivar toda la conversación. Cada respuesta real del personal reinicia una ventana de tres horas. Al terminar, una nueva consulta informativa puede responderse automáticamente con el contexto previo; el pendiente de recepción continúa abierto. Un sí, agradecimiento, archivo de pago o referencia ambigua no reinicia la venta. Los avisos internos no se repiten para un mismo pendiente.

Una pausa manual sigue siendo persistente. La recuperación reconoce las antiguas pausas automáticas de #271 por su resumen interno y usa una actualización condicional: una toma de control manual concurrente tiene prioridad. No se limpian asignaciones ni se marcan gestiones como resueltas.

El barrido existente recupera el último mensaje pendiente dentro de su ventana de antigüedad y no consume intentos mientras el personal atiende. El ritmo normal sigue siendo tres minutos desde el último mensaje del huésped.

Al retomar una consulta informativa con un pendiente, las acciones de reservas, cotizaciones, citas y cierre comercial se suprimen. El historial completo sigue disponible para respetar acuerdos anteriores, mientras el enrutamiento distingue el mensaje actual por fecha y por ráfaga de mensajes.

## Estilo comercial

Responder la pregunta concreta, recomendar una opción adecuada con un beneficio verificado y pedir el siguiente dato faltante. Agrupar preguntas relacionadas y evitar repetir datos, presentar menús completos sin necesidad o preguntar si desea recibir lo que ya pidió. Mantener usted, trato formal y amabilidad. La información confirmada y el control de recepción tienen prioridad sobre el cierre de la venta.
