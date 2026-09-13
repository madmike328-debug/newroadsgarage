// netlify/functions/log-feedback.js
// Records a thumbs up/down (and optional comment) against an AI interaction
// that was already logged by photo-diagnosis.js or gemini-integration.js.

const { getStore } = require("@netlify/blobs");

const ALLOWED_ORIGIN = "https://newroadsgarage.com";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(event), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const referer = event.headers.referer || event.headers.origin || "";
  if (!referer.includes("newroadsgarage.com") && !referer.includes("localhost")) {
    return {
      statusCode: 403,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: "Forbidden" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const { interactionId, rating, comment = "" } = body;

  if (!interactionId || (rating !== 1 && rating !== -1)) {
    return {
      statusCode: 400,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: "interactionId and rating (1 or -1) are required" }),
    };
  }

  try {
    const store = getStore("nrg-analytics");
    const existing = await store.get(interactionId, { type: "json" });

    if (!existing) {
      // Interaction wasn't logged (or already expired) — nothing to attach feedback to.
      return {
        statusCode: 404,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: "Interaction not found" }),
      };
    }

    existing.satisfaction = rating;
    existing.feedbackComment = comment ? String(comment).slice(0, 500) : null;
    existing.feedbackAt = new Date().toISOString();

    await store.setJSON(interactionId, existing);

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("Feedback logging failed:", err);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

function corsHeaders(event) {
  const origin = event.headers.origin || "";
  const allowed =
    origin.includes("newroadsgarage.com") || origin.includes("localhost")
      ? origin
      : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
