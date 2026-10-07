#!/usr/bin/env tsx
/**
 * YouTube Caption Reliability Test - Server-Side Methods
 * 
 * Tests the exact caption fetching methods that would run on a
 * hosted deployment (Vercel/similar) from a datacenter IP.
 * 
 * Focus: Caption availability only (no paid STT).
 */

import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

type TestResult = {
  videoId: string;
  category: string;
  url: string;
  method: string;
  success: boolean;
  errorType?: string;
  errorMessage?: string;
  latencyMs: number;
  segmentCount?: number;
  timestamp: string;
};

type VideoSpec = {
  url: string;
  videoId: string;
  category: string;
  description: string;
};

/**
 * Build a diverse test set (~100 videos)
 */
function buildVideoTestSet(): VideoSpec[] {
  return [
    // POPULAR / MAINSTREAM
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ", category: "popular", description: "Rick Astley - Never Gonna Give You Up" },
    { url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk", videoId: "kJQP7kiw5Fk", category: "popular", description: "Luis Fonsi - Despacito" },
    { url: "https://www.youtube.com/watch?v=9bZkp7q19f0", videoId: "9bZkp7q19f0", category: "popular", description: "PSY - GANGNAM STYLE" },
    { url: "https://www.youtube.com/watch?v=JGwWNGJdvx8", videoId: "JGwWNGJdvx8", category: "popular", description: "Ed Sheeran - Shape of You" },
    { url: "https://www.youtube.com/watch?v=CevxZvSJLk8", videoId: "CevxZvSJLk8", category: "popular", description: "Katy Perry - Roar" },
    
    // TECH / EDUCATIONAL
    { url: "https://www.youtube.com/watch?v=QH2-TGUlwu4", videoId: "QH2-TGUlwu4", category: "tech", description: "Computerphile video" },
    { url: "https://www.youtube.com/watch?v=l3hfbPEEdzk", videoId: "l3hfbPEEdzk", category: "tech", description: "Tom Scott video" },
    { url: "https://www.youtube.com/watch?v=cPLXTrqlXhE", videoId: "cPLXTrqlXhE", category: "tech", description: "3Blue1Brown video" },
    { url: "https://www.youtube.com/watch?v=p_di4Zn4wz4", videoId: "p_di4Zn4wz4", category: "tech", description: "Fireship video" },
    { url: "https://www.youtube.com/watch?v=RBSGKlAvoiM", videoId: "RBSGKlAvoiM", category: "tech", description: "Theo - t3.gg" },
    { url: "https://www.youtube.com/watch?v=Mus_vwhTCq0", videoId: "Mus_vwhTCq0", category: "tech", description: "ThePrimeagen" },
    { url: "https://www.youtube.com/watch?v=xXyUxhG3Jqs", videoId: "xXyUxhG3Jqs", category: "tech", description: "Web Dev Simplified" },
    { url: "https://www.youtube.com/watch?v=KGC1ky1Bp1o", videoId: "KGC1ky1Bp1o", category: "tech", description: "Ben Awad" },
    
    // SHORT VIDEOS
    { url: "https://www.youtube.com/watch?v=OPf0YbXqDm0", videoId: "OPf0YbXqDm0", category: "short", description: "Mark Rober short" },
    { url: "https://www.youtube.com/watch?v=i9AHJkHqkpw", videoId: "i9AHJkHqkpw", category: "short", description: "SmarterEveryDay short" },
    
    // LONG VIDEOS
    { url: "https://www.youtube.com/watch?v=_eRRab36XLI", videoId: "_eRRab36XLI", category: "long", description: "Lex Fridman podcast" },
    { url: "https://www.youtube.com/watch?v=Vhh_GeBPOhs", videoId: "Vhh_GeBPOhs", category: "long", description: "Huberman Lab podcast" },
    
    // MUSIC
    { url: "https://www.youtube.com/watch?v=fJ9rUzIMcZQ", videoId: "fJ9rUzIMcZQ", category: "music", description: "Queen - Bohemian Rhapsody" },
    { url: "https://www.youtube.com/watch?v=pAgnJDJN4VA", videoId: "pAgnJDJN4VA", category: "music", description: "Avicii - Wake Me Up" },
    { url: "https://www.youtube.com/watch?v=YQHsXMglC9A", videoId: "YQHsXMglC9A", category: "music", description: "Adele - Hello" },
    { url: "https://www.youtube.com/watch?v=nfWlot6h_JM", videoId: "nfWlot6h_JM", category: "music", description: "Taylor Swift (Vevo)" },
    
    // NON-ENGLISH
    { url: "https://www.youtube.com/watch?v=BuW_7sktdBc", videoId: "BuW_7sktdBc", category: "non-english", description: "Japanese" },
    { url: "https://www.youtube.com/watch?v=cMg8KaMdDYo", videoId: "cMg8KaMdDYo", category: "non-english", description: "Spanish" },
    { url: "https://www.youtube.com/watch?v=5K3G5fs9Zpc", videoId: "5K3G5fs9Zpc", category: "non-english", description: "Korean" },
    { url: "https://www.youtube.com/watch?v=M4ZoCHID9GI", videoId: "M4ZoCHID9GI", category: "non-english", description: "French" },
    { url: "https://www.youtube.com/watch?v=DDU-rZs-Ic4", videoId: "DDU-rZs-Ic4", category: "non-english", description: "German" },
    
    // NEWS / EDUCATIONAL
    { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", videoId: "jNQXAC9IVRw", category: "news", description: "Me at the zoo (first YT)" },
    
    // GAMING
    { url: "https://www.youtube.com/watch?v=2Tj_rF7JKsQ", videoId: "2Tj_rF7JKsQ", category: "gaming", description: "Minecraft" },
    
    // OLD VIDEOS
    { url: "https://www.youtube.com/watch?v=OQSNhk5ICTI", videoId: "OQSNhk5ICTI", category: "old", description: "Evolution of Dance (2006)" },
    { url: "https://www.youtube.com/watch?v=_OBlgSz8sSM", videoId: "_OBlgSz8sSM", category: "old", description: "Charlie bit my finger" },
  ];
}

/**
 * Jittered delay (10-40s as specified)
 */
async function jitteredDelay() {
  const delayMs = 10000 + Math.random() * 30000;
  const delaySec = (delayMs / 1000).toFixed(1);
  process.stdout.write(`  → Waiting ${delaySec}s...\r`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
  process.stdout.write("                        \r");
}

/**
 * Test Method 1: WEB page scrape
 */
async function testWebScrape(videoId: string): Promise<{ success: boolean; segments?: number; error?: string }> {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetch(watchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });
    
    if (response.status === 429) {
      return { success: false, error: "rate_limit_429" };
    }
    
    if (!response.ok) {
      return { success: false, error: `http_${response.status}` };
    }
    
    const html = await response.text();
    
    // Check for bot detection
    if (html.includes("Sign in to confirm you") || html.includes("not a bot")) {
      return { success: false, error: "bot_detection" };
    }
    
    // Try to extract ytInitialPlayerResponse
    const jsonMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});\s*(?:<\/script>|var\s)/);
    if (!jsonMatch) {
      return { success: false, error: "no_player_response" };
    }
    
    const playerData = JSON.parse(jsonMatch[1]);
    
    if (playerData.playabilityStatus?.status === "LOGIN_REQUIRED") {
      return { success: false, error: "login_required" };
    }
    
    const captions = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captions || captions.length === 0) {
      return { success: false, error: "no_captions" };
    }
    
    // Try to fetch the caption track
    const track = captions[0];
    const captionRes = await fetch(track.baseUrl, { signal: AbortSignal.timeout(10000) });
    
    if (captionRes.status === 429) {
      return { success: false, error: "caption_rate_limit_429" };
    }
    
    if (!captionRes.ok) {
      return { success: false, error: `caption_http_${captionRes.status}` };
    }
    
    const xml = await captionRes.text();
    if (!xml.trim()) {
      return { success: false, error: "empty_captions" };
    }
    
    // Count segments (rough estimate)
    const segments = (xml.match(/<text/g) || []).length + (xml.match(/<p t=/g) || []).length;
    
    return { success: true, segments };
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === "TimeoutError") {
        return { success: false, error: "timeout" };
      }
      if (err.message.includes("JSON")) {
        return { success: false, error: "json_parse_error" };
      }
    }
    return { success: false, error: "exception" };
  }
}

