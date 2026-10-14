export async function selectMigrationOwner(db) {
  const {
    rows: [role],
  } = await db.query(
    'SELECT current_user AS name, rolsuper FROM pg_roles WHERE rolname = current_user'
  );
  if (!role?.rolsuper && role?.name !== 'omni_owner')
    throw new Error(
      'Use the migration owner or PostgreSQL administrator, not an application runtime role.'
    );
  if (role.name !== 'omni_owner') await db.query('SET ROLE omni_owner');
}
