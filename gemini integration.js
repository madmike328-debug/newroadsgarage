// netlify/functions/claude.js
// Gemini 2.0 Flash proxy for New Roads Garage AI features

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

  // Referer lock — only allow requests from your domain
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

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", JSON.stringify(data));
      return {
        statusCode: response.status,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: data.error?.message || "Gemini API error" }),
      };
    }

    // Extract text from Gemini response
    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";

    // Return in a format compatible with existing frontend code
    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({
        content: [{ type: "text", text }],
      }),
    };
  } catch (err) {
    console.error("Function error:", err);
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
