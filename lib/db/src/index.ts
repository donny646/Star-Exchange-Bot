import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema";

const { Pool } = pg;

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.warn(
    "[db] DATABASE_URL is not set — database queries will fail until it is configured.",
  );
}

export const pool = new Pool({ connectionString: dbUrl });
export const db = drizzle(pool, { schema });

export async function runMigrations() {
  if (!dbUrl) {
    console.warn("[db] Skipping migrations — DATABASE_URL is not set.");
    return;
  }
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(__dirname, "./drizzle");
  await migrate(db, { migrationsFolder });
  console.log("[db] Migrations applied successfully.");
}

export * from "./schema";
