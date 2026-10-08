"use strict";

/**
 * Friends-beta product defaults. James has not confirmed these yet.
 * Flip one constant to change the behaviour. Do not scatter the same
 * decision across files.
 */

module.exports = {
  // No auto-save after Transcribe. Chips stay manual for Oct 24.
  AUTO_SAVE_AFTER_TRANSCRIBE: false,
  // Obsidian writes Markdown files straight into the vault folder
  // (not the old obsidian:// URI path).
  OBSIDIAN_WRITE_MARKDOWN_TO_VAULT: true,
  // Re-saving updates the same note or page, keyed by video.
  RESAVE_UPDATES_SAME_NOTE: true,
  // Port conflict: name the holder. Never offer to quit it.
  PORT_CONFLICT_OFFER_QUIT: false,
  // Dark app icon (warm tile + gold dot). false would ship a light mark.
  DARK_APP_ICON: true,
  // Import Existing Library… only when a checkout library is detected.
  IMPORT_LIBRARY_ONLY_WHEN_DETECTED: true,
};
