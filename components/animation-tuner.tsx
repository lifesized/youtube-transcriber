/**
 * Animation Tuner — dev-only overlay for live-tweaking framer-motion spring animations.
 *
 * ## What it does
 * Provides sliders and an ease picker for every spring parameter used in the
 * transcript list: drawer open, drawer close, and row layout shift. Changes
 * apply instantly so you can see the effect in real time. When you find values
 * you like, hit "Copy Code" to get a paste-ready framer-motion transition block.
 *
 * ## How to use
 * 1. Run `npm run dev` — the tuner only renders in development (`NODE_ENV === "development"`).
 * 2. Press `Ctrl+Shift+T` to show the tuner (hidden by default).
 * 3. Click the "Tune" pill in the bottom-right corner to open the panel.
 * 3. Adjust sliders while opening/closing transcript rows to preview changes.
 * 4. Click "Copy Code" to copy the current config to your clipboard.
 * 5. Paste the values into the relevant `transition` props in `app/page.tsx`,
 *    or update `DEFAULT_DRAWER_OPEN` / `DEFAULT_DRAWER_CLOSE` in this file
 *    to persist new defaults.
 * 6. Click "Reset" to revert all sliders to the saved defaults.
 *
 * ## Adding new animations
 * To tune a new animation (e.g. a modal or toast):
 * 1. Add fields to `MotionTuning` and `DEFAULT_TUNING`.
 * 2. Add slider configs to the appropriate array (`DRAWER_SLIDERS`, `ROW_SLIDERS`, or a new one).
 * 3. Add a new section in the `renderDrawerGroup` pattern or create a similar render helper.
 * 4. Wire the new tuning values into the component's `transition` prop in `page.tsx`.
 *
 * ## Production
 * The tuner is gated behind `process.env.NODE_ENV === "development"` in `app/page.tsx`
 * and is tree-shaken from production builds. No need to gitignore.
 */
"use client";

import { useState, useCallback, useEffect } from "react";

export type EaseType = "easeIn" | "easeOut" | "easeInOut" | "linear";

export interface DrawerTuning {
  stiffness: number;
  damping: number;
  mass: number;
  opacityDuration: number;
  ease: EaseType;
}

export interface MotionTuning {
  drawerOpen: DrawerTuning;
  drawerClose: DrawerTuning;
  rowStiffness: number;
  rowDamping: number;
  rowMass: number;
}

const DEFAULT_DRAWER_OPEN: DrawerTuning = {
  stiffness: 550,
  damping: 5,
  mass: 0.1,
  opacityDuration: 1,
  ease: "easeOut",
};

const DEFAULT_DRAWER_CLOSE: DrawerTuning = {
  stiffness: 240,
  damping: 32,
  mass: 0.95,
  opacityDuration: 0.28,
  ease: "easeOut",
};

const EASE_OPTIONS: EaseType[] = ["easeIn", "easeOut", "easeInOut", "linear"];

export const DEFAULT_TUNING: MotionTuning = {
  drawerOpen: { ...DEFAULT_DRAWER_OPEN },
  drawerClose: { ...DEFAULT_DRAWER_CLOSE },
  rowStiffness: 120,
  rowDamping: 20,
  rowMass: 0.8,
};

interface DrawerSliderConfig {
  key: keyof DrawerTuning;
  label: string;
  min: number;
  max: number;
  step: number;
}

const DRAWER_SLIDERS: DrawerSliderConfig[] = [
  { key: "stiffness", label: "Stiffness", min: 50, max: 600, step: 5 },
  { key: "damping", label: "Damping", min: 5, max: 80, step: 1 },
  { key: "mass", label: "Mass", min: 0.1, max: 3, step: 0.05 },
  { key: "opacityDuration", label: "Opacity (s)", min: 0.05, max: 1, step: 0.01 },
];

interface RowSliderConfig {
  key: "rowStiffness" | "rowDamping" | "rowMass";
  label: string;
  min: number;
  max: number;
  step: number;
}

const ROW_SLIDERS: RowSliderConfig[] = [
  { key: "rowStiffness", label: "Stiffness", min: 50, max: 600, step: 5 },
  { key: "rowDamping", label: "Damping", min: 5, max: 80, step: 1 },
  { key: "rowMass", label: "Mass", min: 0.1, max: 3, step: 0.05 },
];

function generateCode(t: MotionTuning): string {
  const d = (dt: DrawerTuning, label: string) =>
    `// Drawer ${label}
transition={{
  height: {
    type: "spring",
    stiffness: ${dt.stiffness},
    damping: ${dt.damping},
    mass: ${dt.mass},
  },
  opacity: {
    duration: ${dt.opacityDuration},
    ease: "${dt.ease}",
  },
}}`;

  return `${d(t.drawerOpen, "open")}

${d(t.drawerClose, "close")}

// Row layout shift
transition={{
  layout: {
    type: "spring",
    stiffness: ${t.rowStiffness},
    damping: ${t.rowDamping},
    mass: ${t.rowMass},
  },
}}`;
}

