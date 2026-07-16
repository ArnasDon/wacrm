const { createClient } = require('./node_modules/@supabase/supabase-js')
const supabase = createClient('http://supabase-kong:8000', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE')
;(async () => {
  const email = 'test-login-1@example.com'
  const pass = 'Test1234!'
  const create = await supabase.auth.admin.createUser({ email, password: pass, email_confirm: true })
  console.log('create', JSON.stringify(create, null, 2))
  const login = await supabase.auth.signInWithPassword({ email, password: pass })
  console.log('login', JSON.stringify(login, null, 2))
})()
