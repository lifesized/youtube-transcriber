/**
 * Manages the Next.js standalone server lifecycle.
 * 
 * Responsibilities:
 * - Spawn the server using Electron's own Node binary (ELECTRON_RUN_AS_NODE=1)
 * - Health check polling until ready
 * - Auto-restart on crash with exponential backoff
 * - Detect port conflicts
 * - Graceful shutdown
 */

const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { ensureInEnv, getStateDir } = require("../lib/local-api-token.js");

const HEALTH_CHECK_INTERVAL = 500;
const HEALTH_CHECK_TIMEOUT = 1500;
const MAX_START_ATTEMPTS = 3;
const RESTART_BACKOFF_MS = 2000;

class ServerManager extends EventEmitter {
  constructor(options) {
    super();
    this.port = options.port;
    this.appRoot = options.appRoot;
    this.standaloneServer = options.standaloneServer;
    this.extraResources = options.extraResources;
    this.isDev = options.isDev;
    
    this.process = null;
    this.status = "stopped";
    this.healthCheckInterval = null;
    this.restartAttempts = 0;
    this.startTime = null;
  }
  
  isRunning() {
    return this.status === "running";
  }
  
  getStatus() {
    return {
      status: this.status,
      port: this.port,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      pid: this.process?.pid,
    };
  }
  
  async start() {
    if (this.status === "running" || this.status === "starting") {
      console.log("Server already running or starting");
      return;
    }
    
    // Check if port is already in use
    const portInUse = await this._checkPort();
    if (portInUse) {
      this._setStatus("port-conflict");
      throw new Error(`Port ${this.port} is already in use by another process`);
    }
    
    this._setStatus("starting");
    
    try {
      await this._spawn();
      await this._waitForHealth();
      this._setStatus("running");
      this.startTime = Date.now();
      this.restartAttempts = 0;
      console.log("Server started successfully");
    } catch (error) {
      this._setStatus("error");
      throw error;
    }
  }
  
  async stop() {
    if (!this.process) {
      this._setStatus("stopped");
      return;
    }
    
    console.log("Stopping server...");
    this._setStatus("stopping");
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn("Server did not stop gracefully, killing...");
        if (this.process) {
          this.process.kill("SIGKILL");
        }
        resolve();
      }, 5000);
      
      if (this.process) {
        this.process.once("exit", () => {
          clearTimeout(timeout);
          this.process = null;
          this._setStatus("stopped");
          this.startTime = null;
          resolve();
        });
        
        this.process.kill("SIGTERM");
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });
  }
  
  async restart() {
    await this.stop();
    await this._sleep(1000);
    await this.start();
  }
  
  // Private methods
  
  _setStatus(status) {
    if (this.status !== status) {
      this.status = status;
      this.emit("status-change", status);
    }
  }
  
  async _spawn() {
    // Ensure local API token exists and is in env
    ensureInEnv();
    
    // Build env vars
    const env = {
      ...process.env,
      NODE_ENV: this.isDev ? "development" : "production",
      PORT: String(this.port),
      HOSTNAME: "127.0.0.1",
      TRANSCRIBER_LOCAL_TOKEN: process.env.TRANSCRIBER_LOCAL_TOKEN,
    };
    
    // Add paths to bundled binaries (ffmpeg, yt-dlp)
    const binPath = path.join(this.extraResources, "bin");
    if (fs.existsSync(binPath)) {
      env.PATH = `${binPath}:${env.PATH || ""}`;
      env.FFMPEG_PATH = path.join(binPath, "ffmpeg");
      env.YTDLP_PATH = path.join(binPath, "yt-dlp");
    }
    
    // Set database path
    const dbPath = path.join(getStateDir(), "transcriber.db");
    env.DATABASE_URL = `file:${dbPath}`;
    
    console.log("Spawning server...");
    console.log("  Node:", process.execPath);
    console.log("  App root:", this.appRoot);
    console.log("  Port:", this.port);
    console.log("  Database:", dbPath);
    
    if (this.isDev) {
      // In dev, spawn npm run dev
      const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
      this.process = spawn(npmBin, ["run", "dev"], {
        cwd: this.appRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      // In production, use Electron's Node to run the standalone server
      // with ELECTRON_RUN_AS_NODE=1
      this.process = spawn(process.execPath, [
        this.standaloneServer,
        "-p", String(this.port),
        "--hostname", "127.0.0.1",
      ], {
        cwd: this.appRoot,
        env: {
          ...env,
          ELECTRON_RUN_AS_NODE: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    
    this.process.stdout.on("data", (data) => {
      console.log("[server]", data.toString().trim());
    });
    
    this.process.stderr.on("data", (data) => {
      console.error("[server]", data.toString().trim());
    });
    
    this.process.on("error", (error) => {
      console.error("Server process error:", error);
      this._handleCrash();
    });
    
    this.process.on("exit", (code, signal) => {
      console.log(`Server exited with code ${code}, signal ${signal}`);
      this.process = null;
      if (this.status === "running") {
        this._handleCrash();
      }
    });
  }
  
  async _checkPort() {
    return new Promise((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${this.port}/api/health`,
        { timeout: 1000 },
        () => {
          req.destroy();
          resolve(true);
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
  }
  
  async _waitForHealth() {
    const maxAttempts = 60; // 30 seconds
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      const healthy = await this._checkHealth();
      if (healthy) {
        return;
      }
      
      if (!this.process) {
        throw new Error("Server process died during startup");
      }
      
      attempts++;
      await this._sleep(HEALTH_CHECK_INTERVAL);
    }
    
    throw new Error("Server failed to become healthy within timeout");
  }
  
  async _checkHealth() {
    return new Promise((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${this.port}/api/health`,
        { timeout: HEALTH_CHECK_TIMEOUT },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => {
            resolve(res.statusCode === 200);
          });
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
  }
  
  async _handleCrash() {
    console.error("Server crashed!");
    this._setStatus("error");
    
    if (this.restartAttempts < MAX_START_ATTEMPTS) {
      this.restartAttempts++;
      const delay = RESTART_BACKOFF_MS * Math.pow(2, this.restartAttempts - 1);
      console.log(`Restarting in ${delay}ms (attempt ${this.restartAttempts}/${MAX_START_ATTEMPTS})...`);
      await this._sleep(delay);
      
      try {
        await this.start();
      } catch (error) {
        console.error("Restart failed:", error);
      }
    } else {
      console.error("Max restart attempts reached");
    }
  }
  
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = ServerManager;
