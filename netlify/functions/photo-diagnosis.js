// netlify/functions/photo-diagnosis.js
// AI photo diagnosis tool for New Roads Garage.
// Customer uploads a photo of a vehicle issue (warning light, leak, tire wear, etc.)
// Gemini 2.0 Flash (multimodal) returns a plain-English read on what it might be.
// Every request is logged to Netlify Blobs for activity/satisfaction tracking.

const { getStore } = require("@netlify/blobs");

const ALLOWED_ORIGIN = "https://newroadsgarage.com";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT =
  "You are the AI photo-diagnosis assistant for New Roads Garage, a drop-off-only auto repair shop in Ann Arbor, Michigan. " +
  "A customer has uploaded a photo of something they're concerned about (dashboard warning light, fluid leak, tire wear, unusual noise-causing part, etc.), " +
  "optionally with a short note describing the problem. " +
  "Look at the photo and: " +
  "1) Name what you see in plain English. " +
  "2) Give 1-3 likely explanations, ordered by likelihood, described simply (no dense technical jargon). " +
  "3) Give an honest urgency read: 'safe to drive, but get it looked at soon' / 'stop driving and get it towed' / etc. " +
  "4) Always close by recommending a free drop-off diagnostic at New Roads Garage for a certain answer, since this is only a preliminary AI read, not a certified diagnosis. " +
  "Keep the whole response under 150 words, friendly and direct. If the photo is unclear, unrelated to a vehicle, or you can't tell what it shows, say so honestly and suggest a clearer photo or a free in-person diagnostic instead of guessing.";

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: "API key not configured" }),
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

  const { imageBase64 = "", mimeType = "image/jpeg", note = "" } = body;

  if (!imageBase64) {
    return {
      statusCode: 400,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: "No image provided" }),
    };
  }

  // Cap payload size (roughly 6MB base64 ~= 4.5MB image) to avoid abuse / oversized requests
  if (imageBase64.length > 8_000_000) {
    return {
      statusCode: 413,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: "Image too large. Please upload a smaller photo." }),
    };
  }

  const userText = note && note.trim()
    ? `Customer's note: "${note.trim()}"`
    : "No note provided by the customer — just look at the photo.";

  const geminiPayload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: userText },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      },
    ],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      maxOutputTokens: 400,
      temperature: 0.4,
    },
  };

  const interactionId = `pd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", JSON.stringify(data));
      await logInteraction({
        interactionId,
        note,
        status: "error",
        errorMessage: data.error?.message || "Gemini API error",
      });
      return {
        statusCode: response.status,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: data.error?.message || "Gemini API error" }),
      };
    }

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I couldn't analyze that photo. Please try a clearer image or give us a call.";

    await logInteraction({
      interactionId,
      note,
      status: "ok",
      responseLength: text.length,
    });

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({ interactionId, diagnosis: text }),
    };
  } catch (err) {
    console.error("Function error:", err);
    await logInteraction({
      interactionId,
      note,
      status: "error",
      errorMessage: String(err),
    });
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

async function logInteraction({ interactionId, note, status, responseLength, errorMessage }) {
  try {
    const store = getStore("nrg-analytics");
    const record = {
      id: interactionId,
      tool: "photo_diagnosis",
      timestamp: new Date().toISOString(),
      hadNote: Boolean(note && note.trim()),
      status,
      responseLength: responseLength || null,
      errorMessage: errorMessage || null,
      satisfaction: null, // filled in later by log-feedback.js if the customer rates it
      feedbackComment: null,
    };
    await store.setJSON(interactionId, record);

    // Maintain a lightweight index of interaction IDs so the dashboard can list them
    // without needing a paid blob-listing tier.
    const indexKey = "index";
    let index = [];
    try {
      index = (await store.get(indexKey, { type: "json" })) || [];
    } catch {
      index = [];
    }
    index.push(interactionId);
    // Keep the index from growing unbounded — cap at the most recent 2000 interactions.
    if (index.length > 2000) index = index.slice(index.length - 2000);
    await store.setJSON(indexKey, index);
  } catch (err) {
    // Never let analytics logging break the customer-facing feature.
    console.error("Analytics logging failed:", err);
  }
}

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
