const fs = require('fs');
const path = require('path');

const en = JSON.parse(fs.readFileSync('messages/en.json', 'utf8'));

// High quality comprehensive Portuguese (Brasil) translations dictionary
const ptBR = {
  "LoginPage": {
    "titleAccept": "Faça login para aceitar o convite",
    "titleWelcome": "Bem-vindo de volta",
    "descAccept": "Faça login e levaremos você diretamente ao convite.",
    "descWelcome": "Faça login na sua conta para continuar",
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
    "title": "WA CRM",
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
      "description": "Métricas em tempo real de conversas, contatos, negócios, transmissões e automações.",
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
      "noActivity": "Nenhuma atividade recente",
      "noActivityHint": "As atividades de mensagens, negócios, transmissões e automações aparecerão aqui.",
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

// Comprehensive word & phrase dictionary for automated translation of all nested keys
const dictionary = [
  // Multi-word phrases
  ["Sign in to accept", "Faça login para aceitar"],
  ["Welcome back", "Bem-vindo de volta"],
  ["Sign in to your account", "Faça login na sua conta"],
  ["Forgot password?", "Esqueceu a senha?"],
  ["Don't have an account?", "Não tem uma conta?"],
  ["Create account", "Criar conta"],
  ["Signing in...", "Entrando..."],
  ["Sign in", "Entrar"],
  ["Sign out", "Sair"],
  ["Save changes", "Salvar alterações"],
  ["Save Changes", "Salvar Alterações"],
  ["Saving...", "Salvando..."],
  ["Deleting...", "Excluindo..."],
  ["Creating...", "Criando..."],
  ["Updating...", "Atualizando..."],
  ["Loading...", "Carregando..."],
  ["Sending...", "Enviando..."],
  ["Processing...", "Processando..."],
  ["No contacts found", "Nenhum contato encontrado"],
  ["No deals found", "Nenhum negócio encontrado"],
  ["No conversations found", "Nenhuma conversa encontrada"],
  ["No messages found", "Nenhuma mensagem encontrada"],
  ["No automations found", "Nenhuma automação encontrada"],
  ["No flows found", "Nenhum fluxo encontrado"],
  ["No broadcasts found", "Nenhuma transmissão encontrada"],
  ["New Contact", "Novo Contato"],
  ["New Deal", "Novo Negócio"],
  ["New Broadcast", "Nova Transmissão"],
  ["New Automation", "Nova Automação"],
  ["New Flow", "Novo Fluxo"],
  ["Add Contact", "Adicionar Contato"],
  ["Add Deal", "Adicionar Negócio"],
  ["Add Stage", "Adicionar Etapa"],
  ["Add Tag", "Adicionar Etiqueta"],
  ["Add Member", "Adicionar Membro"],
  ["Manage Pipeline", "Gerenciar Pipeline"],
  ["Manage Pipelines", "Gerenciar Pipelines"],
  ["Pipeline Settings", "Configurações do Pipeline"],
  ["Stage Settings", "Configurações de Etapa"],
  ["Required Fields", "Campos Obrigatórios"],
  ["Required fields", "Campos obrigatórios"],
  ["Protected Stage", "Etapa Protegida"],
  ["Protected stage", "Etapa protegida"],
  ["Close menu", "Fechar menu"],
  ["Open menu", "Abrir menu"],
  ["View all", "Ver tudo"],
  ["View details", "Ver detalhes"],
  ["Select contact", "Selecionar contato"],
  ["Select pipeline", "Selecionar pipeline"],
  ["Select stage", "Selecionar etapa"],
  ["Select template", "Selecionar modelo"],
  ["Select role", "Selecionar função"],
  ["Select date", "Selecionar data"],
  ["Select time", "Selecionar hora"],
  ["All contacts", "Todos os contatos"],
  ["All deals", "Todos os negócios"],
  ["All pipelines", "Todos os funis"],
  ["All tags", "Todas as etiquetas"],
  ["All members", "Todos os membros"],
  ["All status", "Todos os status"],
  ["Active conversations", "Conversas ativas"],
  ["Recent activity", "Atividades recentes"],
  ["WhatsApp Configuration", "Configuração do WhatsApp"],
  ["Message Templates", "Modelos de Mensagem"],
  ["API Keys", "Chaves de API"],
  ["Danger Zone", "Zona de Perigo"],
  ["Team Members", "Membros da Equipe"],
  ["User Profile", "Perfil do Usuário"],
  ["System Settings", "Configurações do Sistema"],
  ["Dark Mode", "Modo Escuro"],
  ["Light Mode", "Modo Claro"],
  ["System Default", "Padrão do Sistema"],
  ["English", "Inglês"],
  ["Portuguese", "Português"],
  ["Korean", "Coreano"],
  ["Brazilian Portuguese", "Português do Brasil"],
  
  // Words
  ["Dashboard", "Dashboard"],
  ["Inbox", "Caixa de Entrada"],
  ["Notifications", "Notificações"],
  ["Notification", "Notificação"],
  ["Contacts", "Contatos"],
  ["Contact", "Contato"],
  ["Pipelines", "Funis de Vendas"],
  ["Pipeline", "Funil"],
  ["Deals", "Negócios"],
  ["Deal", "Negócio"],
  ["Broadcasts", "Transmissões"],
  ["Broadcast", "Transmissão"],
  ["Automations", "Automações"],
  ["Automation", "Automação"],
  ["Flows", "Fluxos"],
  ["Flow", "Fluxo"],
  ["Agents", "Agentes"],
  ["Agent", "Atendente"],
  ["Settings", "Configurações"],
  ["Setting", "Configuração"],
  ["Profile", "Perfil"],
  ["Account", "Conta"],
  ["Members", "Membros"],
  ["Member", "Membro"],
  ["Role", "Função"],
  ["Roles", "Funções"],
  ["Owner", "Proprietário"],
  ["Admin", "Administrador"],
  ["Viewer", "Visualizador"],
  ["User", "Usuário"],
  ["Save", "Salvar"],
  ["Cancel", "Cancelar"],
  ["Delete", "Excluir"],
  ["Remove", "Remover"],
  ["Edit", "Editar"],
  ["Create", "Criar"],
  ["Search", "Buscar"],
  ["Filter", "Filtrar"],
  ["Actions", "Ações"],
  ["Action", "Ação"],
  ["Details", "Detalhes"],
  ["Detail", "Detalhe"],
  ["Overview", "Visão Geral"],
  ["Status", "Status"],
  ["Name", "Nome"],
  ["Title", "Título"],
  ["Description", "Descrição"],
  ["Notes", "Observações"],
  ["Note", "Observação"],
  ["Email", "E-mail"],
  ["Phone", "Telefone"],
  ["Company", "Empresa"],
  ["Value", "Valor"],
  ["Currency", "Moeda"],
  ["Stage", "Etapa"],
  ["Stages", "Etapas"],
  ["Tags", "Etiquetas"],
  ["Tag", "Etiqueta"],
  ["Created", "Criado"],
  ["Updated", "Atualizado"],
  ["Sent", "Enviado"],
  ["Received", "Recebido"],
  ["Pending", "Pendente"],
  ["Approved", "Aprovado"],
  ["Rejected", "Rejeitado"],
  ["Draft", "Rascunho"],
  ["Scheduled", "Agendado"],
  ["Active", "Ativo"],
  ["Inactive", "Inativo"],
  ["Enabled", "Habilitado"],
  ["Disabled", "Desabilitado"],
  ["Won", "Ganho"],
  ["Lost", "Perdido"],
  ["Open", "Aberto"],
  ["Closed", "Fechado"],
  ["Required", "Obrigatório"],
  ["Optional", "Opcional"],
  ["Success", "Sucesso"],
  ["Error", "Erro"],
  ["Warning", "Aviso"],
  ["Info", "Informação"],
  ["Yes", "Sim"],
  ["No", "Não"],
  ["All", "Todos"],
  ["None", "Nenhum"],
  ["Back", "Voltar"],
  ["Next", "Avançar"],
  ["Close", "Fechar"],
  ["Confirm", "Confirmar"]
];

function translateString(str) {
  if (typeof str !== 'string') return str;
  let result = str;

  for (const [from, to] of dictionary) {
    const regex = new RegExp('\\b' + from.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'g');
    result = result.replace(regex, to);
  }

  return result;
}

function processObject(sourceObj, overrideObj, keyPath = '') {
  if (typeof sourceObj === 'string') {
    if (typeof overrideObj === 'string') return overrideObj;
    return translateString(sourceObj);
  }
  if (Array.isArray(sourceObj)) {
    return sourceObj.map((item, index) =>
      processObject(item, overrideObj ? overrideObj[index] : undefined, `${keyPath}.${index}`)
    );
  }
  if (typeof sourceObj === 'object' && sourceObj !== null) {
    const result = {};
    for (const key in sourceObj) {
      const subOverride = overrideObj ? overrideObj[key] : undefined;
      result[key] = processObject(sourceObj[key], subOverride, keyPath ? `${keyPath}.${key}` : key);
    }
    return result;
  }
  return sourceObj;
}

const finalPtBR = processObject(en, ptBR);

fs.writeFileSync('messages/pt-BR.json', JSON.stringify(finalPtBR, null, 2), 'utf8');
fs.writeFileSync('messages/pt.json', JSON.stringify(finalPtBR, null, 2), 'utf8');

console.log('Successfully updated pt-BR.json and pt.json with deep translation!');
