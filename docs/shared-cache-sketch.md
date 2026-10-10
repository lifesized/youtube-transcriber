# Shared Transcript Cache — Post-Launch Sketch

**Status**: Design only, not implemented  
**When**: Post-launch, if metrics justify (track: same-video transcription rate, datacenter bot-block rate)

---

## Problem

Users transcribe the same popular videos independently:
- Duplicate work (caption fetch + Whisper)
- Hosted service hits YouTube from datacenter IPs → bot detection, 403s
- No benefit from cached work across users

## Solution Sketch

A **shared cache** where users' apps (residential IPs) contribute PUBLIC-video transcripts, and other users + hosted service read cache-first.

**Flow**:
```
User A (home IP) → Fetch transcript → Verify PUBLIC → Sign → Cache
                                                              ↓
User B / Hosted → Check cache → HIT: serve (no YouTube fetch)
                             → MISS: fetch from YouTube
```

**Benefits**: Reduces YouTube fetch load, routes around datacenter bot blocks

---

## Rules

### 1. Public Videos Only
- Verify via YouTube oEmbed (`200` + embeddable = PUBLIC, else reject)
- Private/unlisted never cached
- Users' local apps cache private videos **locally only**

### 2. No User Data
- **Allowed**: Video metadata (title, author), transcript segments, pipeline version
- **Forbidden**: User ID, notes, summaries with user prompts, base summaries

### 3. YouTube ToS Risk
- **Issue**: YouTube ToS prohibits redistribution. Caching public captions/Whisper output may be acceptable (similar to browser caches, RSS readers), but **needs legal review before enabling**.
- **Worst case**: Cease-and-desist → disable shared cache, fall back to per-user fetching

### 4. Poisoning Prevention
- **App signing**: Each app instance signs contributions; cache verifies signatures
- **Multi-contributor agreement**: Require N=3 matching signatures for popular videos before accepting
- **Rate limits**: 100 videos/day per app, 1 MB max transcript size
- **Caption ETag tracking**: Cache key includes YouTube caption track ETag → auto-invalidate when creator edits

### 5. Invalidation
- **Primary**: Caption track ETag (changes when captions updated)
- **Fallback**: 30-day TTL with revalidation

---

## Implementation Phases

1. **Local cache only** (current) — Per-user cache with proper keys ✓
2. **Shared cache read-only** — Hosted service pre-populates top videos; users read only
3. **User contributions** — Apps upload PUBLIC videos with signatures + verification
4. **Advanced** — ETag tracking, LRU eviction, abuse detection

---

## Alternatives Considered

- **P2P (IPFS)**: Too complex for users, hard to enforce public-only
- **Browser sync**: Helps same user only, not cross-user
- **Pay-per-transcript**: Adds payment friction, premature for OSS

---

## Open Questions

1. **Hosting**: Cloudflare KV ($0.50/GB/mo) vs Railway Redis vs S3?
2. **Legal**: Does caching public captions violate YouTube ToS? Consult lawyer before enabling.
3. **Popularity threshold**: When to require multi-contributor agreement (>10 hits/week)?
4. **Cache size**: 100k videos = ~100 GB — affordable?

---

**Not a launch blocker.** Local caching solves most problems. Build shared cache only if metrics show:
- High same-video transcription rate (>10% overlap)
- Hosted service bot-block rate >5%
