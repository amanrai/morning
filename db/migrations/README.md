# db/migrations

Ordered SQL migrations for Neon Postgres.

Files are applied alphabetically by `scripts/migrate.js`, so prefix names with sortable numbers:

```text
001_extensions.sql
010_users.sql
020_sources.sql
```

Applied migrations are recorded in the database table `schema_migrations`.

Guidelines:
- Prefer small files grouped by domain/functionality.
- Use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` where practical.
- Never edit an already-applied migration for a shared/deployed database; add a new migration instead.