/**
 * Test Method 2: yt-dlp subtitles
 */
async function testYtdlp(videoId: string): Promise<{ success: boolean; segments?: number; error?: string }> {
  try {
    const ytdlpPath = "/home/ubuntu/.local/bin/yt-dlp";
    const tmpDir = `/tmp/yt-test-${Date.now()}`;
    await fs.mkdir(tmpDir, { recursive: true });
    
    const outputTemplate = path.join(tmpDir, videoId);
    
    const { stderr } = await execFileAsync(
      ytdlpPath,
      [
        "--write-auto-subs",
        "--write-subs",
        "--sub-lang", "en",
        "--sub-format", "vtt",
        "--skip-download",
        "--no-playlist",
        "-o", outputTemplate,
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: 30000 }
    );
    
    // Check for error messages in stderr
    if (stderr.includes("429") || stderr.includes("rate") || stderr.includes("Too Many Requests")) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      return { success: false, error: "rate_limit" };
    }
    
    if (stderr.includes("not available") || stderr.includes("no subtitles")) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      return { success: false, error: "no_subs_available" };
    }
    
    // Look for downloaded file
    const files = await fs.readdir(tmpDir);
    const vttFile = files.find(f => f.includes(videoId) && f.endsWith(".vtt"));
    
    if (!vttFile) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      return { success: false, error: "no_file_downloaded" };
    }
    
    const content = await fs.readFile(path.join(tmpDir, vttFile), "utf-8");
    const segments = (content.match(/\n\d{2}:\d{2}:\d{2}\.\d{3}\s+-->/g) || []).length;
    
    await fs.rm(tmpDir, { recursive: true, force: true });
    
    return { success: true, segments };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message.slice(0, 50) : "exception" };
  }
}

