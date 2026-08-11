const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, 'supabase', 'migrations');
const files = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

let concatSql = '';
for (const file of files) {
  let content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  // Strip UTF-8 Byte Order Mark (BOM) if present
  content = content.replace(/^\uFEFF/, '');
  concatSql += `-- ==================================================\n`;
  concatSql += `-- Migration: ${file}\n`;
  concatSql += `-- ==================================================\n`;
  concatSql += content + '\n\n';
}

fs.writeFileSync('supabase_all_migrations.sql', concatSql, 'utf8');
console.log('Concatenated', files.length, 'migration files into supabase_all_migrations.sql');
