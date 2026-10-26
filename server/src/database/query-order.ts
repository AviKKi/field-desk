import { sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

export function insertionOrder(table: SQLiteTable) {
  return sql<number>`${table}.rowid`;
}
