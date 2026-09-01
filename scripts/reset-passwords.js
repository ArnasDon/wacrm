const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Charger .env.local
const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    const val = rest.join('=').trim();
    if (!process.env[key] && val) {
      process.env[key] = val;
    }
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Erreur: NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis dans .env.local');
  process.exit(1);
}

const supabase = createClient(url, key);

(async () => {
  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.error('Error fetching users:', error);
    return;
  }
  
  if (!users || users.length === 0) {
    console.log('No users found in auth.users.');
    
    console.log('Creating a default user (admin@example.com / Password123!)...');
    const { data: newUserData, error: createError } = await supabase.auth.admin.createUser({
      email: 'admin@example.com',
      password: 'Password123!',
      email_confirm: true
    });
    
    if (createError) {
      console.error('Error creating user:', createError);
    } else {
      console.log('Successfully created user: admin@example.com with password: Password123!');
    }
    return;
  }

  console.log(`Found ${users.length} users. Updating passwords...`);
  for (const user of users) {
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      user.id,
      { password: 'Password123!' }
    );
    
    if (updateError) {
      console.error(`Failed to update password for ${user.email}:`, updateError);
    } else {
      console.log(`Successfully updated password for ${user.email} to: Password123!`);
    }
  }
})();
