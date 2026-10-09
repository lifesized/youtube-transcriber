const HOUR_MS = 3_600_000;
const DEFAULT_HOURLY = 20;

export class OverrideCapError extends Error {
  status = 429;
  code = "override_hourly_cap";

  constructor(message = "Hourly prompt-override cap reached. Try again later.") {
    super(message);
    this.name = "OverrideCapError";
  }
}

export function overrideHourlyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TUSK_OVERRIDE_HOURLY_CAP ?? env.OVERRIDE_HOURLY_CAP;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return DEFAULT_HOURLY;
}

export function createOverrideBudget(options: {
  hourlyLimit?: number;
  hourMs?: number;
  now?: () => number;
} = {}) {
  const hourlyLimit = options.hourlyLimit ?? overrideHourlyLimit();
  const hourMs = options.hourMs ?? HOUR_MS;
  const clock = typeof options.now === "function" ? options.now : Date.now;
  const hits: number[] = [];

  function prune(now: number) {
    const keepAfter = now - hourMs;
    while (hits.length && hits[0] < keepAfter) hits.shift();
  }

  function take() {
    const now = clock();
    prune(now);
    if (hits.length >= hourlyLimit) {
      throw new OverrideCapError();
    }
    hits.push(now);
    return true;
  }

  return {
    take,
    count: () => hits.length,
    hourlyLimit,
  };
}

let active = createOverrideBudget();

export function resetOverrideBudget(
  options?: Parameters<typeof createOverrideBudget>[0]
) {
  active = createOverrideBudget(options);
}

export function takeOverrideSlot(): boolean {
  return active.take();
}
