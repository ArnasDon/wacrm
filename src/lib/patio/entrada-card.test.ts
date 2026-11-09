// Testes do site (scripts/lib/entrada-card.test.js) rodando no vitest.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ehCard, lerCard, dinheiro, categoria } from './entrada-card';

const HILUX = `*MARCA:* TOYOTA
*MODELO:* HILUX
*PLACA* : RCO-1A97
*VERSÃO:* SRV
*ANO:* 2021/2021
*COMBUSTÍVEL:* flex
*CÂMBIO:* automático
*KM:* 150.000
*IPVA:* 2026 ✅
*CHAVE RESERVA E MANUAL* ✅
*LAUDO:* Á Realizar
*REVISÕES :* em dias
*Pneus* bom estado
*OBS:*
*TABELA FIPE:* R$186.044,00
💰*CUSTO:* R$160.000,00
*CAPTAÇÃO*: Loja

Ibox Veículos Premium  - *Av. Getúlio Vargas n3636* 🔻`;

const JAGUAR = `*MARCA:* JAGUAR
*MODELO:* E-PACE
*PLACA* : QLC-9G30
*VERSÃO:* P250F
*ANO:* 2019/2020
*COMBUSTÍVEL:* flex
*CÂMBIO:* automático
*KM:* 73.000
*IPVA:* 2026 ✅
*CHAVE RESERVA E MANUAL* não tem
*LAUDO:* Á Realizar
*REVISÕES :* em dias
*OBS:* precisa de 3 pneus e uma estética nos bancos ‼️
*TABELA FIPE:* R$163.144,00
💰*CUSTO:* R$140.000,00
*CAPTAÇÃO*: Abel

Ibox Veículos Premium  - *Av. Getúlio Vargas n3636* 🔻`;

test('reconhece o card de entrada', () => {
  assert.equal(ehCard(HILUX), true);
  assert.equal(ehCard('bom dia pessoal'), false);
});

test('lê o card da Hilux', () => {
  const { veiculo, interno, faltando } = lerCard(HILUX);
  assert.equal(veiculo.brand, 'Toyota');
  assert.equal(veiculo.model, 'Hilux');
  assert.equal(veiculo.versao, 'SRV');
  assert.equal(veiculo.year, '2021/2021');
  assert.equal(veiculo.mileage, '150.000 km');
  assert.equal(veiculo.plate, 'RCO-1A97');
  assert.equal(veiculo.combustivel, 'Flex');
  assert.equal(veiculo.cambio, 'Automático');
  assert.equal(veiculo.ipva, '2026');
  assert.equal(veiculo.chave_manual, true);
  assert.equal(veiculo.revisoes, 'Em dias');
  assert.equal(veiculo.cat, 'carros');
  assert.equal(veiculo.sale_price, 0);
  assert.equal(interno.purchase_price, 160000);
  assert.equal(interno.fipe_value, 186044);
  assert.equal(interno.laudo, 'A realizar');
  assert.equal(interno.pneus, 'bom estado');
  assert.equal(interno.captacao, 'Loja');
  assert.deepEqual(faltando, ['preço de venda']);
  assert.match(veiculo.description, /^Força, robustez e versatilidade/);
  assert.match(veiculo.description, /Toyota Hilux SRV 2021\/2021, com câmbio automático e motor flex, 150\.000 km rodados\./);
  assert.match(veiculo.description, /Destaques do veículo\n\n• Revisões em dia\n• IPVA 2026 pago\n• Chave reserva e manual/);
});

test('custo e FIPE nunca vão para os campos públicos', () => {
  const { veiculo } = lerCard(HILUX);
  const pub = JSON.stringify(veiculo);
  assert.doesNotMatch(pub, /160000|160\.000|186044|186\.044/);
});

test('lê o card do Jaguar (sem chave reserva, com OBS)', () => {
  const { veiculo, interno } = lerCard(JAGUAR);
  assert.equal(veiculo.brand, 'Jaguar');
  assert.equal(veiculo.model, 'E-Pace');
  assert.equal(veiculo.versao, 'P250F');
  assert.equal(veiculo.year, '2019/2020');
  assert.equal(veiculo.mileage, '73.000 km');
  assert.equal(veiculo.chave_manual, false);
  assert.equal(interno.obs, 'precisa de 3 pneus e uma estética nos bancos');
  assert.equal(interno.captacao, 'Abel');
  assert.equal(interno.purchase_price, 140000);
});

