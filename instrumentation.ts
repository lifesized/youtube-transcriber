export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureInEnv } = await import("./lib/local-api-token.js");
    ensureInEnv();

    const { ensureSecretsMigrated } = await import("./lib/secrets-store.js");
    await ensureSecretsMigrated(async () => {
      const { prisma } = await import("./lib/prisma");
      return prisma;
    });
  }
}