export function AnimationTuner({
  tuning,
  onChange,
}: {
  tuning: MotionTuning;
  onChange: (t: MotionTuning) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Ctrl+Shift+T to toggle the tuner visibility
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "T") {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const setDrawer = useCallback(
    (phase: "drawerOpen" | "drawerClose", key: keyof DrawerTuning, value: number | string) => {
      onChange({ ...tuning, [phase]: { ...tuning[phase], [key]: value } });
    },
    [tuning, onChange]
  );

  const setRow = useCallback(
    (key: "rowStiffness" | "rowDamping" | "rowMass", value: number) => {
      onChange({ ...tuning, [key]: value });
    },
    [tuning, onChange]
  );

  const reset = useCallback(() => onChange({ ...DEFAULT_TUNING, drawerOpen: { ...DEFAULT_TUNING.drawerOpen }, drawerClose: { ...DEFAULT_TUNING.drawerClose } }), [onChange]);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(generateCode(tuning));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [tuning]);

  const sliderClass = "h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-white/60 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/70";

  const renderDrawerGroup = (label: string, phase: "drawerOpen" | "drawerClose") => (
    <div>
      <p className="mb-2 text-[10px] font-medium tracking-wider text-white/30 uppercase">
        {label}
      </p>
      <div className="space-y-2">
        {DRAWER_SLIDERS.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <label className="w-16 shrink-0 text-[11px] text-white/50">
              {s.label}
            </label>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={tuning[phase][s.key]}
              onChange={(e) => setDrawer(phase, s.key, parseFloat(e.target.value))}
              className={sliderClass}
            />
            <span className="w-10 text-right font-mono text-[10px] text-white/40">
              {tuning[phase][s.key]}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <label className="w-16 shrink-0 text-[11px] text-white/50">Ease</label>
          <select
            value={tuning[phase].ease}
            onChange={(e) => setDrawer(phase, "ease", e.target.value)}
            className="flex-1 rounded bg-white/5 px-2 py-0.5 text-[11px] text-white/60 border border-white/10 outline-none"
          >
            {EASE_OPTIONS.map((e) => (
              <option key={e} value={e} className="bg-[#1a1a1e] text-white/70">
                {e}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`fixed bottom-4 right-4 z-9999 flex flex-col items-end gap-2 ${!visible ? "hidden" : ""}`}>
      {open && (
        <div className="max-h-[80vh] w-72 overflow-y-auto rounded-xl border border-white/10 bg-[#1a1a1e]/95 p-4 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-white/60 uppercase">
              Animation Tuner
            </span>
            <button
              onClick={reset}
              className="rounded px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
            >
              Reset
            </button>
          </div>

          <div className="space-y-4">
            {renderDrawerGroup("Drawer Open", "drawerOpen")}

            <div className="border-t border-white/5" />

            {renderDrawerGroup("Drawer Close", "drawerClose")}

            <div className="border-t border-white/5" />

            <div>
              <p className="mb-2 text-[10px] font-medium tracking-wider text-white/30 uppercase">
                Row Layout
              </p>
              <div className="space-y-2">
                {ROW_SLIDERS.map((s) => (
                  <div key={s.key} className="flex items-center gap-2">
                    <label className="w-16 shrink-0 text-[11px] text-white/50">
                      {s.label}
                    </label>
                    <input
                      type="range"
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      value={tuning[s.key]}
                      onChange={(e) => setRow(s.key, parseFloat(e.target.value))}
                      className={sliderClass}
                    />
                    <span className="w-10 text-right font-mono text-[10px] text-white/40">
                      {tuning[s.key]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={copyCode}
            className="mt-4 w-full rounded-lg border border-white/8 bg-white/5 py-1.5 text-xs text-white/60 transition-all hover:bg-white/10 hover:text-white/80"
          >
            {copied ? "Copied!" : "Copy Code"}
          </button>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-[#1a1a1e]/90 px-3 shadow-lg backdrop-blur-xl transition-all hover:border-white/20 hover:bg-[#1a1a1e]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-white/50"
        >
          <path d="M10 3v14M3 10h14" style={{ display: open ? "none" : undefined }} />
          <path d="M4 4l12 12" style={{ display: open ? undefined : "none" }} />
        </svg>
        <span className="text-[11px] font-medium text-white/50">
          {open ? "Close" : "Tune"}
        </span>
      </button>
    </div>
  );
}
