// netlify/functions/commitment.js
// Server-side proxy. Holds the Anthropic API key (never exposed to the browser),
// runs the documented impact-commitment extraction, and returns the parsed result.

const SYSTEM_PROMPT = `You extract a company's stated IMPACT COMMITMENT from its public web communications, following a strict documented procedure. An impact commitment has three slots:
- beneficiary: who the product/service is meant to help
- mechanism: how it works (what it actually does)
- intendedOutcome: the positive non-monetary change it is meant to produce for the beneficiary

RULES (apply in order):
1. Record what the company CLAIMS, not whether it is true. Do not evaluate, rank, or fact-check.
2. Do not confuse mechanism (what it does) with outcome (the change it produces). Keep them in their correct slots.
3. Any stated outcome counts, including modest ones (e.g. "saves time"). Do not upgrade or dismiss it.
4. Look beyond the landing page: check About/Mission/Impact/product pages. Record which page each part came from.
5. If a product names multiple beneficiaries (e.g. teachers AND students), capture the outcome for each.
6. If, after checking the main pages, a slot is genuinely not stated anywhere, set it to "not stated". An honest blank beats an inferred guess. Never invent a slot the company did not put in writing.
7. Quote sparingly: at most one short verbatim phrase (under ~15 words) per source page, in quotes. Paraphrase everything else. Always record source URLs.

Compose the one-sentence commitment in the form: "For [beneficiary]: [mechanism], intended to [outcome]." Make it a single, clean sentence.

You MUST use web search to find the company's official site and supporting pages before answering. Start from the official domain, not a directory or news article. If you cannot confidently identify the company or its site, say so honestly.

Respond ONLY with a JSON object (no markdown, no backticks, no preamble) with exactly these keys:
{
  "companyResolved": "the specific company name and what it does, so the user can confirm you found the right one",
  "website": "primary domain or 'not found'",
  "beneficiary": "... or 'not stated'",
  "mechanism": "... or 'not stated'",
  "intendedOutcome": "... or 'not stated'",
  "oneSentence": "the composed one-sentence commitment",
  "anchorQuote": "one short verbatim phrase in quotes, or '' if none",
  "sources": ["url1", "url2"],
  "confidence": "high | medium | low",
  "ambiguityNote": "if the name is ambiguous or a slot was hard to call, explain briefly; else ''"
}`;

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Server is missing ANTHROPIC_API_KEY." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let company = "";
  let url = "";
  try {
    const body = await req.json();
    company = (body.company || "").trim();
    url = (body.url || "").trim();
  } catch {
    return new Response(JSON.stringify({ error: "Bad request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!company) {
    return new Response(JSON.stringify({ error: "Company name is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userContent = url
    ? `Find and compose the impact commitment for: ${company}. Their website is ${url} — start there and check its supporting pages (About/Mission/Impact/product).`
    : `Find and compose the impact commitment for: ${company}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return new Response(
        JSON.stringify({ error: "Upstream API error.", detail }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return new Response(
        JSON.stringify({ error: "Could not parse a result." }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const parsed = JSON.parse(clean.slice(start, end + 1));
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Request failed.", detail: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
