// Runs in an offscreen document (chrome.offscreen), a real DOM context the
// MV3 background service worker doesn't have. Its only job here is to
// create Blob object URLs -- URL.createObjectURL is unavailable in some
// browsers' service worker context (confirmed missing in Edge, see
// DEVELOPMENT.md's v2.3.2 note), and encoding a large zip as a base64
// data: URL instead doesn't scale (v2.3.4's "RangeError: Invalid string
// length" on a ~500MB combined zip). A Blob never needs to become a single
// giant string, so this has no realistic size ceiling.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_MAKE_BLOB_URL") {
    const blob = new Blob([message.bytes], { type: message.mimeType || "application/octet-stream" });
    sendResponse({ url: URL.createObjectURL(blob) });
    return false;
  }
  if (message.type === "OFFSCREEN_REVOKE_BLOB_URL") {
    URL.revokeObjectURL(message.url);
    return false;
  }
});
