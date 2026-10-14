import { describe, expect, it } from 'vitest'
import { acceptsPhotoOffer, guestAskedForPhotos, isExplicitHumanRequest, isPolicyQuestion, stripTrailingPhotoOffer, isLocationQuestion, photoOnlyReplyText, productForPhotoRequest, isMedicalCaution, isPaymentRequest, isPhotoPromise, mapsLinkIn, productAskedAbout, replyNamesProduct, isArrivalTimeQuestion, isExistingBookingTalk, isNewQuoteAsk } from './hotel-media-intent'
import { categorySlugsMentioned } from '@/lib/reservations/upsert'

const HOTEL = [
  'Suite Clásica (Individual o Pareja)',
  'Suite Premium',
  'Suite Master Deluxe',
  'Paquete Romántico',
  'Paquete Luna de Miel',
  'Masaje Relajante',
  'Masaje Deep Tissue',
]

describe('productAskedAbout', () => {
  it('finds the item from a distinctive word (the 2026-09-24 conversation)', () => {
    expect(productAskedAbout('tiene fotos de la habitación deluxe?', HOTEL)).toBe('Suite Master Deluxe')
    expect(productAskedAbout('me interesa el paquete romantico', HOTEL)).toBe('Paquete Romántico')
    expect(productAskedAbout('¿cuánto cuesta la luna de miel?', HOTEL)).toBe('Paquete Luna de Miel')
  })

  it('matches a full name, accents and parenthesized notes ignored', () => {
    expect(productAskedAbout('Quiero la suite clasica para 2', HOTEL)).toBe('Suite Clásica (Individual o Pareja)')
    expect(productAskedAbout('info del Masaje Relajante', HOTEL)).toBe('Masaje Relajante')
  })

  it('stays silent on generic or ambiguous messages', () => {
    expect(productAskedAbout('las habitaciones cuanto cuestan?', HOTEL)).toBeNull()
    expect(productAskedAbout('qué suites tienen?', HOTEL)).toBeNull()
    expect(productAskedAbout('un masaje por favor', HOTEL)).toBeNull()
    expect(productAskedAbout('la premium o la deluxe?', HOTEL)).toBeNull()
    expect(productAskedAbout('hola', HOTEL)).toBeNull()
  })

  it('prefers the longest full-name match over one it contains', () => {
    const names = ['Suite Deluxe', 'Suite Master Deluxe']
    expect(productAskedAbout('fotos de la suite master deluxe', names)).toBe('Suite Master Deluxe')
    expect(productAskedAbout('fotos de la suite deluxe', names)).toBe('Suite Deluxe')
  })
})

describe('productAskedAbout on the real Villa San Ricardo catalog', () => {
  const VSR = [
    'Alquiler de bicicleta (30 min)', 'Alquiler de cuatrimoto (15 min)', 'Alquiler de cuatrimoto (30 min)',
    'Tour al Nacimiento', 'Junior Suite Familiar', 'Suite Clásica (Individual o Pareja)', 'Suite Clásica Doble',
    'Suite Master Deluxe', 'Suite Premium', 'Paquete Luna de Miel', 'Paquete Romántico', 'Paquete San Ricardo',
    'Paquete San Vicente', 'Masaje Deep Tissue', 'Masaje Drenaje Linfático', 'Masaje Express',
    'Masaje Reductor', 'Masaje Reflexología', 'Masaje Relajante', 'Masaje Shiatsu',
  ]
  const ask = (m: string) => productAskedAbout(m, VSR, 'Villa San Ricardo')

  it('never mistakes the hotel name for the San Ricardo package', () => {
    expect(ask('hola, es el hotel san ricardo?')).toBeNull()
    expect(ask('info de villa san ricardo')).toBeNull()
    expect(ask('quiero el paquete san ricardo')).toBe('Paquete San Ricardo')
  })

  it('resolves distinctive names and leaves shared ones ambiguous', () => {
    expect(ask('fotos de la junior')).toBe('Junior Suite Familiar')
    expect(ask('el shiatsu cuanto dura?')).toBe('Masaje Shiatsu')
    expect(ask('quiero bicicleta')).toBe('Alquiler de bicicleta (30 min)')
    expect(ask('la suite clasica')).toBeNull() // two Clásica suites
    expect(ask('las cuatrimotos')).toBeNull()
    expect(ask('tienen spa?')).toBeNull()
  })
})

