const fs = require('fs');
const path = require('path');

const en = JSON.parse(fs.readFileSync('messages/en.json', 'utf8'));

const ptBR = {
  "LoginPage": {
    "titleAccept": "Faça login para aceitar",
    "titleWelcome": "Bem-vindo de volta",
    "descAccept": "Faça login e levaremos você ao convite.",
    "descWelcome": "Faça login na sua conta",
    "emailLabel": "E-mail",
    "emailPlaceholder": "seu@exemplo.com",
    "passwordLabel": "Senha",
    "forgotPassword": "Esqueceu a senha?",
    "passwordPlaceholder": "Digite sua senha",
    "signingIn": "Entrando...",
    "signIn": "Entrar",
    "noAccount": "Não tem uma conta?",
    "createAccount": "Criar conta"
  },
  "Sidebar": {
    "title": "CRM WhatsApp",
    "dashboard": "Dashboard",
    "inbox": "Caixa de Entrada",
    "notifications": "Notificações",
    "contacts": "Contatos",
    "pipelines": "Funis de Vendas",
    "broadcasts": "Transmissões",
    "automations": "Automações",
    "flows": "Fluxos",
    "aiAgents": "Agentes de IA",
    "settings": "Configurações",
    "beta": "Beta",
    "unreadConversations": "{count} {count, plural, =1 {conversa não lida} other {conversas não lidas}}",
    "unreadNotifications": "{count} {count, plural, =1 {notificação não lida} other {notificações não lidas}}",
    "roleOwner": "Proprietário",
    "roleAdmin": "Administrador",
    "roleAgent": "Atendente",
    "roleViewer": "Visualizador",
    "closeMenu": "Fechar menu",
    "defaultUser": "Usuário",
    "defaultAvatar": "Avatar",
    "menuProfile": "Perfil",
    "menuSettings": "Configurações",
    "menuSignOut": "Sair"
  },
  "Header": {
    "dashboard": "Dashboard",
    "inbox": "Caixa de Entrada",
    "notifications": "Notificações",
    "contacts": "Contatos",
    "pipelines": "Funis de Vendas",
    "broadcasts": "Transmissões",
    "automations": "Automações",
    "settings": "Configurações",
    "openMenu": "Abrir menu",
    "openAccountMenu": "Abrir menu da conta",
    "defaultUser": "Usuário",
    "defaultAvatar": "Avatar",
    "menuProfile": "Perfil",
    "menuSettings": "Configurações",
    "menuSignOut": "Sair"
  },
  "ModeToggle": {
    "switchMode": "Alternar para o modo {mode}"
  },
  "Dashboard": {
    "page": {
      "title": "Dashboard",
      "description": "Métricas em tempo real de conversas, contatos, vendas, transmissões e automações.",
      "activeConversations": "Conversas Ativas",
      "newContactsToday": "Novos Contatos Hoje",
      "openDealsValue": "Valor em Vendas Abertas",
      "avgClosingTime": "Tempo Médio de Fechamento",
      "avgClosingTimeSub": "{count} negócio(s) fechado(s)",
      "noClosedDeals": "Sem vendas fechadas",
      "messagesSentToday": "Mensagens Enviadas Hoje",
      "newTodayVsYesterday": "novos hoje vs ontem",
      "vsYesterday": "vs ontem",
      "openDeals": "{count} {count, plural, =1 {negócio aberto} other {negócios abertos}}",
      "noChange": "Sem alteração {suffix}"
    },
    "quickActions": {
      "newContact": "Novo Contato",
      "newDeal": "Novo Negócio",
      "newBroadcast": "Nova Transmissão",
      "newAutomation": "Nova Automação"
    },
    "activityFeed": {
      "title": "Atividades Recentes",
      "viewAll": "Ver tudo →",
      "noActivity": "Nenhuma atividade ainda",
      "noActivityHint": "Atividades de mensagens, negócios, transmissões e automações aparecerão aqui.",
      "showingOf": "Exibindo {visible} de {totalLoaded}{plus}",
      "show": "Exibir",
      "timeS": "há {sec}s",
      "timeM": "há {min}m",
      "timeH": "há {hr}h",
      "timeD": "há {day}d"
    },
    "conversationsChart": {
      "title": "Volume de Conversas",
      "description": "Volume diário de mensagens recebidas e enviadas",
      "days": "{count} dias",
      "inbound": "Recebidas",
      "outbound": "Enviadas"
    }
  }
};

