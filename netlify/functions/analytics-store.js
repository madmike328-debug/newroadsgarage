// netlify/functions/lib/analytics-store.js
// Wraps @netlify/blobs getStore() with a manual-config fallback.
//
// On some deploys, Netlify doesn't auto-inject the Blobs environment
// (MissingBlobsEnvironmentError). When that happens, set these two
// environment variables in Netlify (Site settings -> Environment variables):
//   NETLIFY_BLOBS_SITE_ID  - Site settings -> General -> Site details -> Site ID
//   NETLIFY_BLOBS_TOKEN    - User settings -> Applications -> New access token
// If both are present, we use them explicitly. Otherwise we fall back to
// the automatic zero-config behavior.

const { getStore } = require("@netlify/blobs");

function getAnalyticsStore() {
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;

  if (siteID && token) {
    return getStore({ name: "nrg-analytics", siteID, token });
  }

  return getStore("nrg-analytics");
}

module.exports = { getAnalyticsStore };