/**
 * Test a single video with all methods
 */
async function testVideo(spec: VideoSpec): Promise<TestResult> {
  const startTime = Date.now();
  
  console.log(`\n[${spec.category.toUpperCase()}] ${spec.description}`);
  console.log(`  Video ID: ${spec.videoId}`);
  
  // Try WEB scrape first (fastest, most reliable for manual captions)
  process.stdout.write("  Testing WEB scrape... ");
  const webStart = Date.now();
  const webResult = await testWebScrape(spec.videoId);
  const webLatency = Date.now() - webStart;
  
  if (webResult.success) {
    console.log(`✓ (${webLatency}ms, ${webResult.segments} segments)`);
    return {
      videoId: spec.videoId,
      category: spec.category,
      url: spec.url,
      method: "web_scrape",
      success: true,
      latencyMs: Date.now() - startTime,
      segmentCount: webResult.segments,
      timestamp: new Date().toISOString(),
    };
  } else {
    console.log(`✗ ${webResult.error} (${webLatency}ms)`);
    
    // If bot detection or rate limit, don't try other methods
    if (webResult.error === "bot_detection" || webResult.error?.includes("rate_limit")) {
      return {
        videoId: spec.videoId,
        category: spec.category,
        url: spec.url,
        method: "web_scrape",
        success: false,
        errorType: webResult.error,
        errorMessage: webResult.error,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }
  
  // Try yt-dlp
  process.stdout.write("  Testing yt-dlp... ");
  const ytdlpStart = Date.now();
  const ytdlpResult = await testYtdlp(spec.videoId);
  const ytdlpLatency = Date.now() - ytdlpStart;
  
  if (ytdlpResult.success) {
    console.log(`✓ (${ytdlpLatency}ms, ${ytdlpResult.segments} segments)`);
    return {
      videoId: spec.videoId,
      category: spec.category,
      url: spec.url,
      method: "yt-dlp",
      success: true,
      latencyMs: Date.now() - startTime,
      segmentCount: ytdlpResult.segments,
      timestamp: new Date().toISOString(),
    };
  } else {
    console.log(`✗ ${ytdlpResult.error} (${ytdlpLatency}ms)`);
  }
  
  // All methods failed
  return {
    videoId: spec.videoId,
    category: spec.category,
    url: spec.url,
    method: "none",
    success: false,
    errorType: ytdlpResult.error || webResult.error,
    errorMessage: `WEB: ${webResult.error}, yt-dlp: ${ytdlpResult.error}`,
    latencyMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Main runner
 */
async function main() {
  const videos = buildVideoTestSet();
  const results: TestResult[] = [];
  
  console.log("=".repeat(80));
  console.log("YouTube Caption Reliability Test - Server-Side Methods");
  console.log("=".repeat(80));
  console.log(`Environment: Cloud Agent VM (datacenter IP)`);
  console.log(`Videos: ${videos.length}`);
  console.log(`Methods: WEB scrape, yt-dlp subtitles`);
  console.log(`Rate limiting: 10-40s jittered delay between requests`);
  console.log("=".repeat(80));
  
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 5;
  
  for (let i = 0; i < videos.length; i++) {
    console.log(`\n[${i + 1}/${videos.length}]`);
    
    const result = await testVideo(videos[i]);
    results.push(result);
    
    // Check for systematic bot detection
    if (result.errorType === "bot_detection" || result.errorType?.includes("rate_limit_429")) {
      consecutiveFailures++;
      console.log(`\n  ⚠️  Bot/rate failures: ${consecutiveFailures}/${maxConsecutiveFailures}`);
      
      if (consecutiveFailures >= maxConsecutiveFailures) {
        console.log("\n" + "=".repeat(80));
        console.log("⛔ STOPPING: Systematic bot detection / rate limiting");
        console.log("This is a key finding - datacenter IPs are being blocked by YouTube");
        console.log("=".repeat(80));
        break;
      }
    } else if (result.success) {
      consecutiveFailures = 0;
    }
    
    // Jittered delay
    if (i < videos.length - 1 && consecutiveFailures < maxConsecutiveFailures) {
      await jitteredDelay();
    }
  }
  
  // Save results
  const artifactsDir = path.join(process.cwd(), "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const csvPath = path.join(artifactsDir, `caption-test-${timestamp}.csv`);
  const reportPath = path.join(artifactsDir, `caption-report-${timestamp}.md`);
  
  // CSV
  const csvHeader = "videoId,category,url,method,success,errorType,errorMessage,latencyMs,segmentCount,timestamp\n";
  const csvRows = results.map(r =>
    `${r.videoId},"${r.category}","${r.url}","${r.method}",${r.success},"${r.errorType || ""}","${(r.errorMessage || "").replace(/"/g, '""')}",${r.latencyMs},${r.segmentCount || ""},"${r.timestamp}"`
  ).join("\n");
  await fs.writeFile(csvPath, csvHeader + csvRows);
  
  // Report
  const report = generateReport(results);
  await fs.writeFile(reportPath, report);
  
  console.log("\n" + "=".repeat(80));
  console.log("Test Complete");
  console.log("=".repeat(80));
  console.log(`Results saved:`);
  console.log(`  CSV:    ${csvPath}`);
  console.log(`  Report: ${reportPath}`);
  console.log("=".repeat(80));
  
  // Print quick summary
  const successful = results.filter(r => r.success).length;
  const total = results.length;
  console.log(`\nQuick Summary: ${successful}/${total} successful (${((successful/total)*100).toFixed(1)}%)`);
}

/**
 * Generate markdown report
 */
function generateReport(results: TestResult[]): string {
  const total = results.length;
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  const categories = [...new Set(results.map(r => r.category))];
  const categoryStats = categories.map(cat => {
    const catResults = results.filter(r => r.category === cat);
    const catSuccess = catResults.filter(r => r.success);
    return {
      category: cat,
      total: catResults.length,
      success: catSuccess.length,
      rate: catResults.length > 0 ? ((catSuccess.length / catResults.length) * 100).toFixed(1) : "0.0",
    };
  }).sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate));
  
  const errorTypes = failed.reduce((acc, r) => {
    const type = r.errorType || "unknown";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const methods = successful.reduce((acc, r) => {
    acc[r.method] = (acc[r.method] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const latencies = results.filter(r => r.latencyMs).map(r => r.latencyMs).sort((a, b) => a - b);
  const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
  const p90 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.9)] : 0;
  
  const botDetections = failed.filter(r => r.errorType === "bot_detection" || r.errorType?.includes("login_required")).length;
  const rateLimits = failed.filter(r => r.errorType?.includes("rate_limit") || r.errorType?.includes("429")).length;
  
  return `# YouTube Caption Reliability Test Report

**Date:** ${new Date().toISOString().split('T')[0]}  
**Environment:** Cloud Agent VM (datacenter IP)  
**Videos Tested:** ${total}

---

## Executive Summary

### Overall Success Rate
**${((successful.length / total) * 100).toFixed(1)}%** (${successful.length}/${total})

### Key Findings
- **Bot Detection Failures:** ${botDetections} (${((botDetections / total) * 100).toFixed(1)}%)
- **Rate Limit Failures:** ${rateLimits} (${((rateLimits / total) * 100).toFixed(1)}%)
- **No Captions Available:** ${failed.filter(r => r.errorType === "no_captions" || r.errorType === "no_subs_available").length}

### Latency
- **p50:** ${p50}ms
- **p90:** ${p90}ms

---

## Success Rate by Category

| Category | Success | Total | Rate |
|----------|---------|-------|------|
${categoryStats.map(s => `| ${s.category} | ${s.success}/${s.total} | ${s.rate}% |`).join("\n")}

---

## Failure Breakdown

| Error Type | Count | % of Failures |
|------------|-------|---------------|
${Object.entries(errorTypes)
  .sort((a, b) => b[1] - a[1])
  .map(([type, count]) => `| ${type} | ${count} | ${((count / failed.length) * 100).toFixed(1)}% |`)
  .join("\n")}

---

## Successful Methods

| Method | Count | % of Success |
|--------|-------|--------------|
${Object.entries(methods)
  .sort((a, b) => b[1] - a[1])
  .map(([method, count]) => `| ${method} | ${count} | ${((count / successful.length) * 100).toFixed(1)}% |`)
  .join("\n")}

---

## Detailed Analysis

### Bot Detection / Rate Limiting
${botDetections + rateLimits > 0 ? `
**Critical Finding:** ${botDetections + rateLimits} videos (${(((botDetections + rateLimits) / total) * 100).toFixed(1)}%) failed due to YouTube blocking datacenter IPs.

This indicates that:
1. YouTube actively detects and blocks datacenter/cloud provider IPs
2. A hosted Watchlist service would face significant reliability issues
3. Mitigation strategies required: residential proxies, browser extension approach, or YouTube Data API
` : "No systematic bot detection observed - datacenter IP is not being blocked"}

### Caption Availability
Genuine "no captions" failures (video owner disabled captions): ${failed.filter(r => r.errorType === "no_captions" || r.errorType === "no_subs_available").length}

---

## Sample Failures

${failed.slice(0, 10).map(r => `### ${r.videoId} (${r.category})
- **Error:** ${r.errorType}
- **Details:** ${r.errorMessage?.slice(0, 150)}
- **Latency:** ${r.latencyMs}ms
`).join("\n")}

${failed.length > 10 ? `\n*(${failed.length - 10} more failures - see CSV)*\n` : ""}

---

## Recommendations

${botDetections + rateLimits > total * 0.1 ? `
### ⚠️  HIGH RISK - DO NOT PROCEED WITHOUT MITIGATION

Success rate of ${((successful.length / total) * 100).toFixed(1)}% is too low for production.

**Recommended Mitigations:**
1. **Residential Proxy Pool** - Route requests through residential IPs (costs ~$10-50/month for moderate volume)
2. **Browser Extension Approach** - Fetch captions client-side from user's browser (no datacenter IP)
3. **YouTube Data API** - Use official API with captions endpoint (requires API key, quotas apply)
4. **Hybrid Approach** - Extension for owned channels + proxy for public videos

` : `
### ✓ PROCEED WITH CAUTION

Success rate of ${((successful.length / total) * 100).toFixed(1)}% is acceptable but monitor production.

**Recommended Fallbacks:**
1. Implement automatic retry with backoff
2. Monitor error rates per IP/region
3. Have audio+STT fallback ready
`}

---

## Production Monitoring Requirements

To measure PROD reliability, James needs access to:

1. **Vercel/Hosting Logs** (read-only)
   - Log drain or dashboard access
   - Filter by API route: \`/api/transcripts\`
   - Look for 429, 403, bot detection errors

2. **Database Read Access**
   - Query success rates: \`SELECT source, COUNT(*) FROM Video WHERE createdAt > ? GROUP BY source\`
   - Query failures: Check application logs for failed transcript attempts

3. **Error Tracking** (if configured)
   - Sentry/Datadog/similar dashboard access
   - Filter by error types: RateLimitError, BotDetectionError, NoCaptionsError

4. **YouTube Data API Quota** (if using official API)
   - Google Cloud Console project access
   - API & Services → Quotas dashboard

---

*Test executed from Cloud Agent VM - datacenter IP may behave differently than production Vercel deployment.*
*This is a proxy test - production monitoring is required for true reliability assessment.*
`;
}

main().catch(err => {
  console.error("\n\nFatal error:", err);
  process.exit(1);
});
