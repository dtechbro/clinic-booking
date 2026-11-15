import pg from 'pg';
export function makePool(connectionString = process.env.DATABASE_URL) {
 if (!connectionString) throw new Error('DATABASE_URL is required');
 // pg honors sslmode in the URL. Keep certificate verification enabled.
 return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 10000 });
}