describe('isPhotoPromise', () => {
  it('accepts an outright promise', () => {
    expect(isPhotoPromise('Con gusto, le comparto la foto de la Suite Premium.')).toBe(true)
    expect(isPhotoPromise('Aquí tiene la imagen de la suite')).toBe(true)
  })

  it('rejects conditional offers and questions', () => {
    expect(isPhotoPromise('¿Se refiere a la Suite Master Deluxe? Si me confirma, le envío la foto de esa habitación.')).toBe(false)
    expect(isPhotoPromise('¿Le envío la foto?')).toBe(false)
    expect(isPhotoPromise('Si gusta, le comparto la foto.')).toBe(false)
    expect(isPhotoPromise('Cuando me confirme la habitación, le envío la foto.')).toBe(false)
    expect(isPhotoPromise('Tenemos tres suites disponibles.')).toBe(false)
  })
})

describe('categorySlugsMentioned', () => {
  it('lists every category a message names', () => {
    expect(categorySlugsMentioned('las habitaciones cuanto cuestan?')).toEqual(['habitaciones'])
    expect(categorySlugsMentioned('¿qué tienen de spa?')).toEqual(['spa'])
    expect(categorySlugsMentioned('quiero una habitación y un masaje')).toEqual(['habitaciones', 'spa'])
    expect(categorySlugsMentioned('hola')).toEqual([])
  })
})

describe('isLocationQuestion', () => {
  it('detects location asks, typos and English included', () => {
    expect(isLocationQuestion('donde kedan, aseptan perritos')).toBe(true)
    expect(isLocationQuestion('¿Cuál es la ubicación?')).toBe(true)
    expect(isLocationQuestion('como llego desde la capital')).toBe(true)
    expect(isLocationQuestion('Where are you located?')).toBe(true)
  })
  it('ignores unrelated questions', () => {
    expect(isLocationQuestion('¿cuánto cuesta la suite premium?')).toBe(false)
    expect(isLocationQuestion(null)).toBe(false)
  })
})

describe('mapsLinkIn', () => {
  it('returns the first maps link, without trailing punctuation', () => {
    expect(mapsLinkIn('Mapa: https://maps.app.goo.gl/GWeJEpN8SaPGXqNU7.\nWeb: https://x.com')).toBe(
      'https://maps.app.goo.gl/GWeJEpN8SaPGXqNU7',
    )
    expect(mapsLinkIn('sin enlace')).toBeNull()
  })
})

describe('isMedicalCaution', () => {
  it('flags health questions and medical-caution replies', () => {
    expect(isMedicalCaution('¿La reflexología es segura con 6 meses de embarazo?')).toBe(true)
    expect(isMedicalCaution('info del masaje', 'Le recomiendo consultarlo con su médico.')).toBe(true)
    expect(isMedicalCaution('Soy alérgica a los aceites')).toBe(true)
  })
  it('leaves ordinary questions alone', () => {
    expect(isMedicalCaution('¿cuánto cuesta el masaje relajante?', 'Cuesta Q300 por persona.')).toBe(false)
  })
})

describe('isPaymentRequest', () => {
  it('detects payment and deposit asks', () => {
    expect(isPaymentRequest('Me pasa el número de cuenta para el anticipo?')).toBe(true)
    expect(isPaymentRequest('¿cómo puedo pagar?')).toBe(true)
    expect(isPaymentRequest('Aceptan transferencia?')).toBe(true)
    expect(isPaymentRequest('How do I pay the deposit?')).toBe(true)
  })
  it('ignores price questions', () => {
    expect(isPaymentRequest('¿cuánto cuesta la suite premium?')).toBe(false)
    expect(isPaymentRequest('¿de cuánto es el anticipo?')).toBe(false)
  })
})

describe('guestAskedForPhotos', () => {
  it('detects requests to see an item', () => {
    for (const m of ['¿Tiene fotos de la Suite Premium?', 'mándeme imágenes', '¿Cómo es la habitación?', 'quiero verla', 'can I see photos?', 'muéstreme el jacuzzi', '¿me muestra la suite?', '¿nos puede mostrar el salón?']) {
      expect(guestAskedForPhotos(m), m).toBe(true)
    }
  })
  it('a booking or price question is not a photo request', () => {
    for (const m of ['Quiero reservar 2 Suite Premium para 2 parejas del 24 al 26 de marzo', '¿Cuánto cuesta la Suite Premium?', 'somos 4 personas', 'quiero ver disponibilidad para marzo']) {
      expect(guestAskedForPhotos(m), m).toBe(false)
    }
  })
})

