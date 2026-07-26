import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { initSchema, closePool } from "../db/postgres.js";

/**
 * Creates the `posts` and `covered_topics` tables in your Postgres database by
 * running db/sql/schema.sql. Safe to run repeatedly — the schema uses
 * `create table if not exists`. Run once after setting DATABASE_URL:
 *
 *   npm run init-db
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "..", "db", "sql", "schema.sql");

try {
  const sql = await readFile(schemaPath, "utf8");
  await initSchema(sql);
  console.log("Schema applied. Tables `posts` and `covered_topics` are ready.");
} catch (err) {
  console.error(`init-db failed: ${err.message}`);
  console.error(
    "Checklist: DATABASE_URL set to your Railway Postgres connection string " +
      "(the public one), and the database reachable from here."
  );
  process.exitCode = 1;
} finally {
  await closePool();
}
