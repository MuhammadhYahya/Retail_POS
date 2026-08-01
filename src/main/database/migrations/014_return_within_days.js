export const version = '014_return_within_days';

export function up(db) {
  db.exec(`
    ALTER TABLE settings
    ADD COLUMN return_within_days INTEGER NOT NULL DEFAULT 7;
  `);
}