describe('acceptsPhotoOffer', () => {
  const OFFER = 'La Suite Premium es ideal. ¿Le gustaría que le comparta una foto de la habitación?'
  it('a short yes right after the bot offered a photo', () => {
    for (const m of ['si', 'Sí', 'si porfa', 'claro', 'dale', 'ok', 'me encantaría']) {
      expect(acceptsPhotoOffer(m, OFFER), m).toBe(true)
    }
  })
  it('not when the bot asked something else, or the guest said more than a yes', () => {
    expect(acceptsPhotoOffer('si', '¿Para qué fechas la desea?')).toBe(false)
    expect(acceptsPhotoOffer('si', 'Le comparto la foto de la suite.')).toBe(false)
    expect(acceptsPhotoOffer('si, del 21 al 23 de octubre para dos personas por favor', OFFER)).toBe(false)
    expect(acceptsPhotoOffer('no gracias', OFFER)).toBe(false)
  })
})

describe('productForPhotoRequest', () => {
  const NAMES = ['Suite Premium', 'Junior Suite Familiar', 'Suite Master Deluxe']
  it('falls back to the bot reply, then to earlier guest messages', () => {
    expect(productForPhotoRequest('y como es?', 'La Suite Premium tiene 2 camas Queen.', [], NAMES)).toBe('Suite Premium')
    expect(productForPhotoRequest('y como es?', 'Tenemos Suite Premium y Junior Suite Familiar.', ['cuanto sale la deluxe'], NAMES)).toBe('Suite Master Deluxe')
    expect(productForPhotoRequest('fotos de la junior', 'La Suite Premium…', [], NAMES)).toBe('Junior Suite Familiar')
    expect(productForPhotoRequest('y como es?', '¿Qué fechas?', ['hola'], NAMES)).toBeNull()
  })
})

describe('photoOnlyReplyText', () => {
  it('uses the right article', () => {
    expect(photoOnlyReplyText('Suite Premium')).toBe('¡Con mucho gusto! Aquí puede ver la Suite Premium. 😊')
    expect(photoOnlyReplyText('Paquete Romántico')).toBe('¡Con mucho gusto! Aquí puede ver el Paquete Romántico. 😊')
    expect(photoOnlyReplyText('Junior Suite Familiar')).toBe('¡Con mucho gusto! Aquí puede ver Junior Suite Familiar. 😊')
  })
})

describe('isExplicitHumanRequest', () => {
  it('detects a plain ask for a person', () => {
    for (const m of ['quiero hablar con una persona por favor', 'me puede comunicar con un asesor?', 'páseme con recepción', 'necesito hablar con alguien', 'can I talk to a human?', 'quiero hablar con el gerente']) {
      expect(isExplicitHumanRequest(m), m).toBe(true)
    }
  })
  it('ignores negations and unrelated messages', () => {
    for (const m of ['no quiero hablar con nadie, solo info', 'no gracias', '¿hablan inglés?', 'quiero la suite premium']) {
      expect(isExplicitHumanRequest(m), m).toBe(false)
    }
  })
})

describe('isPolicyQuestion', () => {
  it('flags policy questions, not browsing', () => {
    expect(isPolicyQuestion('si me quedo 4 noches me hacen descuento?')).toBe(true)
    expect(isPolicyQuestion('puedo llevar a mi perrito?')).toBe(true)
    expect(isPolicyQuestion('qué habitaciones tienen?')).toBe(false)
  })
})

describe('stripTrailingPhotoOffer', () => {
  it('removes only a trailing photo offer', () => {
    expect(stripTrailingPhotoOffer('Es muy cómoda. ¿Le gustaría que le comparta una foto de esta habitación?')).toBe('Es muy cómoda.')
    expect(stripTrailingPhotoOffer('Es muy cómoda. ¿Para qué fechas la desea?')).toBe('Es muy cómoda. ¿Para qué fechas la desea?')
    expect(stripTrailingPhotoOffer('¿Le envío una foto?')).toBeNull()
  })
  it('removes a conditional photo offer anywhere, keeping the rest (live test 2026-09-25, gpt-5.4)', () => {
    expect(
      stripTrailingPhotoOffer(
        'Es una opción muy agradable si buscan amplitud y descanso.\n\nSi gusta, puedo compartirle una foto; y si me indica sus fechas, también le oriento con la tarifa.',
      ),
    ).toBe('Es una opción muy agradable si buscan amplitud y descanso.')
    const plain = 'Tiene 2 camas Queen. Le comparto que el desayuno está incluido.'
    expect(stripTrailingPhotoOffer(plain)).toBe(plain)
  })
})

