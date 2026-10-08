export function applyMigrations(
  databaseUrl: string,
  migrationsDir?: string
): { applied: string[]; skipped: string[]; dbPath: string };

export function dbPathFromUrl(databaseUrl: string): string;

export function resolveMigrationsDir(explicit?: string): string;

export function listMigrationNames(migrationsDir: string): string[];