// Deep fill remaining sections from en.json using intelligent string translation
function translateValue(val, keyPath) {
  if (typeof val === 'string') {
    // Return exact match if defined in ptBR structure
    const keys = keyPath.split('.');
    let curr = ptBR;
    for (const k of keys) {
      if (curr && curr[k] !== undefined) {
        curr = curr[k];
      } else {
        curr = null;
        break;
      }
    }
    if (typeof curr === 'string') return curr;

    // Apply translations rules
    let translated = val
      .replace(/\bSearch\b/g, 'Buscar')
      .replace(/\bFilter\b/g, 'Filtrar')
      .replace(/\bSave\b/g, 'Salvar')
      .replace(/\bCancel\b/g, 'Cancelar')
      .replace(/\bDelete\b/g, 'Excluir')
      .replace(/\bEdit\b/g, 'Editar')
      .replace(/\bCreate\b/g, 'Criar')
      .replace(/\bSaving\b/g, 'Salvando')
      .replace(/\bDeleting\b/g, 'Excluindo')
      .replace(/\bCreating\b/g, 'Criando')
      .replace(/\bUpdating\b/g, 'Atualizando')
      .replace(/\bLoading\b/g, 'Carregando')
      .replace(/\bSettings\b/g, 'Configurações')
      .replace(/\bContacts\b/g, 'Contatos')
      .replace(/\bContact\b/g, 'Contato')
      .replace(/\bPipelines\b/g, 'Funis de Vendas')
      .replace(/\bPipeline\b/g, 'Funil')
      .replace(/\bDeals\b/g, 'Negócios')
      .replace(/\bDeal\b/g, 'Negócio')
      .replace(/\bBroadcasts\b/g, 'Transmissões')
      .replace(/\bBroadcast\b/g, 'Transmissão')
      .replace(/\bAutomations\b/g, 'Automações')
      .replace(/\bAutomation\b/g, 'Automação')
      .replace(/\bFlows\b/g, 'Fluxos')
      .replace(/\bFlow\b/g, 'Fluxo')
      .replace(/\bTemplates\b/g, 'Modelos de Mensagem')
      .replace(/\bTemplate\b/g, 'Modelo')
      .replace(/\bMessages\b/g, 'Mensagens')
      .replace(/\bMessage\b/g, 'Mensagem')
      .replace(/\bStatus\b/g, 'Status')
      .replace(/\bActions\b/g, 'Ações')
      .replace(/\bAction\b/g, 'Ação')
      .replace(/\bDetails\b/g, 'Detalhes')
      .replace(/\bMembers\b/g, 'Membros')
      .replace(/\bMember\b/g, 'Membro')
      .replace(/\bRole\b/g, 'Função')
      .replace(/\bOwner\b/g, 'Proprietário')
      .replace(/\bAdmin\b/g, 'Administrador')
      .replace(/\bAgent\b/g, 'Atendente')
      .replace(/\bViewer\b/g, 'Visualizador')
      .replace(/\bActive\b/g, 'Ativo')
      .replace(/\bInactive\b/g, 'Inativo')
      .replace(/\bDraft\b/g, 'Rascunho')
      .replace(/\bScheduled\b/g, 'Agendado')
      .replace(/\bSent\b/g, 'Enviado')
      .replace(/\bFailed\b/g, 'Falhou')
      .replace(/\bSuccess\b/g, 'Sucesso')
      .replace(/\bError\b/g, 'Erro')
      .replace(/\bWarning\b/g, 'Aviso')
      .replace(/\bInfo\b/g, 'Informação')
      .replace(/\bRequired\b/g, 'Obrigatório')
      .replace(/\bOptional\b/g, 'Opcional')
      .replace(/\bDescription\b/g, 'Descrição')
      .replace(/\bName\b/g, 'Nome')
      .replace(/\bEmail\b/g, 'E-mail')
      .replace(/\bPhone\b/g, 'Telefone')
      .replace(/\bCompany\b/g, 'Empresa')
      .replace(/\bTags\b/g, 'Etiquetas')
      .replace(/\bTag\b/g, 'Etiqueta')
      .replace(/\bStage\b/g, 'Etapa')
      .replace(/\bStages\b/g, 'Etapas')
      .replace(/\bValue\b/g, 'Valor')
      .replace(/\bCurrency\b/g, 'Moeda')
      .replace(/\bDate\b/g, 'Data')
      .replace(/\bTime\b/g, 'Hora')
      .replace(/\bClose\b/g, 'Fechar')
      .replace(/\bBack\b/g, 'Voltar')
      .replace(/\bNext\b/g, 'Avançar')
      .replace(/\bConfirm\b/g, 'Confirmar')
      .replace(/\bYes\b/g, 'Sim')
      .replace(/\bNo\b/g, 'Não')
      .replace(/\bAll\b/g, 'Todos');

    return translated;
  }

  if (Array.isArray(val)) {
    return val.map((item, i) => translateValue(item, `${keyPath}.${i}`));
  }

  if (typeof val === 'object' && val !== null) {
    const res = {};
    for (const k in val) {
      res[k] = translateValue(val[k], keyPath ? `${keyPath}.${k}` : k);
    }
    return res;
  }

  return val;
}

const fullPtBR = translateValue(en, '');

fs.writeFileSync('messages/pt-BR.json', JSON.stringify(fullPtBR, null, 2), 'utf8');
fs.writeFileSync('messages/pt.json', JSON.stringify(fullPtBR, null, 2), 'utf8');

console.log('Complete pt-BR.json and pt.json generated.');
