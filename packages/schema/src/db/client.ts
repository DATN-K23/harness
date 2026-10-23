import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres, { type Options, type Sql } from "postgres"
import * as schema from "./schema"

export type Schema = typeof schema
export type Database = PostgresJsDatabase<Schema>

export interface DatabaseClientOptions {
  url?: string
  max?: number
  idleTimeout?: number
  connectTimeout?: number
  ssl?: Options<{}>["ssl"]
}

export interface DatabaseClient {
  db: Database
  sql: Sql
  close: () => Promise<void>
}

export const DEFAULT_DATABASE_URL = "postgresql://harness:harness@localhost:5432/harness"

export const createDatabaseClient = (options: DatabaseClientOptions = {}): DatabaseClient => {
  const url = options.url ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
  const sql = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout ?? 20,
    connect_timeout: options.connectTimeout ?? 10,
    ssl: options.ssl,
    onnotice: () => {},
  })

  const db = drizzle(sql, { schema })

  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 })
    },
  }
}
