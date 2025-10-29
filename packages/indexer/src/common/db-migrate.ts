import migrationRunner from "node-pg-migrate";
import fs from "fs";
import path from "path";
import { acquireLock, redis, releaseLock } from "@/common/redis";
import { logger } from "@/common/logger";
import { delay } from "@/common/utils";

import { config } from "@/config/index";

export const runDBMigration = async () => {
  const EXPIRATION_LOCK = 300;
  const CHECK_MIGRATION_INTERVAL = 1000;
  const dbMigrationLock = "db-migration-lock";
  const dbMigrationVersion = "db-migration-version";

  const doRun = async () => {
    if (await acquireLock(dbMigrationLock, EXPIRATION_LOCK)) {
      logger.info("postgresql-migration", `Start postgresql migration`);
      try {
        // Resolve migrations directory robustly for both monorepo root and package cwd
        const candidates = [
          // Monorepo root during Docker runtime
          path.resolve(process.cwd(), "packages/indexer/src/migrations"),
          // Package-local for turbo/yarn workspace scripts
          path.resolve(process.cwd(), "src/migrations"),
          // Relative to compiled file location (fallback)
          path.resolve(__dirname, "../../src/migrations"),
        ];
        const dir = candidates.find((p) => fs.existsSync(p)) ?? candidates[0];

        await migrationRunner({
          dryRun: false,
          databaseUrl: {
            connectionString: config.databaseUrl,
          },
          dir,
          ignorePattern: "\\..*",
          schema: "public",
          createSchema: undefined,
          migrationsSchema: undefined,
          createMigrationsSchema: undefined,
          migrationsTable: "pgmigrations",
          count: undefined,
          timestamp: false,
          file: undefined,
          checkOrder: false,
          verbose: true,
          direction: "up",
          singleTransaction: true,
          noLock: false,
          fake: false,
          decamelize: undefined,
        });

        await redis.set(dbMigrationVersion, config.imageTag);

        logger.info("postgresql-migration", `Stop postgresql migration`);
      } catch (err) {
        logger.error("postgresql-migration", `${err}`);
      } finally {
        await releaseLock(dbMigrationLock);
      }
    } else {
      logger.debug(
        "postgresql-migration",
        `postgresql migration in progress in a different instance`
      );
      await delay(CHECK_MIGRATION_INTERVAL);
    }
  };

  while ((await redis.get(dbMigrationVersion)) !== config.imageTag) {
    await doRun();
  }
  logger.info("postgresql-migration", `postgresql database schema is up to date`);
};
