/**
 * electron-builder afterSign hook.
 * 
 * This is called after code signing is done.
 * For unsigned builds, this is essentially a no-op.
 * 
 * When moving to signed builds (Phase S), notarization would happen here.
 */

module.exports = async function(context) {
  const { appOutDir, electronPlatformName } = context;
  
  console.log("Running afterSign hook...");
  console.log("  Platform:", electronPlatformName);
  console.log("  Output dir:", appOutDir);
  
  // For unsigned beta, nothing to do here
  console.log("  Skipping notarization (unsigned build)");
};
