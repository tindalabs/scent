import postgres from 'postgres';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://scent:scent@localhost:5432/scent';

// Single connection pool, shared across the process lifetime.
// postgres() is lazy — the first query opens the pool.
export const db = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});
