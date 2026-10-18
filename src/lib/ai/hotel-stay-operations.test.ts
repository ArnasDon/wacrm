import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './types'
import { hotelStayOperationReason } from './hotel-stay-operations'
const user = (content: string, createdAt = '2026-10-18T00:29:00Z'): ChatMessage => ({ role: 'user', content, createdAt })
describe('sales versus current guest operations', () => {
  it.each(['me gustaria consultarte los precios para una estadia para 4 adultos', 'Me comparte el menu?', 'A que hora sirven la cena?', 'Tienen restaurante?', 'Cuanto cuesta el desayuno?', 'La habitacion tiene agua caliente?', 'Tienen wifi?', 'Precio para hospedaje hoy'])('allows public sales information: %s', text => {
    expect(hotelStayOperationReason([user(text)])).toBeNull()
  })
  it('routes Maria room assignment and current dinner as one operational burst', () => {
    expect(hotelStayOperationReason([
      user('Ya dentro de un ratito llegamos al hotel', '2026-10-18T00:23:00Z'),
      user('Ya no me dijeron el numero de habitacion?', '2026-10-18T00:24:00Z'),
      user('Hay cena disponible'), user('??'), user('Para cenar ahi??'), user('Disculpe'),
    ])).toContain('asignada')
  })
  it.each(['Hay cena disponible', 'Podemos cenar ahorita?', 'El restaurante sigue abierto?', 'Pueden subir la cena a mi habitacion?'])('leaves live service to the hotel: %s', text => {
    expect(hotelStayOperationReason([user(text)])).toBeTruthy()
  })
  it.each(['El agua caliente no funciona', 'No hay agua caliente', 'No funciona la cerradura', 'Cual es mi numero de habitacion?', 'Me da la llave de mi cuarto?'])('routes technical guest details: %s', text => {
    expect(hotelStayOperationReason([user(text)])).toBeTruthy()
  })
  it('uses recent arrival context after an assistant turn', () => {
    expect(hotelStayOperationReason([user('Ya estamos en el hotel'), { role: 'assistant', content: 'Gracias por avisar' }, user('Para cenar ahi?')])).toContain('Restaurante')
  })
  it('does not mistake an earlier stay for a new sales inquiry', () => {
    expect(hotelStayOperationReason([user('Numero de habitacion?', '2026-10-09T00:00:00Z'), user('Precios para cuatro adultos')])).toBeNull()
  })
  it('keeps general public menu and hours eligible during a stay', () => {
    expect(hotelStayOperationReason([user('Ya estamos en el hotel'), user('Cual es el horario del restaurante?')])).toBeNull()
  })
})
