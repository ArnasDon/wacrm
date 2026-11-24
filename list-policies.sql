-- List all policies on accounts table
SELECT 
  policyname,
  cmd as command,
  roles
FROM pg_policies 
WHERE tablename = 'accounts'
ORDER BY policyname;
