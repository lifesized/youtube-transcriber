# Shared Transcript Cache — Post-Launch Sketch

**Status**: Design sketch only, not implemented  
**Purpose**: Reduce duplicate transcription work across users, route around datacenter bot detection  
**Target**: Post-launch optimization when user base grows

---

## Problem

Today (March 2026), every user transcribes every video independently:

- **User A** transcribes "Popular Tutorial Video" → hits YouTube from their home IP
- **User B** transcribes the same video 5 minutes later → hits YouTube again from their IP
- **Hosted service** (for users without local install) transcribes it a third time → hits YouTube from Railway datacenter IP, gets bot-detected and blocked

This is wasteful and fragile:

1. **Waste**: Duplicate transcription work (caption fetch + optional Whisper) for popular videos
2. **Bot detection**: Datacenter IPs get blocked more aggressively than residential IPs
3. **Rate limits**: Hosted service burns through quota faster

---

## Solution: Shared Cache for Public Videos

A **shared hosted cache** where:

1. **Users' apps** (running on home/office IPs with good reputation) fetch transcripts and **contribute PUBLIC-video transcripts** to the shared cache
2. **Other users** and the **hosted service** check the shared cache **first** before fetching from YouTube
3. Cache entries are validated, signed, and deduplicated

This routes around bot detection because cache **writes** happen from residential IPs (which YouTube trusts), while cache **reads** avoid hitting YouTube entirely.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  User A (home IP)                                            │
│  ┌────────────────┐                                         │
│  │ Local App      │  1. Fetch transcript for videoId=abc   │
│  │                │     (captions or Whisper)               │
│  └────────┬───────┘                                         │
│           │                                                  │
│           │ 2. Check if video is PUBLIC (via oEmbed)        │
│           │                                                  │
│           ↓                                                  │
│  ┌────────────────┐                                         │
│  │ Is PUBLIC?     │  → Yes (embeddable, not private/       │
│  │                │     unlisted)                           │
│  └────────┬───────┘                                         │
│           │                                                  │
│           │ 3. Sign transcript + metadata                   │
│           │    (video ID, caption track ETag, pipeline      │
│           │     version, timestamp, app version)            │
│           │                                                  │
│           ↓                                                  │
│  ┌────────────────┐                                         │
│  │ POST /api/     │  4. Contribute to shared cache          │
│  │ cache/put      │     (signed, public videos only)        │
│  └────────┬───────┘                                         │
└────────────┼─────────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────────┐
│  Shared Cache Service (hosted, e.g. Railway/Cloudflare KV)  │
│  ┌────────────────┐                                         │
│  │ Validate:      │  - Signature valid (from known app      │
│  │                │    instance)?                            │
│  │                │  - Video is PUBLIC (recheck oEmbed)?    │
│  │                │  - No user data in payload?             │
│  │                │  - Caption track ETag matches?          │
│  └────────┬───────┘                                         │
│           │                                                  │
│           ↓                                                  │
│  ┌────────────────┐                                         │
│  │ Store:         │  Key: (videoId, captionLang,           │
│  │                │       pipelineVersion, captionETag)     │
│  │                │  Value: { transcript, metadata,         │
│  │                │           signatures[], createdAt }     │
│  │                │  TTL: 30 days (invalidate on YouTube    │
│  │                │       caption update)                   │
│  └────────────────┘                                         │
└─────────────────────────────────────────────────────────────┘
             │
             │ Later: User B or hosted service
             ↓
┌─────────────────────────────────────────────────────────────┐
│  User B / Hosted Service                                     │
│  ┌────────────────┐                                         │
│  │ 1. GET /api/   │  Lookup: (videoId, lang, pipeline       │
│  │    cache/get   │           version)                      │
│  └────────┬───────┘                                         │
│           │                                                  │
│           ↓                                                  │
│  ┌────────────────┐                                         │
│  │ Cache HIT?     │  → Yes: return transcript (fast!)       │
│  │                │  → No: fetch from YouTube (slow,        │
│  │                │     may get bot-blocked if datacenter)  │
│  └────────────────┘                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Design Rules

### 1. Public Videos Only

**Rule**: Only cache transcripts for videos that are **publicly embeddable**.

**Verification**:

- Check YouTube oEmbed endpoint: `https://www.youtube.com/oembed?url=...`
  - If returns 200 + embeddable: PUBLIC
  - If returns 401/403/404 or `"private": true`: NOT PUBLIC, **do not cache**
- Private/unlisted videos are **never contributed** to the shared cache
- Users' local apps cache private videos **locally only** (not shared)

**Why**: YouTube Terms of Service prohibit redistributing private content. Shared cache entries are effectively redistribution, so we must verify public availability before accepting.

---

### 2. No User Data in Shared Cache

