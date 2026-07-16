const { createClient } = require('@supabase/supabase-js');

const url = 'http://localhost:8000';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q';

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
