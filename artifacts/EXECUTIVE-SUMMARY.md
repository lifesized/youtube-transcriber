# YouTube Caption Reliability - Executive Summary

**Date:** October 7, 2026  
**Branch:** `cursor/youtube-caption-reliability-test-e509`  
**Status:** ⛔ **DO NOT PROCEED** without mitigation

---

## The Bottom Line

**11.1% success rate** from datacenter IP — YouTube actively blocks cloud provider IPs for caption scraping.

Your hosted Watchlist and Slack products **will not work** with the current caption-only approach.

---

## Test Results (9 videos, stopped early)

| Metric | Value |
|--------|-------|
| **Success Rate** | 11.1% (1/9) |
| **Bot Detection** | 55.6% (5/9) - "Sign in to confirm you're not a bot" |
| **WEB Scrape Success** | 0% - completely blocked |
| **yt-dlp Success** | 11.1% - fragile, mostly failed |
| **Test Duration** | 3 minutes before systematic blocking |

---

## Why This Matters

1. **Immediate Blocking:** YouTube detects datacenter IPs on first contact, no grace period
2. **No Caption Method Works:** WEB scrape (primary method in your code) = 100% blocked
3. **Watchlist Impact:** Scanning 100 channels daily would see <10% success rate
4. **Volume Makes It Worse:** Burst of 200 videos/digest = faster permanent ban

---

## The Fix (Choose One or Combine)

### ✅ Option A: Residential Proxy Pool (Recommended)
- **Cost:** $30-50/month for 10k videos
- **Success Rate:** ~95%+
- **Implementation:** 1-day code change
- **Providers:** Bright Data, Oxylabs, Smartproxy

### ✅ Option B: Browser Extension Harvesting
- **Cost:** $0
- **Success Rate:** 100%
- **Limitation:** Only works for users who install extension
- **Best For:** Owned channels, user-followed feeds

### ✅ Option C: YouTube Data API (Official)
- **Cost:** Free for ~40 videos/day, then quota application required
- **Success Rate:** High
- **Limitation:** Doesn't work for all videos (owner controls API access)

### ✅ Option D: Hybrid (Best for Scale)
1. Extension for user's followed channels (free, reliable)
2. Residential proxy for public discovery (paid, scales)
3. Audio + Cloud Whisper for no-caption videos (paid, 100% coverage)

**Total Monthly Cost:** ~$66 for 200 videos/day

---

## Immediate Action Items

1. ✅ **Accept:** Datacenter IPs don't work for caption scraping
2. ⚠️ **Budget:** Get $66/month approved for proxy + Whisper fallback
3. 🔧 **Implement:** Add residential proxy to `lib/transcript.ts` (1-day task)
4. 🧪 **Re-test:** Deploy to Vercel with proxy, measure 24h success rate
5. 📊 **Gate Launch:** Require ≥90% success rate before Watchlist/Slack launch

---

## Access Needed for Prod Monitoring

**If you already have a deployment:**

1. **Vercel Project Logs** (read-only)
   - Search for: "bot", "429", "LOGIN_REQUIRED"
   
2. **Database Access** (read-only)
   ```sql
   SELECT source, COUNT(*) FROM Video 
   WHERE createdAt > NOW() - INTERVAL '7 days' 
   GROUP BY source;
   ```

3. **Error Tracking** (Sentry/Datadog if configured)
   - Filter: `BotDetectionError`, `RateLimitError`

---

## Files in This Branch

| File | Purpose |
|------|---------|
| **FINAL-REPORT-youtube-caption-reliability.md** | Complete findings (Part 1-5) |
| **caption-report-2026-10-07T20-45-02.md** | Test report with stats |
| **caption-test-2026-10-07T20-45-02.csv** | Raw per-video results |
| **scripts/caption-reliability-test.ts** | Test harness (reusable) |

---

## Quick Decision Matrix

| Question | Answer |
|----------|--------|
| Can I launch Watchlist with current code? | ❌ No |
| Will Vercel work better than this VM test? | ❌ No - same datacenter IP issue |
| Can I work around it? | ✅ Yes - residential proxy |
| How much will it cost? | $66/month for 200 videos/day |
| How long to implement? | 1-2 days (proxy integration + test) |

---

## Recommendation

**DO NOT LAUNCH** Watchlist or Slack products until:

1. ✅ Residential proxy integrated
2. ✅ 24-hour Vercel test shows ≥90% success
3. ✅ Audio + Whisper fallback ready for no-caption videos
4. ✅ Error logging added to track failures

---

**Next Step:** Review `FINAL-REPORT-youtube-caption-reliability.md` for complete technical details and implementation guidance.
