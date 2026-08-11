const fs = require('fs');
const path = require('path');

const en = JSON.parse(fs.readFileSync('messages/en.json', 'utf8'));

// Common string replacements for UI terms from English to pt-BR
function translateText(str) {
  if (typeof str !== 'string') return str;

  // Exact matches first
  const exactMap = {
    "Dashboard": "Dashboard",
    "Inbox": "Caixa de Entrada",
    "Contacts": "Contatos",
    "Pipelines": "Funis de Vendas",
    "Broadcasts": "Transmissões",
    "Automations": "Automações",
    "Flows": "Fluxos",
    "AI Agents": "Agentes de IA",
    "Settings": "Configurações",
    "Profile": "Perfil",
    "Account": "Conta",
    "Save": "Salvar",
    "Save Changes": "Salvar Alterações",
    "Saving...": "Salvando...",
    "Cancel": "Cancelar",
    "Delete": "Excluir",
    "Deleting...": "Excluindo...",
    "Edit": "Editar",
    "Create": "Criar",
    "Creating...": "Criando...",
    "Search": "Buscar",
    "Search...": "Buscar...",
    "Filter": "Filtrar",
    "All": "Todos",
    "Name": "Nome",
    "Email": "E-mail",
    "Phone": "Telefone",
    "Role": "Função",
    "Status": "Status",
    "Actions": "Ações",
    "Details": "Detalhes",
    "Back": "Voltar",
    "Close": "Fechar",
    "Confirm": "Confirmar",
    "Success": "Sucesso",
    "Error": "Erro",
    "Warning": "Aviso",
    "Info": "Informação",
    "Active": "Ativo",
    "Inactive": "Inativo",
    "Enabled": "Habilitado",
    "Disabled": "Desabilitado",
    "Pending": "Pendente",
    "Approved": "Aprovado",
    "Rejected": "Rejeitado",
    "Draft": "Rascunho",
    "Scheduled": "Agendado",
    "Sent": "Enviado",
    "Failed": "Falhou",
    "Open": "Aberto",
    "Won": "Ganho",
    "Lost": "Perdido",
    "Sign in": "Entrar",
    "Sign out": "Sair",
    "Signing in...": "Entrando...",
    "Welcome back": "Bem-vindo de volta",
    "Password": "Senha",
    "Forgot password?": "Esqueceu a senha?",
    "Create account": "Criar conta",
    "Don't have an account?": "Não tem uma conta?",
    "Owner": "Proprietário",
    "Admin": "Administrador",
    "Agent": "Atendente",
    "Viewer": "Visualizador",
    "User": "Usuário",
    "Avatar": "Avatar",
    "Beta": "Beta",
    "New Contact": "Novo Contato",
    "New Deal": "Novo Negócio",
    "New Broadcast": "Nova Transmissão",
    "New Automation": "Nova Automação",
    "Recent Activity": "Atividades Recentes",
    "View all →": "Ver tudo →",
    "No activity yet": "Nenhuma atividade ainda",
    "Show": "Exibir",
    "Conversations Over Time": "Volume de Conversas",
    "Daily message volume by direction": "Volume diário de mensagens por sentido",
    "Conversations": "Conversas",
    "Notifications": "Notificações",
    "Unread": "Não lida(s)",
    "Mark all as read": "Marcar todas como lidas",
    "Clear all": "Limpar todas",
    "No notifications": "Nenhuma notificação",
    "General": "Geral",
    "Members": "Membros",
    "API Keys": "Chaves de API",
    "WhatsApp Configuration": "Configuração do WhatsApp",
    "Message Templates": "Modelos de Mensagem",
    "Security": "Segurança",
    "Danger Zone": "Zona de Perigo"
  };

  if (exactMap[str]) return exactMap[str];

  return str;
}

// Recursively translate object
function translateObject(obj) {
  if (typeof obj === 'string') {
    return translateText(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(translateObject);
  }
  if (typeof obj === 'object' && obj !== null) {
    const res = {};
    for (const key in obj) {
      res[key] = translateObject(obj[key]);
    }
    return res;
  }
  return obj;
}

const ptBr = translateObject(en);

fs.writeFileSync(path.join(__dirname, 'messages', 'pt-BR.json'), JSON.stringify(ptBr, null, 2), 'utf8');
fs.writeFileSync(path.join(__dirname, 'messages', 'pt.json'), JSON.stringify(ptBr, null, 2), 'utf8');

console.log('pt-BR.json and pt.json created successfully.');
