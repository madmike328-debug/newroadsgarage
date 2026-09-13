// netlify/functions/analytics-dashboard.js
// Simple password-gated dashboard: how much the AI tools are being used,
// and how happy customers are with them (thumbs up/down + comments).
// View it at: https://newroadsgarage.com/.netlify/functions/analytics-dashboard?key=YOUR_KEY

const { getAnalyticsStore } = require("./lib/analytics-store");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const dashboardKey = process.env.ANALYTICS_DASHBOARD_KEY;
  const providedKey = event.queryStringParameters?.key || "";

  if (!dashboardKey) {
    return {
      statusCode: 500,
      body: "ANALYTICS_DASHBOARD_KEY is not set in Netlify environment variables.",
    };
  }

  if (providedKey !== dashboardKey) {
    return { statusCode: 401, body: "Unauthorized. Add ?key=YOUR_KEY to the URL." };
  }

  const store = getAnalyticsStore();
  let index = [];
  try {
    index = (await store.get("index", { type: "json" })) || [];
  } catch {
    index = [];
  }

  const records = [];
  for (const id of index.slice().reverse()) {
    try {
      const rec = await store.get(id, { type: "json" });
      if (rec) records.push(rec);
    } catch {
      // skip unreadable record
    }
  }

  const byTool = {};
  let totalRated = 0;
  let totalUp = 0;
  const comments = [];

  for (const r of records) {
    const tool = r.tool || "unknown";
    byTool[tool] = byTool[tool] || { count: 0, errors: 0, rated: 0, up: 0 };
    byTool[tool].count += 1;
    if (r.status === "error") byTool[tool].errors += 1;
    if (r.satisfaction === 1 || r.satisfaction === -1) {
      byTool[tool].rated += 1;
      totalRated += 1;
      if (r.satisfaction === 1) {
        byTool[tool].up += 1;
        totalUp += 1;
      }
    }
    if (r.feedbackComment) {
      comments.push({
        tool,
        rating: r.satisfaction,
        comment: r.feedbackComment,
        timestamp: r.feedbackAt || r.timestamp,
      });
    }
  }

  const overallSatisfaction = totalRated > 0 ? Math.round((totalUp / totalRated) * 100) : null;

  const toolRows = Object.entries(byTool)
    .map(([tool, s]) => {
      const satPct = s.rated > 0 ? Math.round((s.up / s.rated) * 100) : null;
      return `<tr>
        <td>${escapeHtml(tool)}</td>
        <td>${s.count}</td>
        <td>${s.errors}</td>
        <td>${s.rated}</td>
        <td>${satPct !== null ? satPct + "%" : "—"}</td>
      </tr>`;
    })
    .join("");

  const commentRows = comments
    .slice(0, 50)
    .map(
      (c) => `<tr>
        <td>${c.rating === 1 ? "👍" : "👎"}</td>
        <td>${escapeHtml(c.tool)}</td>
        <td>${escapeHtml(c.comment)}</td>
        <td>${escapeHtml(new Date(c.timestamp).toLocaleString())}</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>NRG AI Tools — Activity & Satisfaction</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0A0A0A;color:#f2f2f2;padding:2rem;max-width:900px;margin:0 auto;}
  h1{color:#E8A020;font-size:1.6rem;}
  .stat-cards{display:flex;gap:1rem;flex-wrap:wrap;margin:1.5rem 0;}
  .card{background:#161616;border:1px solid #2a2a2a;border-radius:10px;padding:1rem 1.4rem;min-width:140px;}
  .card .num{font-size:1.8rem;font-weight:800;color:#E8A020;}
  .card .lbl{font-size:0.8rem;color:#999;text-transform:uppercase;letter-spacing:0.05em;}
  table{width:100%;border-collapse:collapse;margin-top:0.5rem;}
  th,td{text-align:left;padding:0.5rem 0.7rem;border-bottom:1px solid #222;font-size:0.9rem;}
  th{color:#E8A020;font-size:0.75rem;text-transform:uppercase;}
  h2{margin-top:2.5rem;font-size:1.1rem;color:#ddd;}
</style>
</head>
<body>
  <h1>New Roads Garage — AI Tools Activity</h1>
  <div class="stat-cards">
    <div class="card"><div class="num">${records.length}</div><div class="lbl">Total Interactions</div></div>
    <div class="card"><div class="num">${totalRated}</div><div class="lbl">Rated by Customers</div></div>
    <div class="card"><div class="num">${overallSatisfaction !== null ? overallSatisfaction + "%" : "—"}</div><div class="lbl">Overall Satisfaction</div></div>
  </div>

  <h2>By Tool</h2>
  <table>
    <tr><th>Tool</th><th>Uses</th><th>Errors</th><th>Rated</th><th>Satisfaction</th></tr>
    ${toolRows || '<tr><td colspan="5">No data yet</td></tr>'}
  </table>

  <h2>Recent Comments</h2>
  <table>
    <tr><th>Rating</th><th>Tool</th><th>Comment</th><th>When</th></tr>
    ${commentRows || '<tr><td colspan="4">No comments yet</td></tr>'}
  </table>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=UTF-8" },
    body: html,
  };
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
