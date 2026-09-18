(function exposeStartupPolicy(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TranscriberStartupPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createStartupPolicy() {
  function withTimeout(promise, timeoutMs, fallback, onLate) {
    return new Promise((resolve) => {
      let settled = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        timedOut = true;
        resolve(fallback);
      }, timeoutMs);

      Promise.resolve(promise).then(
        (value) => {
          if (settled) {
            if (timedOut && typeof onLate === "function") onLate(value);
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      );
    });
  }

  function recentRefreshAction(response) {
    if (!response?.success) return "preserve";
    if (!Array.isArray(response.data)) return "preserve";
    return response.data.length ? "replace" : "clear";
  }

  return { withTimeout, recentRefreshAction };
});