describe('replyNamesProduct', () => {
  it('matches a one-word name only as a proper noun', () => {
    expect(replyNamesProduct('Tenemos: Romántico, San Vicente y Luna de Miel.', 'Romántico')).toBe(true)
    expect(replyNamesProduct('Si quieren algo más especial y romántico, la Master.', 'Romántico')).toBe(false)
    expect(replyNamesProduct('un ambiente relajante', 'Relajante')).toBe(false)
  })
  it('matches a multi-word name case-insensitively', () => {
    expect(replyNamesProduct('le recomiendo la suite master deluxe', 'Suite Master Deluxe')).toBe(true)
  })
})

describe('isArrivalTimeQuestion', () => {
  it('spots arrival / check-in timing questions', () => {
    expect(isArrivalTimeQuestion('si llego como a las 11:30 de la noche hay problema? y puedo entrar a la habitacion a las 10?')).toBe(true)
    expect(isArrivalTimeQuestion('a qué hora es el check in?')).toBe(true)
    expect(isArrivalTimeQuestion('las habitaciones cuanto cuestan?')).toBe(false)
  })
})

describe('isExistingBookingTalk (no promo banner) — VSR 2026-10-07', () => {
  it('talk about a booking, payment or quote the guest already has', () => {
    for (const t of [
      'La habitación está para los recién casados Sirin Gudiel\nEste sería el primer pago',
      'Una cónsulta el número que usted necesita es para coordinar la actividad de la próxima semana?',
      'había estado conversando con alguien anteriormente que me pidió el nombre de mi novio relacionado a una cotización para un evento',
      'Confirmado  mi habitación  de hoy?',
      'Esque como ayer no pudimos ir y habíamos echo una reservación',
    ]) expect(isExistingBookingTalk(t), t).toBe(true)
  })
  it('a guest browsing still gets the banner', () => {
    for (const t of ['Hola,tiene espacio  para 2 personas la noche del sábado', 'habitacion', 'Quiero una habitación para 2 personas del 20 al 23 de octubre, ¿cuánto sale?'])
      expect(isExistingBookingTalk(t), t).toBe(false)
  })
})

describe('isNewQuoteAsk (banner again in a thread in progress) — VSR 2026-10-08', () => {
  it('reads a request for another option, price or dates as a new quote', () => {
    for (const t of [
      'Gracias mire y una opción que sea con hospedaje el domingo aunque no me quede?',
      '¿Cuánto cuesta la suite?',
      'Quisiera reservar otra habitación para diciembre',
      '¿Qué tienen para parejas?',
    ]) expect(isNewQuoteAsk(t), t).toBe(true)
  })
  it('reads follow-ups on something already arranged as not new', () => {
    for (const t of [
      'Lo podemos dejar domingo para las 8 de la mañana',
      'Esque si necesitamos las 10 habitaciones ☹️',
      'Disculpe me indicaron que hay solicitud de dos masajes, yo soy la masajista',
      'Si gracias',
    ]) expect(isNewQuoteAsk(t), t).toBe(false)
  })
})

describe('room photos inside a package', () => {
  it('selects the included room even when the package is also named', () => {
    expect(productForPhotoRequest('¿Podrían enviarme fotografías de la habitación?', 'El Paquete Romántico incluye habitación Master Suite Deluxe.', ['El paquete romántico'], HOTEL)).toBe('Suite Master Deluxe')
  })
  it('does not substitute a package flyer when no room is known', () => {
    expect(productForPhotoRequest('Fotos de la habitación por favor', 'El Paquete Romántico cuesta Q1100.', ['El paquete romántico'], HOTEL)).toBeNull()
  })
  it('still sends the package image when that is requested', () => {
    expect(productForPhotoRequest('Fotos del paquete romántico', 'Incluye Suite Master Deluxe.', [], HOTEL)).toBe('Paquete Romántico')
  })
})
