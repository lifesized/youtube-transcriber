/**
 * One-shot: re-encrypt plaintext ProviderConfig.apiKey / groq_api_key rows.
 *
 * Requires TRANSCRIBER_SECRETS_KEY in the environment (or .env).
 *
 *   npx tsx scripts/migrate-secrets.ts
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ENV_NAME, migratePlaintextSecrets } from "../lib/secrets-store.js";

async function main() {
  if (!process.env[ENV_NAME]?.trim()) {
    console.error(
      `Set ${ENV_NAME} first (openssl rand -hex 32), then re-run.\n` +
        "Plaintext keys are left unchanged until the master key is present."
    );
    process.exit(1);
  }

  const result = await migratePlaintextSecrets(prisma);
  if (result.skipped) {
    console.error("Migration skipped:", result.reason);
    process.exit(1);
  }
  console.log(
    `Done. Providers migrated: ${result.migratedProviders}; settings migrated: ${result.migratedSettings}`
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
