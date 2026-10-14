// Adapted from OpenCode packages/schema/src/index.ts @ 3f393d78bf (MIT License). See NOTICE.

import { migrate } from "drizzle-orm/postgres-js/migrator"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createDatabaseClient, DEFAULT_DATABASE_URL } from "./client"

const defaultMigrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle")

export interface RunMigrationsOptions {
  url?: string
  migrationsFolder?: string
}

export const runMigrations = async (options: RunMigrationsOptions = {}): Promise<void> => {
  const url = options.url ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
  const client = createDatabaseClient({ url, max: 1 })
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder

  try {
    await migrate(client.db, { migrationsFolder })
  } finally {
    await client.close()
  }
}

if (import.meta.main) {
  runMigrations()
    .then(() => {
      console.log("Migrations applied successfully.")
      process.exit(0)
    })
    .catch((error) => {
      console.error("Migration failed:", error)
      process.exit(1)
    })
}
