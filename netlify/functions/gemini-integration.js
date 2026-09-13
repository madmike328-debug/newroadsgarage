// netlify/functions/gemini-integration.js// netlify/functions/gemini-integration.js
// Gemini 2.0 Flash proxy for New Roads Garage AI features (chat advisor)

const { getAnalyticsStore } = require("./lib/analytics-store");

const ALLOWED_ORIGIN = "https://newroadsgarage.com";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Referer lock - only allow requests from your domain
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

  const { messages = [], system = "" } = body;

  // Convert Anthropic-style messages to Gemini format
  const contents = messages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  const geminiPayload = {
    contents,
    ...(system && {
      systemInstruction: {
        parts: [{ text: system }],
      },
    }),
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.7,
    },
  };

  const interactionId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");

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
        lastUserMessage,
        status: "error",
        errorMessage: data.error?.message || "Gemini API error",
      });
      return {
        statusCode: response.status,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: data.error?.message || "Gemini API error" }),
      };
    }

    // Extract text from Gemini response
    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";

    await logInteraction({
      interactionId,
      lastUserMessage,
      status: "ok",
      responseLength: text.length,
    });

    // Return in a format compatible with existing frontend code
    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({
        interactionId,
        content: [{ type: "text", text }],
      }),
    };
  } catch (err) {
    console.error("Function error:", err);
    await logInteraction({
      interactionId,
      lastUserMessage,
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

async function logInteraction({ interactionId, lastUserMessage, status, responseLength, errorMessage }) {
  try {
    const store = getAnalyticsStore();
    const record = {
      id: interactionId,
      tool: "chat",
      timestamp: new Date().toISOString(),
      hadNote: Boolean(lastUserMessage && lastUserMessage.content),
      status,
      responseLength: responseLength || null,
      errorMessage: errorMessage || null,
      satisfaction: null,
      feedbackComment: null,
    };
    await store.setJSON(interactionId, record);

    const indexKey = "index";
    let index = [];
    try {
      index = (await store.get(indexKey, { type: "json" })) || [];
    } catch {
      index = [];
    }
    index.push(interactionId);
    if (index.length > 2000) index = index.slice(index.length - 2000);
    await store.setJSON(indexKey, index);
  } catch (err) {
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
