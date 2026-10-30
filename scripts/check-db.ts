import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

type DbInfoRow = {
  db_name: string;
  user_name: string;
  pg_version: string;
  server_time: Date;
};

type TableRow = {
  table_name: string;
};

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

async function checkDatabaseHealth() {
  console.log("-----------------------------------------");
  console.log("Checking Database Connection & Health...");
  console.log("-----------------------------------------");

  try {
    const startTime = Date.now();
    const [dbInfo] = await prisma.$queryRaw<DbInfoRow[]>`
      SELECT 
        current_database() AS db_name,
        current_user AS user_name,
        version() AS pg_version,
        NOW() AS server_time
    `;
    const latency = Date.now() - startTime;

    console.log(" Connection: SUCCESS");
    console.log(` Latency: ${latency} ms`);
    console.log(` Database: ${dbInfo.db_name}`);
    console.log(` User: ${dbInfo.user_name}`);
    console.log(` PostgreSQL Version: ${dbInfo.pg_version.split(",")[0]}`);
    console.log(` Server Time: ${dbInfo.server_time}`);

    console.log("\nChecking Schema & Tables in PostgreSQL...");
    const tables = await prisma.$queryRaw<TableRow[]>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    const tableNames = tables.map((t) => t.table_name);
    console.log(` Tables Found (${tableNames.length}):`, tableNames.join(", ") || "None");

    // Check migration table
    const migrationTableExists = tableNames.includes("_prisma_migrations");
    if (migrationTableExists) {
      const migrations = await prisma.$queryRaw<MigrationRow[]>`
        SELECT migration_name, finished_at, rolled_back_at 
        FROM _prisma_migrations 
        ORDER BY started_at;
      `;
      console.log("\nApplied Migrations:", migrations);
    }

    // Checking application models
    console.log("\nModel Record Counts (Session Architecture):");
    try {
      const productCount = await prisma.product.count();
      console.log(`  - Products: ${productCount}`);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      console.log(`  - Products: Table not yet migrated in database (${err})`);
    }

    try {
      const cartCount = await prisma.cart.count();
      console.log(`  - Carts: ${cartCount}`);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      console.log(`  - Carts: Table not yet migrated in database (${err})`);
    }

    try {
      const sessionCount = await prisma.shoppingSession.count();
      console.log(`  - ShoppingSessions: ${sessionCount}`);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      console.log(`  - ShoppingSessions: Table not yet migrated in database (${err})`);
    }

    try {
      const cartItemCount = await prisma.cartItem.count();
      console.log(`  - CartItems: ${cartItemCount}`);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      console.log(`  - CartItems: Table not yet migrated in database (${err})`);
    }

    try {
      const scanEventCount = await prisma.scanEvent.count();
      console.log(`  - ScanEvents: ${scanEventCount}`);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      console.log(`  - ScanEvents: Table not yet migrated in database (${err})`);
    }

    try {
      const txCount = await prisma.transaction.count();
      console.log(`  - Transactions: ${txCount}`);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      console.log(`  - Transactions: Table not yet migrated in database (${err})`);
    }

    console.log("\nDatabase Health Check Finished.");
  } catch (error: unknown) {
    const err = error instanceof Error ? error.message : String(error);
    console.error("\n❌ Database Connection FAILED:");
    console.error(err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabaseHealth();
