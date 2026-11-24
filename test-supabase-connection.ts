/**
 * Supabase Connection Diagnostic Script
 * Run with: npx tsx test-supabase-connection.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://aqvxgrjmdaowewjgylnn.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxdnhncmptZGFvd2V3amd5bG5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU0NTg2MzgsImV4cCI6MjExMTAzNDYzOH0.MC-Yxe0xHJTk_sgOx7-RTjRzhAwPsXeTxrPYPf_M7cI';

async function testConnection() {
  console.log('🔍 Testing Supabase Connection...\n');

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Test 1: Check authentication
  console.log('1️⃣ Checking authentication...');
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.log('❌ Not authenticated:', authError.message);
  } else if (user) {
    console.log('✅ Authenticated as:', user.email);
    console.log('   User ID:', user.id);
  } else {
    console.log('⚠️  No user session found');
  }

  // Test 2: Try to fetch accounts
  console.log('\n2️⃣ Testing accounts access...');
  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('id, name')
    .limit(1);
  
  if (accountsError) {
    console.log('❌ Error fetching accounts:', accountsError.message);
    console.log('   Code:', accountsError.code);
    console.log('   Details:', accountsError.details);
  } else {
    console.log('✅ Accounts accessible:', accounts?.length || 0, 'accounts found');
    if (accounts && accounts.length > 0) {
      console.log('   First account:', accounts[0]);
    }
  }

  // Test 3: Try to fetch profiles
  console.log('\n3️⃣ Testing profiles access...');
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('user_id, full_name, account_id')
    .limit(1);
  
  if (profilesError) {
    console.log('❌ Error fetching profiles:', profilesError.message);
  } else {
    console.log('✅ Profiles accessible:', profiles?.length || 0, 'profiles found');
    if (profiles && profiles.length > 0) {
      console.log('   First profile:', profiles[0]);
    }
  }

  // Test 4: Try to insert a test contact (will fail if not authenticated)
  console.log('\n4️⃣ Testing INSERT permissions...');
  const testPhone = `+1${Date.now().toString().slice(-10)}`;
  const { data: testContact, error: insertError } = await supabase
    .from('contacts')
    .insert({
      phone: testPhone,
      name: 'Test Contact',
    })
    .select()
    .single();
  
  if (insertError) {
    console.log('❌ Cannot insert contact:', insertError.message);
    console.log('   This is EXPECTED if you\'re not logged in');
    console.log('   Code:', insertError.code);
  } else {
    console.log('✅ Contact inserted successfully:', testContact);
    // Clean up
    await supabase.from('contacts').delete().eq('id', testContact.id);
    console.log('   (Test contact cleaned up)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('📋 DIAGNOSIS:');
  console.log('='.repeat(60));
  
  if (!user) {
    console.log('⚠️  You are NOT logged in.');
    console.log('   Solution: Log in to your app at http://localhost:3000');
    console.log('   Then try creating/updating data from the UI.');
  } else if (accountsError) {
    console.log('⚠️  Authentication works, but RLS policies might be blocking access.');
    console.log('   Check if your user has an account membership in the database.');
  } else {
    console.log('✅ Connection is working!');
    console.log('   If you still can\'t save data, check:');
    console.log('   1. Browser console for specific errors');
    console.log('   2. Network tab for failed API calls');
    console.log('   3. Supabase dashboard logs');
  }
}

testConnection().catch(console.error);
