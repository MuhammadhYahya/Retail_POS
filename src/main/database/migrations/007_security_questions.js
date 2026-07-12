export const version = '007_security_questions';

export function up(db) {
  const userColumns = db
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((column) => column.name);

  const columnsToAdd = [
    ['security_q1', 'TEXT'],
    ['security_a1_hash', 'TEXT'],
    ['security_q2', 'TEXT'],
    ['security_a2_hash', 'TEXT'],
    ['email', 'TEXT'],
    ['phone', 'TEXT'],
  ];

  for (const [name, type] of columnsToAdd) {
    if (!userColumns.includes(name)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
    }
  }
}
