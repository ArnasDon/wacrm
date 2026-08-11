const fs = require('fs');
const path = require('path');

const enPath = path.join(__dirname, 'messages', 'en.json');
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

// Deep clone function
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Translations mapping
const translations = {
  // Common terms & placeholders
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
  }
};

console.log('Script initialized.');
