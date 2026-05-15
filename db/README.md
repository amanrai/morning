# db

Database schema and migration files for the hosted Morning stack.

The target database is Neon Postgres. Schema changes are plain SQL files in `db/migrations/` and are applied by `scripts/migrate.js`.

Do not put credentials here. Put `DATABASE_URL` in the project `.env` file.
