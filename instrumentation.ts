export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureInEnv } = await import("./lib/local-api-token.js");
    ensureInEnv();
  }
}