test('valores e categorias', () => {
  assert.equal(dinheiro('R$ 89.900,00'), 89900);
  assert.equal(dinheiro(''), 0);
  assert.equal(categoria('Sea-Doo', 'GTX 230'), 'nautico');
  assert.equal(categoria('Honda', 'CB 500X'), 'motos');
  assert.equal(categoria('Toyota', 'Hilux'), 'carros');
});

const SW4 = '*MARCA:* TOYOTA\n*MODELO:* HILUX SW4 \n*PLACA* : RDG-6B62\n*VERSÃO:* SRX\n*ANO:* 2021/2021\n*COMBUSTÍVEL:* Diesel \n*CÂMBIO:* automático \n*KM:* 136.000 \n*IPVA:* 2026 ✅\n*CHAVE RESERVA E MANUEL:* ✅\n*LAUDO:* Á Realizar \n*REVISÕES :* todas as revisões na css\n*OBS:* \nFrente da Diamond toda original Toyota, rodas da Diamond. \n*TABELA FIPE:* R$257.735,00\n💰*CUSTO:* R$245.000 \n( RACHAR COMISSÃO COM CLÁUDIO) \n*CAPTAÇÃO*: Abel \n \nIbox Veículos Premium  - *Av. Getúlio Vargas n3636* 🔻';
const NIVUS = 'NOVO CUSTOOOOOO\n\n*MARCA:* VOLKSWAGEN\n*MODELO:* NIVUS\n*PLACA* : RDN-5D05\n*VERSÃO:* COMFORTLINE \n*ANO:* 2021/2022\n*COMBUSTÍVEL:* FLEX \n*CÂMBIO:* automático \n*KM:* 69.400 mil \n*IPVA:* entrega com IPVA pago\n*CHAVE RESERVA E MANUEL:* ✅\n*LAUDO:* Á Realizar \n*REVISÕES :* todas as revisões feitas.\n*OBS:*  Única Dona \n*TABELA FIPE:* R$ 95.603.00\n💰*CUSTO:* R$ 84.000,00\n*CAPTAÇÃO*: Apolo\n \nIbox Veículos Premium  - *Av. Getúlio Vargas n3636* 🔻';

test('SW4: "MANUEL", OBS na linha de baixo e recado depois do custo', () => {
  const { veiculo, interno } = lerCard(SW4);
  assert.equal(veiculo.model, 'Hilux SW4');
  assert.equal(veiculo.chave_manual, true);
  assert.equal(veiculo.combustivel, 'Diesel');
  assert.equal(interno.purchase_price, 245000);
  assert.equal(interno.fipe_value, 257735);
  assert.match(interno.obs, /Frente da Diamond/);
  assert.match(interno.obs, /RACHAR COMISSÃO COM CLÁUDIO/);
  assert.doesNotMatch(interno.obs, /Getúlio/);
  assert.equal(interno.captacao, 'Abel');
});

test('Nivus: FIPE com ponto nos centavos e "NOVO CUSTO" antes do card', () => {
  const { veiculo, interno } = lerCard(NIVUS);
  assert.equal(veiculo.brand, 'Volkswagen');
  assert.equal(veiculo.mileage, '69.400 km');
  assert.equal(veiculo.chave_manual, true);
  assert.equal(interno.fipe_value, 95603);
  assert.equal(interno.purchase_price, 84000);
  assert.equal(interno.obs, 'Única Dona');
});

test('dinheiro em vários formatos', () => {
  assert.equal(dinheiro('R$ 95.603.00'), 95603);
  assert.equal(dinheiro('R$245.000'), 245000);
  assert.equal(dinheiro('R$ 186.044,00'), 186044);
  assert.equal(dinheiro('120 mil'), 120);
});

test('descrição no formato da loja: sem custo, laudo ou OBS interna', () => {
  // (no site, este teste também confere a leitura pela ficha; aqui confere o texto)
  const { veiculo } = lerCard(SW4);
  assert.doesNotMatch(veiculo.description, /245|257|laudo|Diamond|CLÁUDIO/i);
  assert.match(veiculo.description, /^Robustez, espaço e presença para toda a família\./);
  assert.match(veiculo.description, /• Todas as revisões realizadas na concessionária\n• IPVA 2026 pago\n• Chave reserva e manual/);
  assert.match(lerCard(NIVUS).veiculo.description, /• Única dona/);
});
