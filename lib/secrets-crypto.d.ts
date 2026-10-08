export declare const ENV_NAME: "TRANSCRIBER_SECRETS_KEY";
export declare const PREFIX: "yttenc:v1:";

export declare class SecretsKeyError extends Error {
  constructor(message: string);
}

export declare function isEncryptedSecret(value: string): boolean;
export declare function parseSecretsKey(raw: string | undefined): Buffer | null;
export declare function getSecretsKeyOrNull(): Buffer | null;
export declare function requireSecretsKey(): Buffer;
export declare function encryptSecret(plaintext: string, key?: Buffer): string;
export declare function decryptSecret(stored: string, key?: Buffer | null): string;
export declare function maskStoredSecret(stored: string): string;
export declare function isMaskedPlaceholder(
  value: string | undefined | null,
  currentMasked?: string | undefined | null
): boolean;
export declare function generateSecretsKeyHex(): string;
