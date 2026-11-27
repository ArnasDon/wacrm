-- Seed 045: Popula public.menu_items com os 26 itens e precos oficiais
-- Fonte versionada: .hermes/skills/delivery-core.md e assets/js/cardapio.json
-- Idempotente: insere apenas itens que ainda nao existem (por account_id + lower(name)).
BEGIN;

INSERT INTO public.menu_items (
  account_id,
  name,
  price,
  category,
  is_available,
  description,
  image_url
)
SELECT
  a.id,
  v.name,
  v.price,
  v.category,
  true,
  v.description,
  v.image_url
FROM public.accounts a
CROSS JOIN (
  VALUES
    (
      'Empanada Romeu e Julieta',
      14.50::numeric(10,2),
      'Empanadas Doces',
      'Massa recheada com goiabada cascão e muçarela.',
      NULL::text
    ),
    (
      'Empanada de Queijo, Tomate, Manjericão e Orégano',
      14.00::numeric(10,2),
      'Empanadas Salgadas',
      'Leveza do estilo caprese com queijo, tomates frescos picados e manjericão aromático.',
      NULL::text
    ),
    (
      'Empanada de Queijo com Cebola Caramelizada',
      14.00::numeric(10,2),
      'Empanadas Salgadas',
      'Contraste agridoce do queijo derretido com cebolas lentamente douradas.',
      NULL::text
    ),
    (
      'Empanada de Palmito',
      14.00::numeric(10,2),
      'Empanadas Salgadas',
      'Recheio cremoso com pedaços macios de palmito pupunha.',
      NULL::text
    ),
    (
      'Empanada de Carne com Ovos',
      14.00::numeric(10,2),
      'Empanadas Salgadas',
      'Tradicional recheio de carne bovina moída com ovos cozidos picados.',
      NULL::text
    ),
    (
      'Empanada de Frango com Espinafre e Cheddar',
      14.00::numeric(10,2),
      'Empanadas Salgadas',
      'Combinação suave de peito de frango, folhas frescas de espinafre e cheddar.',
      NULL::text
    ),
    (
      'Empanada de Espinafre com Ricota e Tomate Seco',
      14.00::numeric(10,2),
      'Empanadas Salgadas',
      'Recheio vegetariano leve de espinafre fresco, ricota macia e tomate seco.',
      NULL::text
    ),
    (
      'Empanada de Escarola com Queijo',
      14.00::numeric(10,2),
      'Empanadas Salgadas',
      'Escarola refogada no alho e azeite com uma generosa camada de queijo.',
      NULL::text
    ),
    (
      'Empanada Bacon Cheeseburger',
      14.00::numeric(10,2),
      'Empanadas Salgadas',
      'Hambúrguer bovino, queijo derretido e pedaços crocantes de bacon frito.',
      NULL::text
    ),
    (
      'Empanada de Calabresa com Cream Cheese',
      14.00::numeric(10,2),
      'Empanadas Salgadas',
      'Calabresa moída de alta qualidade unida à cremosidade do cream cheese.',
      NULL::text
    ),
    (
      'Empanada de Chocolate ao Leite com Morango',
      16.90::numeric(10,2),
      'Empanadas Doces',
      'Saborosa combinação de chocolate ao leite cremoso com pedaços de morango.',
      NULL::text
    ),
    (
      'Empanada de Atum com Queijo',
      14.00::numeric(10,2),
      'Empanadas Salgadas',
      'Atum sólido conservado mesclado com queijo muçarela derretido.',
      NULL::text
    ),
    (
      'Combo Coca-Cola',
      62.90::numeric(10,2),
      'Combos',
      'Contém 4 Empanadas à sua escolha + 1 Refrigerante Coca-Cola de 600ml.',
      NULL::text
    ),
    (
      'Combo Família (8 Empanadas Assadas)',
      102.00::numeric(10,2),
      'Combos',
      '8 empanadas assadas à sua escolha para dividir com quem você gosta.',
      NULL::text
    ),
    (
      'Combo 4 Empanadas',
      52.90::numeric(10,2),
      'Combos',
      'Leve 4 empanadas assadas de qualquer sabor com preço promocional.',
      NULL::text
    ),
    (
      'Combo 4 Empanadas + Tortinha de Ovomaltine',
      69.00::numeric(10,2),
      'Combos',
      'Leve 4 empanadas assadas de qualquer sabor com preço promocional + Tortinha de Ovomaltine.',
      NULL::text
    ),
    (
      'Combo 4 Empanadas + Cheesecake de Frutas Vermelhas',
      69.00::numeric(10,2),
      'Combos',
      'Leve 4 empanadas assadas de qualquer sabor com preço promocional + Cheesecake de Frutas Vermelhas.',
      NULL::text
    ),
    (
      'Coca-Cola Original 350ml',
      8.50::numeric(10,2),
      'Bebidas',
      'Lata de 350ml de Coca-Cola sabor original gelada.',
      NULL::text
    ),
    (
      'Coca-Cola sem Açúcar 350ml',
      8.50::numeric(10,2),
      'Bebidas',
      'Lata de 350ml de Coca-Cola sabor zero açúcar gelada.',
      NULL::text
    ),
    (
      'Coca-Cola Original 600ml',
      15.00::numeric(10,2),
      'Bebidas',
      'Garrafa de 600ml ideal para acompanhar sua empanada.',
      'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500&auto=format&fit=crop&q=60'
    ),
    (
      'Coca-Cola Zero 600ml',
      15.00::numeric(10,2),
      'Bebidas',
      'Garrafa de 600ml de Coca-Cola sabor zero açúcar.',
      'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500&auto=format&fit=crop&q=60'
    ),
    (
      'Coca-Cola 2L',
      25.00::numeric(10,2),
      'Bebidas',
      'Tamanho família. Garrafa de 2 litros.',
      'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500&auto=format&fit=crop&q=60'
    ),
    (
      'Coca-Cola zero 2L',
      25.00::numeric(10,2),
      'Bebidas',
      'Tamanho família. Garrafa de 2 litros.',
      NULL::text
    ),
    (
      'Vinho La Plata Branco Argentino 750ml',
      55.90::numeric(10,2),
      'Vinhos',
      'Vinho argentino branco jovem e refrescante, ideal para empanadas vegetarianas.',
      'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=500&auto=format&fit=crop&q=60'
    ),
    (
      'Vinho Tinto Argentino San Telmo Malbec 750ml',
      79.90::numeric(10,2),
      'Vinhos',
      'Clássico Malbec de Mendoza de aroma frutado, perfeito com empanada de carne ou costela.',
      'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=500&auto=format&fit=crop&q=60'
    ),
    (
      'Vinho Tinto Seco Argentino Cavic 750ml',
      40.00::numeric(10,2),
      'Vinhos',
      'Vinho de mesa tinto seco argentino, fácil de beber no dia a dia.',
      'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=500&auto=format&fit=crop&q=60'
    )
) AS v(name, price, category, description, image_url)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.menu_items m
  WHERE m.account_id = a.id
    AND lower(m.name) = lower(v.name)
);

COMMIT;
