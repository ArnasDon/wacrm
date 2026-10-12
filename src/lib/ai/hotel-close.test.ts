import { describe, expect, it } from 'vitest'
import {
  claimsRequestNoted,
  replyWithoutNotedClaim,
  replyWithoutCloseClaim,
  closeLine,
  isStillAsking,
  nameFromAnswer,
  stripTrailingAttachmentOffer,
  hasConflictingAmount,
  isPastDate,
  mentionedAmounts,
  stripTrailingPermissionQuestion,
} from './hotel-close'

describe('stripTrailingPermissionQuestion', () => {
  it('strips a "quedo atenta para registrar" wait, even stacked with a permission question (B51)', () => {
    expect(
      stripTrailingPermissionQuestion('Paquete San Ricardo del 23/10 al 24/10, Gabriela. Quedo atenta para registrar las fechas.'),
    ).toBe('Paquete San Ricardo del 23/10 al 24/10, Gabriela.')
    expect(
      stripTrailingPermissionQuestion('Todo listo, Gabriela. Quedo atenta para registrarla. ¿Desea que se la deje lista?'),
    ).toBe('Todo listo, Gabriela.')
    expect(stripTrailingPermissionQuestion('Quedo atenta a cualquier duda. 😊')).toBeNull()
  })

  it('strips the permission questions seen in the 2026-09-24 test run', () => {
    expect(
      stripTrailingPermissionQuestion(
        'La Suite Clásica es muy cómoda. Para esas fechas, le queda del 13/10/2026 al 14/10/2026. ¿Desea que le deje registrada la solicitud para que el equipo le confirme disponibilidad y el total?',
      ),
    ).toBe('La Suite Clásica es muy cómoda. Para esas fechas, le queda del 13/10/2026 al 14/10/2026.')
    expect(stripTrailingPermissionQuestion('Total GTQ 1,160. ¿Le gustaría que la dejemos anotada para esas fechas?')).toBe(
      'Total GTQ 1,160.',
    )
    expect(stripTrailingPermissionQuestion('Así queda. ¿Desea que deje esta solicitud lista?')).toBe('Así queda.')
    expect(stripTrailingPermissionQuestion('Se lo dejo anotado. ¿Desea que también le conecte con alguien del equipo?')).toBe('Se lo dejo anotado.')
    expect(stripTrailingPermissionQuestion('¿Le gustaría que le deje anotada la solicitud para el 11/10/2026 por la mañana?')).toBe('')
  })

  it('leaves real questions and plain closes alone', () => {
    expect(stripTrailingPermissionQuestion('¿Para cuántas personas sería?')).toBeNull()
    expect(stripTrailingPermissionQuestion('¿Me confirma la fecha de salida?')).toBeNull()
    expect(stripTrailingPermissionQuestion('Queda anotado, en breve le escribimos.')).toBeNull()
    expect(stripTrailingPermissionQuestion('¿Cuál de estas le interesa?')).toBeNull()
  })
})

describe('mentionedAmounts / hasConflictingAmount', () => {
  it('parses quetzal amounts in the formats the bot writes', () => {
    expect(mentionedAmounts('el total estimado sería GTQ 1,160 y el anticipo Q580')).toEqual([1160, 580])
    expect(mentionedAmounts('Q.300 por persona, 50 minutos, 2 personas')).toEqual([300])
    expect(mentionedAmounts('sin precios aquí, 15:00 y 12:00')).toEqual([])
  })

  it('flags a model figure that contradicts the computed total (prueba #8: Q1,160 vs Q1,500)', () => {
    expect(hasConflictingAmount('el total estimado sería GTQ 1,160', 1500, 750)).toBe(true)
    expect(hasConflictingAmount('el total estimado sería GTQ 1,500 con anticipo de Q750', 1500, 750)).toBe(false)
    expect(hasConflictingAmount('queda anotado para el 07/11/2026', 1500, 750)).toBe(false)
  })

  it('skips add-on prices (extra bed, children, spa) — they are not the stay total', () => {
    const reply =
      'Para 5 adultos, la habitación ya se cotiza con su tarifa de 5 personas; la cama adicional solo aplica cuando se solicita aparte y su referencia es de Q300 en temporada normal y Q400 en temporada alta.\n\nQueda registrada su solicitud.'
    expect(hasConflictingAmount(reply, 3300, 1650)).toBe(false)
    expect(hasConflictingAmount('Los niños de 6 a 12 años pagan Q175 por noche.', 3035, 1518)).toBe(false)
    expect(hasConflictingAmount('El masaje cuesta Q.300 por persona.', 3035, 1518)).toBe(false)
  })

  it('still flags a room price stated next to an add-on sentence', () => {
    expect(hasConflictingAmount('La Junior Suite sale en Q1,160 por noche. La cama adicional es Q300.', 3300, 1650)).toBe(true)
  })
})

describe('isPastDate', () => {
  it('compares ISO dates as strings', () => {
    expect(isPastDate('2026-09-10', '2026-09-23')).toBe(true)
    expect(isPastDate('2026-09-23', '2026-09-23')).toBe(false)
    expect(isPastDate('2026-10-01', '2026-09-23')).toBe(false)
    expect(isPastDate(null, '2026-09-23')).toBe(false)
  })
})

describe('closeLine', () => {
  it('rotates warm variants that never ask a question', () => {
    const lines = [0, 1, 2, 3].map(closeLine)
    expect(new Set(lines).size).toBe(3)
    for (const l of lines) expect(l).not.toContain('?')
  })
})

