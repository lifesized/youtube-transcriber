import type { SecretsKeyError } from "./secrets-crypto";

export { SecretsKeyError };
export declare const ENV_NAME: "TRANSCRIBER_SECRETS_KEY";

export declare function encryptApiKeyForStorage(plaintext: string): string;
export declare function decryptApiKeyForUse(stored: string): string;
export declare function maskApiKeyForResponse(stored: string): string;
export declare function isMaskedPlaceholder(
  value: string | undefined | null
): boolean;

export declare function migratePlaintextSecrets(prisma: {
  providerConfig: {
    findMany: (args?: object) => Promise<Array<{ id: string; apiKey: string }>>;
    update: (args: object) => Promise<unknown>;
  };
  setting: {
    findUnique: (
      args: object
    ) => Promise<{ key: string; value: string } | null>;
    update: (args: object) => Promise<unknown>;
  };
}): Promise<{
  migratedProviders: number;
  migratedSettings: number;
  skipped: boolean;
  reason?: string;
}>;

export declare function ensureSecretsMigrated(
  getPrisma: () => Promise<{
    providerConfig: object;
    setting: object;
  }>
): Promise<{
  migratedProviders: number;
  migratedSettings: number;
  skipped: boolean;
  reason?: string;
}>;
