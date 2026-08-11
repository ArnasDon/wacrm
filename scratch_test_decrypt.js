const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function decrypt(encryptedText, keyHex) {
  const parts = encryptedText.split(':');
  if (parts.length === 3) {
    const [ivHex, ctHex, tagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ctHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } else if (parts.length === 2) {
    const [ivHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), iv);
    let decrypted = decipher.update(ctHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
  throw new Error('Invalid format');
}

async function run() {
  const { data, error } = await supabase.from('whatsapp_config').select('*');
  if (error) {
    console.error('Error fetching config:', error);
    return;
  }
  console.log('Configs found:', data.length);
  for (const row of data) {
    console.log(`Phone: ${row.phone_number_id}`);
    console.log(`Encrypted Token: ${row.access_token}`);
    try {
      const dec = decrypt(row.access_token, process.env.ENCRYPTION_KEY);
      console.log('Decrypted successfully! Token length:', dec.length);
    } catch (err) {
      console.log('Decryption failed with current key:', err.message);
    }
  }
}

run();
