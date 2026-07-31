const fs = require('fs');
const path = require('path');
const enPath = path.join(__dirname, '..', 'messages', 'en.json');
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

// Add 'instagram' to Settings.sections
en.Settings.sections.instagram = 'Instagram';

// Add full instagram translations block
en.Settings.instagram = {
  title: 'Instagram',
  description: 'Connect your Instagram Business Account to automate DM responses with product keywords.',
  connected: 'Connected',
  notConnected: 'Not Connected',
  connectedDesc: 'Instagram is connected and ready to receive DMs.',
  notConnectedDesc: 'Configure your Instagram credentials below.',
  webhookTitle: 'Webhook URL',
  webhookDesc: 'Use this URL as the webhook callback in your Meta App → Instagram → Webhook settings.',
  webhookUrl: 'Callback URL',
  webhookHint: 'Subscribe to the <strong>messages</strong> field and use the Verify Token you set below.',
  apiCredentialsTitle: 'API Credentials',
  apiCredentialsDesc: 'Enter your Instagram Business Account credentials. These are stored encrypted.',
  igUserId: 'Instagram Business Account ID',
  igUserIdPlaceholder: 'e.g. 17841405822304914',
  igUserIdHint: 'Found in Meta Business Suite → Instagram Accounts, or via <code>GET /me/accounts?fields=instagram_business_account</code>.',
  accessToken: 'Page Access Token',
  accessTokenHint: '(with instagram_manage_messages)',
  accessTokenPlaceholder: 'EAAT... long-lived token',
  tokenHidden: 'Token is hidden for security. Click the field to re-enter it.',
  verifyToken: 'Webhook Verify Token',
  verifyTokenPlaceholder: 'Create a custom verify token',
  verifyTokenHint: 'A custom string you create. Must match the token you set in Meta App Dashboard → Instagram → Webhook.',
  saveConfig: 'Save Configuration',
  updateConfig: 'Update Configuration',
  saving: 'Saving...',
  testing: 'Testing...',
  testConnection: 'Test Connection',
  resetting: 'Resetting...',
  resetConfig: 'Reset Configuration',
  setupInstructionsTitle: 'Setup Instructions',
  setupInstructionsDesc: 'Follow these steps to connect your Instagram Business Account.',
  step1: 'Add Instagram to your Meta App',
  step1_1: 'Go to <strong>developers.facebook.com</strong> → My Apps',
  step1_2: 'Open your existing WhatsApp app',
  step1_3: 'Click <strong>Add Product</strong> → <strong>Instagram Graph API</strong>',
  step2: 'Get your Instagram Business Account ID',
  step2_1: 'Go to <strong>Meta Business Suite</strong> → Settings → Instagram',
  step2_2: 'Find your Instagram Business Account ID (numeric)',
  step2_3: 'Or use: <code>GET /me/accounts?fields=instagram_business_account</code>',
  step3: 'Generate a Page Access Token',
  step3_1: 'Go to <strong>Meta Business Settings</strong> → System Users',
  step3_2: 'Create a System User or use an existing one',
  step3_3: 'Assign permissions: <strong>pages_manage_metadata</strong>, <strong>pages_read_engagement</strong>',
  step3_4: 'Generate a <strong>long-lived Page Access Token</strong> for your Facebook Page',
  step3_5: 'Ensure the Page is connected to your Instagram Business Account',
  step3_6: 'For DM access, the token needs <strong>instagram_manage_messages</strong>',
  step4: 'Configure Webhook',
  step4_1: 'In Meta App → Instagram → Webhook',
  step4_2: 'Paste the <strong>Callback URL</strong> shown above',
  step4_3: 'Enter the same <strong>Verify Token</strong> you set here',
  step4_4: 'Subscribe to the <strong>messages</strong> field',
  howItWorks: '<strong>How it works:</strong> When someone sends a keyword in your Instagram DM, the system looks up your Products by <code>trigger_keyword</code> and replies with a WhatsApp deep link (wa.me) for that product.',
  metaDocs: 'Instagram Messaging API Docs',
  updateSuccess: 'Instagram @{username} connected successfully!',
  updateSuccessGeneric: 'Instagram connected successfully!'
};

fs.writeFileSync(enPath, JSON.stringify(en));
console.log('File updated successfully');