**Rule**: Shared cache entries contain **no user-identifying or user-generated content**.

**Allowed**:

- Video metadata from YouTube (title, author, channel, thumbnail — all public)
- Transcript segments (caption text + timestamps from YouTube or Whisper output)
- Pipeline version, caption language, source (e.g. "youtube_captions_ytdlp")
- Signature (app instance ID, not user ID)

**Forbidden**:

- User ID, email, account info
- User notes, tags, custom titles
- Summaries generated with user-provided prompts (e.g. "Summarize for a 5-year-old")
- Slack workspace content, team mentions, private links
- Base summaries (cached **locally** only, keyed to transcript + prompt version)

**Why**: Privacy + GDPR. Shared cache is a public data structure — anyone can read it. Only store public YouTube data.

---

### 3. YouTube Terms of Service and Redistribution Risk

**Risk**: YouTube ToS Section 4B prohibits "accessing, reproducing, downloading, distributing, transmitting, broadcasting, displaying, selling, licensing, altering, modifying or otherwise using any part of the Service or Content except ... as expressly authorized by the Service."

**Mitigation**:

- Shared cache stores **only public captions** or **Whisper-generated transcripts** (not YouTube's proprietary audio/video)
- Captions are text-only, not copyrighted by YouTube (generated or provided by creators)
- Cache is not a general-purpose mirror — only serves Transcriber app users (like a CDN caching public data)
- If YouTube objects, we can disable shared cache and fall back to per-user fetching

**Precedent**: RSS readers, podcast apps, browser caches all cache/redistribute public content. As long as we're not circumventing access controls (paywall, private videos), we're in the clear.

**Worst case**: YouTube sends cease-and-desist → we shut down shared cache, no legal liability (good-faith caching of public content).

---

### 4. Poisoning and Abuse Prevention

**Threats**:

1. **Malicious contributor**: Submits fake/tampered transcript for a video
2. **Spam**: Floods cache with garbage entries
3. **Denial of service**: Submits huge transcripts to exhaust storage

**Mitigations**:

#### A. Contributor Trust

- **App signing**: Each app instance has a private key, signs contributions with public key
- **Signature verification**: Cache service verifies signature before accepting
- **Revocation list**: If an app instance is compromised or misbehaves, add its public key to a revocation list (reject future contributions)

#### B. Multi-Contributor Agreement

- **Require N signatures** before accepting a cache entry (N=3 for popular videos, N=1 for rare videos)
- If App A contributes transcript X and App B contributes transcript Y for the same video, cache service:
  1. Compares transcripts (fuzzy match, allow minor whitespace/timestamp diffs)
  2. If match: accept (consensus)
  3. If conflict: flag for manual review, **do not serve** until resolved
- This prevents a single bad actor from poisoning the cache

#### C. Rate Limits

- Limit contributions per app instance: **100 videos/day** (prevents spam)
- Limit transcript size: **1 MB max** (prevents DoS)
- Limit cache growth: **Top 100k most-requested videos only** (LRU eviction)

#### D. Caption Track ETag

- YouTube caption tracks have ETags (change when captions are updated by creator)
- Cache key includes ETag: `(videoId, lang, pipelineVersion, captionETag)`
- When captions change, ETag changes → cache miss → re-fetch (automatic invalidation)
- Prevents serving stale captions after creator edits

---

### 5. Invalidation When Captions Change

**Problem**: Video creator uploads new captions or edits existing ones. Cached transcript is now stale.

**Solutions**:

#### A. Caption Track ETag (Primary)

- Include YouTube caption track ETag in cache key
- When user requests transcript:
  1. Fetch caption track list (fast, ~200ms)
  2. Get ETag for selected language
  3. Lookup cache: `(videoId, lang, pipelineVersion, captionETag)`
  4. Cache hit → serve (captions haven't changed)
  5. Cache miss → fetch new captions, contribute to cache with new ETag

**Tradeoff**: Adds a YouTube API call per cache lookup (but avoids full caption fetch if cached)

#### B. TTL with Revalidation (Fallback)

- Cache entries expire after **30 days**
- On expiry, next user re-fetches from YouTube and updates cache
- Slower to detect changes, but simpler (no ETag lookup)

#### C. Hybrid Approach (Recommended)

- Use ETag for popular videos (high cache hit rate justifies the API call)
- Use TTL for rare videos (low hit rate, not worth ETag overhead)
- Popularity threshold: **>10 cache hits in last 7 days**

---

### 6. Implementation Phases

#### Phase 1: Local Cache Only (Current)

- Each user's app caches transcripts locally with proper cache keys
- No shared cache yet
- **Already implemented** in YTT-439

#### Phase 2: Shared Cache (Read-Only)

- Hosted service provides a shared cache API
- Users' apps **read** from shared cache (no writes yet)
- Hosted service pre-populates cache with popular videos (top YouTube Trending, top tutorials)
- Datacenter IP bot detection problem reduced (fewer YouTube fetches from Railway)

#### Phase 3: Shared Cache (Contributions)

- Users' apps **contribute** to shared cache after fetching a video
- Requires app signing, signature verification, public-video checks
- Multi-contributor agreement for popular videos (N=3)

#### Phase 4: Advanced Features

- Caption ETag tracking
- LRU eviction (keep top 100k videos only)
- Popularity-based invalidation strategy
- Abuse detection (anomaly detection on contributions)

---

## Privacy + Security Summary

| Aspect | Risk | Mitigation |
|--------|------|------------|
| **User privacy** | Shared cache could leak user activity | Only cache PUBLIC videos; no user IDs in cache |
| **Private videos** | User transcribes private video, leaked to cache | Verify oEmbed before caching; reject private/unlisted |
| **User notes/summaries** | User data mixed with transcript | **Never** cache user-generated content; only YouTube metadata + transcript |
| **Poisoning** | Malicious user submits fake transcript | Multi-contributor agreement (N signatures), signature verification |
| **Spam** | Flood cache with garbage | Rate limits (100 videos/day per app), size limits (1 MB) |
| **Stale captions** | Creator edits captions, cache serves old version | Caption track ETag in cache key; 30-day TTL fallback |
| **YouTube ToS** | Redistribution of YouTube content | Only public captions/Whisper output (not audio/video); disable on cease-and-desist |

---

## Open Questions for Post-Launch

1. **Hosting**: Cloudflare Workers KV (fast, global), Railway Redis (simpler), or S3 (cheap)?
2. **Signature scheme**: Ed25519 (fast, small), RSA (widely supported), or HMAC (simpler but less secure)?
3. **Popularity threshold**: How many cache hits/day before requiring multi-contributor agreement?
4. **ETag overhead**: Is fetching caption track list on every lookup too slow? (Adds ~200ms latency)
5. **Cache size**: 100k videos = ~100 GB (1 MB average). Affordable on Cloudflare KV (~$0.50/GB/mo)?
6. **Legal review**: Should we consult a lawyer before enabling shared cache?

---

## Alternatives Considered

### Alternative 1: P2P Cache (IPFS, BitTorrent)

**Idea**: Store transcripts on IPFS or BitTorrent, users seed entries they fetch.

**Pros**: Decentralized, censorship-resistant, no hosting cost

**Cons**:

- Requires NAT traversal, firewall config (most users behind NAT)
- Slow cold-start (no seeders for rare videos)
- Hard to enforce public-only policy (no central validation)
- Complex for average user (not "just works")

**Verdict**: Too complex for v1. Revisit if centralized cache has legal/scaling issues.

---

### Alternative 2: Browser Extension Cache Sync

**Idea**: Extension stores transcripts in browser storage, syncs across devices via Chrome Sync API.

**Pros**: No server required, private to user, fast

**Cons**:

- Only helps the same user across devices (no cross-user benefit)
- Chrome Sync quota is tiny (100 KB for extensions)
- Doesn't solve datacenter IP bot detection

**Verdict**: Good for user convenience, but not a replacement for shared cache.

---

### Alternative 3: Pay-Per-Transcript API

**Idea**: Users pay $0.01 per transcript, funds a cache that serves everyone.

**Pros**: Self-funding, aligns incentives (popular videos cached faster)

**Cons**:

- Adds payment friction (most users won't pay)
- Requires payment processing (Stripe, taxes, etc.)
- Still need bot-detection workarounds

**Verdict**: Interesting for SaaS model, but premature. Free shared cache is simpler for open-source project.

---

## Conclusion

A **shared transcript cache for public videos only**, contributed by users' apps running on residential IPs, can:

1. Reduce duplicate transcription work (saves compute + quota)
2. Route around datacenter bot detection (writes from home IPs, reads from cache)
3. Improve hosted service reliability (fewer YouTube fetches = fewer 403s)

**Critical constraints**:

- **Public videos only** (verify oEmbed before caching)
- **No user data** in shared entries (privacy + GDPR)
- **Multi-contributor agreement** for popular videos (prevent poisoning)
- **Caption ETag tracking** or TTL expiry (invalidate stale entries)

**Not a launch blocker** — local caching (YTT-439) solves most problems. Shared cache is a post-launch optimization for when the user base grows and datacenter IP problems intensify.

**Next steps** (post-launch):

1. Monitor: How often do users transcribe the same video within 24h? (Justifies shared cache)
2. Monitor: How often does hosted service get bot-blocked? (Justifies IP routing)
3. Build Phase 2 (read-only shared cache) if metrics justify it
4. Legal review before enabling contributions (Phase 3)
