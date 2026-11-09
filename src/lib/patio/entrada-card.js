// Cópia fiel de scripts/lib/entrada-card.js do site (mesmos testes).
// scripts/lib/entrada-card.js
// Lê o "card" que a equipe manda no grupo de WhatsApp "ENTRADA VEÍCULOS":
//
//   *MARCA:* TOYOTA
//   *MODELO:* HILUX
//   *PLACA* : RCO-1A97
//   *VERSÃO:* SRV
//   *ANO:* 2021/2021
//   *COMBUSTÍVEL:* flex
//   *CÂMBIO:* automático
//   *KM:* 150.000
//   *IPVA:* 2026 ✅
//   *CHAVE RESERVA E MANUAL* ✅
//   *LAUDO:* Á Realizar
//   *REVISÕES :* em dias
//   *Pneus* bom estado
//   *OBS:*
//   *TABELA FIPE:* R$186.044,00
//   💰*CUSTO:* R$160.000,00
//   *CAPTAÇÃO*: Loja
//
// O modelo é sempre o mesmo, então a leitura é por rótulo — sem IA, sem custo.
// Campo que não vier fica vazio e a equipe completa no painel na revisão.

const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const limpa = s => String(s || '')
  .replace(/[*_~]/g, '')
  .replace(/[✅✔☑‼❗❕️\u{1F53B}\u{1F4B0}]/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

// rótulo normalizado -> chave
const ROTULOS = [
  [/^MARCA$/, 'marca'],
  [/^MODELO$/, 'modelo'],
  [/^PLACA$/, 'placa'],
  [/^VERSAO$/, 'versao'],
  [/^ANO( MODELO)?$/, 'ano'],
  [/^COMBUSTIVEL$/, 'combustivel'],
  [/^CAMBIO$/, 'cambio'],
  [/^(KM|QUILOMETRAGEM|KILOMETRAGEM)$/, 'km'],
  [/^IPVA$/, 'ipva'],
  [/^CHAVE/, 'chave'], // inclui "CHAVE RESERVA E MANUEL" (erro comum de digitação)
  [/^LAUDO$/, 'laudo'],
  [/^REVIS(OES|AO)$/, 'revisoes'],
  [/^PNEUS?$/, 'pneus'],
  [/^(OBS|OBSERVACOES?)$/, 'obs'],
  [/^(TABELA )?FIPE$/, 'fipe'],
  [/^CUSTO$/, 'custo'],
  [/^(VALOR|PRECO)( DE VENDA)?$/, 'preco'],
  [/^COR$/, 'cor'],
  [/^CAPTACAO$/, 'captacao'],
];

function ehCard(texto) {
  const t = semAcento(texto).toUpperCase();
  return /MARCA/.test(t) && /MODELO/.test(t);
}

// "R$186.044,00" -> 186044 · "R$ 95.603.00" -> 95603 · "R$245.000" -> 245000
function dinheiro(s) {
  const m = String(s || '').match(/\d[\d.,\s]*/);
  if (!m) return 0;
  let t = m[0].replace(/\s/g, '').replace(/[.,]$/, '');
  // Último separador seguido de 1-2 dígitos no fim = centavos (vírgula OU ponto).
  t = t.replace(/[.,](\d{1,2})$/, '#$1');
  t = t.replace(/[.,]/g, '').replace('#', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

const titulo = s => String(s || '').toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

function marcaBonita(s) {
  const t = limpa(s);
  const especiais = { BMW: 'BMW', GWM: 'GWM', BYD: 'BYD', JAC: 'JAC', RAM: 'RAM', KTM: 'KTM', CAOA: 'Caoa', 'MERCEDES-BENZ': 'Mercedes-Benz', 'MERCEDES BENZ': 'Mercedes-Benz', 'SEA-DOO': 'Sea-Doo', 'SEA DOO': 'Sea-Doo', 'LAND ROVER': 'Land Rover', VW: 'Volkswagen', 'CAN-AM': 'Can-Am' };
  return especiais[t.toUpperCase()] || titulo(t);
}

// Modelo: mantém siglas curtas (SW4, X1, E-PACE fica "E-Pace").
function modeloBonito(s) {
  return limpa(s).split(' ').map(p => (/\d/.test(p) || p.length <= 3) ? p.toUpperCase() : titulo(p)).join(' ');
}

function combustivel(s) {
  const t = semAcento(s).toLowerCase();
  if (/flex/.test(t)) return 'Flex';
  if (/diesel/.test(t)) return 'Diesel';
  if (/hibrid/.test(t)) return 'Híbrido';
  if (/eletric/.test(t)) return 'Elétrico';
  if (/gnv/.test(t)) return 'GNV';
  if (/gasolina/.test(t)) return 'Gasolina';
  return '';
}

function cambio(s) {
  const t = semAcento(s).toLowerCase();
  if (/cvt|automatizad/.test(t)) return 'Automatizado/CVT';
  if (/auto/.test(t)) return 'Automático';
  if (/manual|mecan/.test(t)) return 'Manual';
  return '';
}

function laudo(s) {
  const t = semAcento(s).toLowerCase();
  if (/aprovad/.test(t)) return 'Aprovado';
  if (/realizar|fazer|pendente/.test(t)) return 'A realizar';
  if (/realizad|feito/.test(t)) return 'Realizado';
  return '';
}

// ✅ / "sim" / "tem" = true; "não tem" / ❌ = false
function simNao(bruto) {
  const t = semAcento(bruto).toLowerCase();
  if (/\bnao\b|❌|sem /.test(t)) return false;
  return /✅|✔|sim|\btem\b|ok/.test(bruto + ' ' + t);
}

function km(s) {
  const n = String(s || '').replace(/[^\d]/g, '');
  if (!n) return '';
  return Number(n).toLocaleString('pt-BR') + ' km';
}

function categoria(marca, modelo) {
  const t = semAcento(`${marca} ${modelo}`).toLowerCase();
  if (/sea-?doo|jet ?ski|waverunner|lancha|barco|\bmar\b|fishing|focker|schaefer|nx boats/.test(t)) return 'nautico';
  if (/\butv\b|quadriciclo|maverick|rzr|polaris|can-?am|ranger xp|commander/.test(t)) return 'utv';
  if (/harley|ducati|triumph|ktm|royal enfield|kawasaki|\bcb ?\d|\bxre|\bcg ?\d|biz|pop 1|nmax|xmax|pcx|mt-?\d|r1\b|r3\b|f ?\d{3,4} ?gs|\bgs ?\d|tiger|africa twin|lander|tenere|fazer|crosser|bros|hornet|scrambler/.test(t)) return 'motos';
  return 'carros';
}

function lerCard(texto) {
  const campos = {};
  let ultimo = null;
  for (const linhaBruta of String(texto || '').split(/\r?\n/)) {
    if (!linhaBruta.trim()) continue;
    if (/ibox ve[ií]culos premium|getúlio vargas|getulio vargas/i.test(linhaBruta)) { ultimo = null; continue; }
    const linha = linhaBruta.replace(/^[^\p{L}*(]+/u, ''); // tira 💰 etc. do começo
    // Rótulo = texto até ":" ou até o fim do negrito "*...*"
    let rotulo, valor;
    const m = linha.match(/^\*?([^:*()]+?)\*?\s*:\s*\*?\s*(.*)$/);
    const n = linha.match(/^\*([^*]+)\*\s*(.*)$/);
    if (m) { rotulo = m[1]; valor = m[2]; }
    else if (n) { rotulo = n[1]; valor = n[2]; }
    const chaveRot = rotulo ? semAcento(limpa(rotulo)).toUpperCase().replace(/:$/, '').trim() : '';
    const achado = chaveRot && ROTULOS.find(([re]) => re.test(chaveRot));
    if (!achado) {
      // Linha solta logo abaixo de um campo (ex.: OBS escrita na linha de
      // baixo, recado depois do CUSTO) -> vira observação interna.
      if (ultimo) (campos._extra = campos._extra || []).push(limpa(linhaBruta));
      continue;
    }
    const k = achado[1];
    ultimo = k;
    if (campos[k] !== undefined) continue;
    campos[k] = { bruto: linhaBruta, valor: limpa(valor) };
  }
  const v = k => (campos[k] ? campos[k].valor : '');

  const marca = marcaBonita(v('marca'));
  const modelo = modeloBonito(v('modelo'));
  const versao = limpa(v('versao')).toUpperCase().length <= 6 ? limpa(v('versao')).toUpperCase() : titulo(v('versao'));
  const ano = (v('ano').match(/\d{4}\s*\/\s*\d{4}|\d{4}/) || [''])[0].replace(/\s/g, '');
  const ipvaTxt = limpa(v('ipva'));
  const chaveOk = campos.chave ? simNao(campos.chave.bruto) : false;
  const revisoes = limpa(v('revisoes'));

  const veiculo = {
    cat: categoria(marca, modelo),
    brand: marca,
    model: modelo,
    versao,
    year: ano,
    mileage: km(v('km')),
    color: titulo(v('cor')),
    plate: limpa(v('placa')).toUpperCase().replace(/\s/g, ''),
    combustivel: combustivel(v('combustivel')),
    cambio: cambio(v('cambio')),
    ipva: ipvaTxt,
    chave_manual: chaveOk,
    revisoes: revisoes ? revisoes.charAt(0).toUpperCase() + revisoes.slice(1) : '',
    sale_price: dinheiro(v('preco')),
  };

  const interno = {
    purchase_price: dinheiro(v('custo')),
    fipe_value: dinheiro(v('fipe')),
    laudo: laudo(v('laudo')),
    pneus: limpa(v('pneus')),
    captacao: titulo(v('captacao')),
    obs: [limpa(v('obs')), ...(campos._extra || [])].filter(Boolean).join(' · '),
  };

  veiculo.description = descricao(veiculo, interno);

  const faltando = [];
  if (!veiculo.brand) faltando.push('marca');
  if (!veiculo.model) faltando.push('modelo');
  if (!veiculo.year) faltando.push('ano');
  if (!veiculo.mileage) faltando.push('km');
  if (!veiculo.sale_price) faltando.push('preço de venda');

  return { veiculo, interno, faltando };
}

// Descrição do anúncio no formato que a loja já usa no painel e que a ficha
// do site sabe ler (scripts/lib/description.js):
//
//   <abertura>                      -> subtítulo de "Sobre o veículo"
//
//   <parágrafo>
//
//   Destaques do veículo
//
//   • item                          -> lista de destaques
//
//   <fecho>
//
// Só entra o que o card diz e joga a favor do carro. Custo, FIPE, laudo e
// OBS interna nunca vão para o anúncio.
const PREMIUM = /porsche|jaguar|land rover|bmw|mercedes|audi|volvo|lexus|mini\b|maserati|ferrari|lamborghini|bentley|tesla/i;
const PICAPE = /hilux(?! sw4)|ranger|s10(?! high country sw)|amarok|l200|triton|frontier|toro|strada|saveiro|montana|maverick|ram\b|titano|oroch/i;
const SUV_GRANDE = /sw4|trailblazer|pajero|everest|commander|tahoe|discovery|defender|land cruiser|prado|xc90|q7|x5|gle|cayenne/i;
const SUV = /nivus|t-?cross|tiguan|taos|creta|tucson|compass|renegade|kicks|hr-?v|wr-?v|corolla cross|rav4|tracker|equinox|duster|captur|2008|3008|5008|c4 cactus|pulse|fastmade|fastback|e-?pace|f-?pace|evoque|velar|q3|q5|x1|x3|gla|glc|xc40|xc60|macan|sportage|sorento|outlander|eclipse cross|asx|haval|tiggo|song|yuan|dolphin/i;

function abertura(v) {
  const t = `${v.brand} ${v.model}`;
  if (v.cat === 'motos') return 'Desempenho, estilo e prazer de pilotar em cada saída.';
  if (v.cat === 'nautico') return 'Liberdade, diversão e adrenalina para curtir a água.';
  if (v.cat === 'utv') return 'Força e diversão para encarar qualquer terreno.';
  if (SUV_GRANDE.test(t)) return 'Robustez, espaço e presença para toda a família.';
  if (PICAPE.test(t)) return 'Força, robustez e versatilidade para o trabalho e o lazer.';
  if (PREMIUM.test(t) && SUV.test(t)) return 'Sofisticação e esportividade em um SUV premium.';
  if (PREMIUM.test(t)) return 'Sofisticação, desempenho e exclusividade em cada detalhe.';
  if (SUV.test(t)) return 'Design, conforto e praticidade em um SUV moderno.';
  return 'Conforto, economia e confiabilidade para o dia a dia.';
}

const kmNum = v => Number(String(v.mileage || '').replace(/\D/g, '')) || 0;

function destaques(v, extras = {}) {
  const lista = [];
  const km = kmNum(v);
  const anoModelo = Number(String(v.year).split('/').pop()) || 0;
  const idade = anoModelo ? Math.max(1, new Date().getFullYear() - anoModelo) : 0;
  if (km && idade && km / idade <= 12000) lista.push('Baixa quilometragem');
  if (v.revisoes && !/pendente|a fazer|a realizar|por conta/i.test(v.revisoes)) {
    lista.push(/conc|css|autoriz/i.test(v.revisoes) ? 'Todas as revisões realizadas na concessionária' : 'Revisões em dia');
  }
  if (v.ipva && /20\d\d/.test(v.ipva) && !/parcel|aberto|pendente/i.test(v.ipva)) lista.push(`IPVA ${v.ipva.match(/20\d\d/)[0]} pago`);
  else if (/pago/i.test(v.ipva || '')) lista.push('IPVA pago');
  if (v.chave_manual) lista.push('Chave reserva e manual');
  const obs = String(extras.obs || '');
  if (/[uú]nic[oa]\s+don[oa]/i.test(obs)) lista.push(/dona/i.test(obs) ? 'Única dona' : 'Único dono');
  if (/sem retoque/i.test(obs)) lista.push('Sem retoques');
  if (/^novos?$|pneus? novos?/i.test(String(extras.pneus || '').trim())) lista.push('Pneus novos');
  return lista;
}

function descricao(v, extras = {}) {
  const nome = [v.model, v.versao].filter(Boolean).join(' ');
  const cambio = v.cambio ? v.cambio.toLowerCase().replace('automatizado/cvt', 'CVT') : '';
  const motor = [cambio && `câmbio ${cambio}`, v.combustivel && `motor ${v.combustivel.toLowerCase()}`].filter(Boolean).join(' e ');
  let par = `${v.brand} ${nome}${v.year ? ` ${v.year}` : ''}`;
  if (motor) par += `, com ${motor}`;
  par += v.mileage ? `, ${v.mileage} rodados.` : '.';
  par += ' Veículo avaliado e preparado pela iBox Prime, pronto para a sua próxima viagem.';

  const blocos = [abertura(v), par];
  const d = destaques(v, extras);
  if (d.length) blocos.push('Destaques do veículo', d.map(x => `• ${x}`).join('\n'));
  blocos.push('Agende sua visita na iBox Prime, em Feira de Santana, ou fale com a gente pelo WhatsApp.');
  return blocos.join('\n\n');
}

export { ehCard, lerCard, dinheiro, categoria, descricao };