describe('statement-form offers, imperative asks and attachment offers (re-tests 2026-09-24)', () => {
  it('strips a trailing "Si desea, le dejo la solicitud lista…" offer', () => {
    expect(
      stripTrailingPermissionQuestion(
        'El sábado aplica la tarifa recreativa. Si desea, le dejo la solicitud lista para que el equipo le confirme disponibilidad y el total.',
      ),
    ).toBe('El sábado aplica la tarifa recreativa.')
    expect(stripTrailingPermissionQuestion('Queda anotado para el 20/10. Nuestro equipo le escribirá.')).toBeNull()
  })

  it('treats an imperative request as still asking (prueba #36)', () => {
    expect(isStillAsking('Para dejarla bien registrada, por favor compárteme el nombre de la empresa y el NIT.')).toBe(true)
    expect(isStillAsking('Indíqueme la fecha, por favor.')).toBe(true)
    expect(isStillAsking('¿Para cuántas personas?')).toBe(true)
    expect(isStillAsking('Queda registrada su solicitud; en breve le escribimos.')).toBe(false)
    // live chat 2026-09-29: asked adults/children with no "?" and was closed anyway
    expect(
      isStillAsking('Para dejarle la solicitud lista, solo me hace falta saber cuántos adultos serían y si viajan con niños.'),
    ).toBe(true)
    expect(isStillAsking('Solo me falta el nombre para la reservación.')).toBe(true)
    expect(isStillAsking('Necesito saber qué habitación prefiere.')).toBe(true)
  })

  it('drops "si gusta, le comparto el menú" when the menu is being sent (pruebas #3/#44)', () => {
    expect(
      stripTrailingAttachmentOffer('El almuerzo es de 12:00 a 17:00. Si gusta, también le comparto el menú completo.'),
    ).toBe('El almuerzo es de 12:00 a 17:00.')
    expect(stripTrailingAttachmentOffer('El almuerzo es de 12:00 a 17:00.')).toBeNull()
  })
})

describe('claimsRequestNoted', () => {
  it('detects a "saved" claim', () => {
    for (const m of ['Queda anotada la Suite Clásica Doble para 3 personas.', 'Perfecto, le registro 2 personas.', 'Ya quedó registrada su solicitud.', 'Quedan anotados sus datos.', 'Se la dejo anotada.']) {
      expect(claimsRequestNoted(m), m).toBe(true)
    }
  })
  it('ignores replies that save nothing', () => {
    for (const m of ['¿Para qué fechas la desea?', 'La Suite Premium tiene 2 camas Queen.', 'El registro de entrada es a las 15:00.']) {
      expect(claimsRequestNoted(m), m).toBe(false)
    }
  })
})

describe('nameFromAnswer', () => {
  const asked = 'Solo me indica por favor a nombre de quién sería la reservación.'
  it('reads a bare name answer to the bot’s name question (live chat 2026-09-29)', () => {
    expect(nameFromAnswer(asked, 'Mercedes Marroquí por favor')).toBe('Mercedes Marroquí')
    expect(nameFromAnswer('¿Con quién tengo el gusto?', 'con juan')).toBe('Juan')
    expect(nameFromAnswer('¿Con quién tengo el gusto?', 'Soy Ana López.')).toBe('Ana López')
  })
  it('ignores answers that are not a name, or when the name was not asked', () => {
    expect(nameFromAnswer(asked, 'Sí gracias')).toBeNull()
    expect(nameFromAnswer(asked, 'Habitación para 2 personas')).toBeNull()
    expect(nameFromAnswer(asked, '¿Cuánto cuesta?')).toBeNull()
    expect(nameFromAnswer('¿Qué fechas le interesan?', 'Mercedes Marroquí')).toBeNull()
  })
})

describe('replyWithoutNotedClaim', () => {
  it('keeps the answer and drops only the false "noted" claim', () => {
    expect(replyWithoutNotedClaim('Estamos en el Km 82.5, a unas 2 horas. Sobre el transporte, le dejo anotada su consulta.\nhttps://maps.app.goo.gl/x'))
      .toBe('Estamos en el Km 82.5, a unas 2 horas.\n\nhttps://maps.app.goo.gl/x\n\nYa le pasé su solicitud al equipo del hotel; se la confirman por este chat en breve.')
  })
  it('falls back to a team line when nothing is left', () => {
    expect(replyWithoutNotedClaim('Queda anotada su solicitud.')).toBe('Ya le pasé su solicitud al equipo del hotel; se la confirman por este chat en breve.')
  })
})

describe('replyWithoutCloseClaim', () => {
  it('drops the "queda solicitado" sentence the bot said before the name was known (QA 2026-10-01)', () => {
    expect(
      replyWithoutCloseClaim(
        'Qué gusto acompañarle en esta celebración. Ya queda solicitado su Paquete Romántico para 2 personas, del 13/11/2026 al 14/11/2026, por su aniversario; el check-in es a partir de las 3:00 pm y el check-out a las 12:00 pm.',
      ),
    ).toBe('Qué gusto acompañarle en esta celebración.')
    expect(replyWithoutCloseClaim('Wonderful choice, Mark. I’ve noted your Junior Suite.')).toBe('Wonderful choice, Mark.')
    expect(replyWithoutCloseClaim('Queda solicitado su masaje.')).toBe('')
  })

  it('returns null when nothing claims the request is closed', () => {
    expect(replyWithoutCloseClaim('Ya tengo su entrada para el 13/11/2026. ¿Cuál sería la fecha de salida?')).toBeNull()
    expect(replyWithoutCloseClaim('Queda anotada su mascota.')).toBeNull()
  })
})

describe('replyWithoutNotedClaim — no duplicated team line', () => {
  it('keeps the reply as-is when it already says the team follows up', () => {
    expect(replyWithoutNotedClaim('Con gusto, el equipo le escribe para el ingreso temprano. Le dejo anotada su solicitud.'))
      .toBe('Con gusto, el equipo le escribe para el ingreso temprano.')
  })
})
