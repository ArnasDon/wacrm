import { describe, it, expect } from 'vitest';
import {
  hasOrderIntent,
  parseTextOrder,
  extractAddressFromText,
  extractDeliveryKindFromText,
  isAddressConfirmation,
} from './text-order-parser';

describe('text-order-parser', () => {
  describe('hasOrderIntent', () => {
    it('detects simple order items', () => {
      expect(hasOrderIntent('2 carne, 2 calabresa, 1 coca zero lata')).toBe(
        true
      );
      expect(hasOrderIntent('quero 2 de carne e 1 de queijo')).toBe(true);
      expect(hasOrderIntent('manda 4 carne')).toBe(true);
      expect(hasOrderIntent('boa noite quero 1 calabresa e 1 coca zero')).toBe(
        true
      );
      expect(hasOrderIntent('oi, me ve 3 empanadas de carne')).toBe(true);
      expect(hasOrderIntent('2 carne 2 queijo')).toBe(true);
      expect(hasOrderIntent('boa noite! duas de carne e uma coca')).toBe(true);
    });

    it('does not trigger on generic FAQs without items', () => {
      expect(hasOrderIntent('qual o cardápio?')).toBe(false);
      expect(hasOrderIntent('menu por favor')).toBe(false);
      expect(hasOrderIntent('estão atendendo?')).toBe(false);
      expect(hasOrderIntent('qual o horário?')).toBe(false);
      expect(hasOrderIntent('olá boa tarde')).toBe(false);
      expect(hasOrderIntent('qual a chave pix?')).toBe(false);
      expect(hasOrderIntent('como pago?')).toBe(false);
    });
  });

  describe('parseTextOrder', () => {
    it('parses typical customer order: "2 carne, 2 calabresa, 1 coca zero lata"', () => {
      const result = parseTextOrder('2 carne, 2 calabresa, 1 coca zero lata');
      expect(result.hasItems).toBe(true);
      expect(result.items.length).toBe(3);

      const carne = result.items.find((i) => i.id === 'emp_hamburguer');
      expect(carne).toBeDefined();
      expect(carne?.quantity).toBe(2);
      expect(carne?.unitPrice).toBe(14.0);

      const calabresa = result.items.find((i) => i.id === 'empcalabresa');
      expect(calabresa).toBeDefined();
      expect(calabresa?.quantity).toBe(2);
      expect(calabresa?.unitPrice).toBe(14.0);

      const cocaZero = result.items.find((i) => i.id === 'beb_coca_zero_350');
      expect(cocaZero).toBeDefined();
      expect(cocaZero?.quantity).toBe(1);
      expect(cocaZero?.unitPrice).toBe(8.5);

      // Total: 2*14 + 2*14 + 1*8.5 = 28 + 28 + 8.5 = 64.50
      expect(result.total).toBe(64.5);
      expect(result.totalFormatted).toBe('R$ 64,50');
    });

    it('parses "2 carne 2 queijo"', () => {
      const result = parseTextOrder('2 carne 2 queijo');
      expect(result.hasItems).toBe(true);
      expect(result.items.length).toBe(2);

      const carne = result.items.find((i) => i.id === 'emp_hamburguer');
      expect(carne?.quantity).toBe(2);

      const queijo = result.items.find((i) => i.id === 'emp_queijo_tomate');
      expect(queijo?.quantity).toBe(2);

      expect(result.total).toBe(56.0);
    });

    it('parses "boa noite quero 1 calabresa e 1 coca zero"', () => {
      const result = parseTextOrder(
        'boa noite quero 1 calabresa e 1 coca zero'
      );
      expect(result.hasItems).toBe(true);
      expect(result.items.length).toBe(2);

      const calabresa = result.items.find((i) => i.id === 'empcalabresa');
      expect(calabresa?.quantity).toBe(1);

      const cocaZero = result.items.find((i) => i.id === 'beb_coca_zero_350');
      expect(cocaZero?.quantity).toBe(1);

      expect(result.total).toBe(22.5);
    });

    it('parses numbers in words: "quero duas de carne e uma de queijo"', () => {
      const result = parseTextOrder('quero duas de carne e uma de queijo');
      expect(result.hasItems).toBe(true);
      const carne = result.items.find((i) => i.id === 'emp_hamburguer');
      expect(carne?.quantity).toBe(2);

      const queijo = result.items.find((i) => i.id === 'emp_queijo_tomate');
      expect(queijo?.quantity).toBe(1);

      // Total: 2*14 + 1*14 = 28 + 14 = 42.00
      expect(result.total).toBe(42.0);
    });

    it('parses combo and beverage correctly: "1 combo 4 empanadas e 1 coca 2l"', () => {
      const result = parseTextOrder('1 combo 4 empanadas e 1 coca 2l');
      expect(result.hasItems).toBe(true);

      const combo = result.items.find((i) => i.id === 'combo_quatro');
      expect(combo).toBeDefined();
      expect(combo?.quantity).toBe(1);
      expect(combo?.unitPrice).toBe(52.9);

      const coca2l = result.items.find((i) => i.id === 'beb_coca_2l');
      expect(coca2l).toBeDefined();
      expect(coca2l?.quantity).toBe(1);
      expect(coca2l?.unitPrice).toBe(25.0);

      expect(result.total).toBe(77.9);
    });

    it('parses items and extracts address from the same message', () => {
      const text =
        '2 carne e 1 coca zero lata, entregar na Rua das Palmeiras, 150 - Centro';
      const result = parseTextOrder(text);
      expect(result.hasItems).toBe(true);
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(36.5);
      expect(result.deliveryAddress).toBeDefined();
      expect(result.deliveryAddress).toContain('Rua das Palmeiras');
    });
  });

  describe('extractAddressFromText', () => {
    it('extracts address from text containing street and number', () => {
      expect(extractAddressFromText('Rua das Palmeiras, 150, Centro')).toBe(
        'Rua das Palmeiras, 150, Centro'
      );
      expect(
        extractAddressFromText('entregar na Rua Augusta, 500 apto 21')
      ).toContain('Rua Augusta');
      expect(extractAddressFromText('Av Paulista, 1000')).toBe(
        'Av Paulista, 1000'
      );
    });

    it('returns null when no address is present', () => {
      expect(extractAddressFromText('2 carne e 1 coca')).toBeNull();
      expect(extractAddressFromText('boa noite')).toBeNull();
      expect(extractAddressFromText('sim')).toBeNull();
    });
  });

  describe('isAddressConfirmation', () => {
    it('recognizes confirmation phrases', () => {
      expect(isAddressConfirmation('sim')).toBe(true);
      expect(isAddressConfirmation('pode ser')).toBe(true);
      expect(isAddressConfirmation('no mesmo')).toBe(true);
      expect(isAddressConfirmation('nesse mesmo endereço')).toBe(true);
      expect(isAddressConfirmation('confirmo')).toBe(true);
    });

    it('does not recognize non-confirmations', () => {
      expect(isAddressConfirmation('Rua das Flores, 123')).toBe(false);
      expect(isAddressConfirmation('quero mudar')).toBe(false);
      expect(isAddressConfirmation('não')).toBe(false);
    });
  });

  describe('extractDeliveryKindFromText & inline parsing', () => {
    it('extracts delivery and pickup preferences accurately', () => {
      expect(extractDeliveryKindFromText('retirada')).toBe('retirada');
      expect(extractDeliveryKindFromText('Vou retirar na loja')).toBe('retirada');
      expect(extractDeliveryKindFromText('para retirada')).toBe('retirada');
      expect(extractDeliveryKindFromText('entrega')).toBe('delivery');
      expect(extractDeliveryKindFromText('Delivery')).toBe('delivery');
      expect(extractDeliveryKindFromText('quero entrega')).toBe('delivery');
    });

    it('returns null for questions, negations, ambiguous choices, or incomplete street phrases', () => {
      expect(extractDeliveryKindFromText('qual o valor da entrega?')).toBeNull();
      expect(extractDeliveryKindFromText('onde fica a retirada?')).toBeNull();
      expect(extractDeliveryKindFromText('não quero retirada')).toBeNull();
      expect(extractDeliveryKindFromText('entrega ou retirada')).toBeNull();
      expect(extractDeliveryKindFromText('Entregar na Rua Flores')).toBeNull();
    });

    it('strips bounded inline deliveryKind clause without polluting item notes', () => {
      const pickup = parseTextOrder('2 carne, para retirada');
      expect(pickup.hasItems).toBe(true);
      expect(pickup.items[0].quantity).toBe(2);
      expect(pickup.items[0].notes).toBeUndefined();
      expect(pickup.deliveryKind).toBe('retirada');
      expect(pickup.unresolved).toEqual([]);

      const inlineNoComma = parseTextOrder('2 carne para retirada');
      expect(inlineNoComma.items[0].notes).toBeUndefined();
      expect(inlineNoComma.deliveryKind).toBe('retirada');
      expect(inlineNoComma.unresolved).toEqual([]);

      const negated = parseTextOrder('2 carne sem entrega');
      expect(negated.deliveryKind).toBeUndefined();
      expect(negated.requiresKitchenReview).toBe(true);
    });
  });
});
