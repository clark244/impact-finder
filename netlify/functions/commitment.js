// netlify/functions/commitment.js
//
// Impact Commitment Finder — server-side extraction.
//
// Key behavior (the fix):
//   • When the user provides a URL, we FETCH that URL (and a few common
//     sub-pages) ourselves and hand the real page text to the model.
//   • We do NOT decide a company "doesn't exist" because a search index
//     has no entry for it. A live page that returns text is sufficient
//     source material, regardless of whether any search engine indexed it.
//   • Only when no URL is given AND we cannot locate a page do we fall back
//     to "not stated" with an honest explanation.
//
// The browser never sees the API key; it lives in ANTHROPIC_API_KEY here.

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

// Sub-pages worth checking when only a root domain is supplied.
// These are where mission/outcome statements usually live (Rule 2.3).
const SUBPATHS = ["", "about", "mission", "impact", "our-mission", "company", "what-we-do"];

const FETCH_TIMEOUT_MS = 8000;
const MAX_CHARS_PER_PAGE = 12000;
const MAX_TOTAL_CHARS = 40000;

function normalizeRoot(rawUrl, companyName) {
  let u = (rawUrl || "").trim();
  if (!u && companyName) return null; // no URL given; caller handles fallback
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    return parsed;
  } catch {
    return null;
  }
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Identify as a normal browser; many sites serve empty shells to
        // unknown agents. We are reading public marketing copy only.
        "User-Agent":
          "Mozilla/5.0 (compatible; ImpactCommitmentFinder/1.0; +https://cobalt.example)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return { url, ok: false, status: res.status, text: "" };
    const html = await res.text();
    return { url, ok: true, status: res.status, text: htmlToText(html) };
  } catch (err) {
    clearTimeout(timer);
    return { url, ok: false, status: 0, text: "", error: String(err) };
  }
}

// Minimal HTML-to-text: strip scripts/styles/tags, collapse whitespace.
// Good enough to hand readable marketing copy to the model.
function htmlToText(html) {
  if (!html) return "";
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|li|h[1-6]|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&mdash;/gi, "—")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  if (t.length > MAX_CHARS_PER_PAGE) t = t.slice(0, MAX_CHARS_PER_PAGE);
  return t;
}

// Collect page text from the provided site. Returns { pages, totalChars }.
async function collectSiteText(rootUrl) {
  const origin = rootUrl.origin;
  const candidates = SUBPATHS.map((p) =>
    p ? `${origin}/${p.replace(/^\//, "")}` : origin
  );
  // Always include the exact URL the user typed (may be a deep link).
  const exact = rootUrl.href;
  if (!candidates.includes(exact)) candidates.unshift(exact);

  const results = await Promise.all(candidates.map((c) => fetchPage(c)));
  const pages = [];
  let total = 0;
  for (const r of results) {
    if (r.ok && r.text && r.text.length > 80) {
      // skip near-empty shells
      if (total + r.text.length > MAX_TOTAL_CHARS) continue;
      pages.push({ url: r.url, text: r.text });
      total += r.text.length;
    }
  }
  return { pages, totalChars: total };
}

const SYSTEM_PROMPT = `You extract a company's stated impact commitment from its own public web copy.

An impact commitment has three slots:
- Beneficiary: who the product/service is intended to help
- Mechanism: how the product/service actually works
- Intended outcome: the positive non-monetary change it aims to produce for the beneficiary

Rules:
1. Record only what the company claims. Do not evaluate, rank, or fact-check.
2. Keep mechanism (what it does) separate from outcome (the change it produces). Do not put one in the other's slot.
3. Any stated outcome counts, including modest ones like "saves time." Do not upgrade or dismiss it.
3a. An outcome is often NOT written as a separate "so that..." sentence. It frequently hangs off the mechanism as a participle or trailing clause — e.g. "...provides practice in X, BUILDING the communication skills students need" or "...a platform that does X, HELPING teachers do Y." When you see "building / developing / improving / strengthening / reducing / increasing [something for the beneficiary]" attached to a mechanism description, that trailing part is the INTENDED OUTCOME. Split it out into the outcome slot; do not leave the whole sentence sitting in the mechanism slot.

   Worked example WHERE AN OUTCOME IS PRESENT:
     Page text: "structured practice in constructive disagreement—building the communication and critical thinking skills students need."
     mechanism = "structured practice in constructive disagreement"
     outcome   = "build students' communication and critical thinking skills"

   Worked example WHERE NO OUTCOME IS STATED (do not invent one):
     Page text: "An AI tool that analyzes essays and flags grammar errors."
     mechanism = "an AI tool that analyzes essays and flags grammar errors"
     outcome   = "not stated"   (the page names no change it intends to produce; do NOT infer "improves writing")

   The difference: in the first, the page explicitly names a change for the beneficiary. In the second, it only describes what the tool does. Only fill the outcome slot when the page actually names a change. When in doubt, "not stated" is correct.
4. If a product names multiple beneficiaries (e.g. teachers AND students), capture the outcome for each.
5. If a slot is genuinely not stated anywhere in the provided text, write exactly "not stated". Never invent a beneficiary, mechanism, or outcome.
6. Quote sparingly: at most one short verbatim phrase (under 15 words) per source page, in quotation marks. Paraphrase everything else.

You will be given the actual text of the company's pages. Base your answer ONLY on that text. The text was fetched directly from the live site; its presence or absence in any search engine is irrelevant and must not factor into your judgment.

Respond with ONLY a JSON object, no preamble or markdown fences:
{
  "found": true,
  "confidence": "high" | "medium" | "low",
  "beneficiary": "... or 'not stated'",
  "mechanism": "... or 'not stated'",
  "outcome": "... or 'not stated'",
  "sentence": "For [beneficiary]: [mechanism], intended to [outcome].",
  "anchor_quote": "short verbatim phrase in quotes, or empty string",
  "sources": ["url1", "url2"],
  "note": "any caveat about multiple audiences, missing slots, or ambiguity"
}

Set "found": false ONLY if the provided page text is empty or contains no information about any product or service. If you received real page text, you have source material — use it.`;

async function callModel(company, pageText, sources) {
  const userContent = `Company (as entered by user): ${company || "(not provided)"}

Source pages fetched directly from the live site:
${sources.map((s, i) => `--- PAGE ${i + 1}: ${s} ---`).join("\n")}

PAGE TEXT:
${pageText}`;

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "anthropic-request-failed");
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .replace(/```json|```/g, "")
    .trim();
  return JSON.parse(text);
}

function notFoundPayload(company, site, reason) {
  return {
    found: false,
    confidence: "low",
    beneficiary: "not stated",
    mechanism: "not stated",
    outcome: "not stated",
    sentence: "not stated",
    anchor_quote: "",
    sources: site ? [site] : [],
    note: reason,
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "method-not-allowed" }) };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "missing-api-key" }) };
  }

  let company = "";
  let url = "";
  try {
    const body = JSON.parse(event.body || "{}");
    company = (body.company || "").trim();
    url = (body.url || "").trim();
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "bad-request" }) };
  }

  if (!company && !url) {
    return { statusCode: 400, body: JSON.stringify({ error: "no-input" }) };
  }

  const root = normalizeRoot(url, company);

  // If a URL was provided, fetch it directly. This is the core fix: a live
  // page is read regardless of search-engine indexing.
  if (root) {
    const { pages, totalChars } = await collectSiteText(root);

    if (pages.length === 0 || totalChars < 80) {
      // The site was provided but returned nothing readable. This is an
      // honest "couldn't read the page" — distinct from "company isn't real".
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          notFoundPayload(
            company,
            root.href,
            `The page at ${root.href} was provided but returned no readable text (it may be down, JavaScript-rendered, or behind a login). The commitment may still exist on the live site — try opening it manually, or provide a specific sub-page URL.`
          )
        ),
      };
    }

    const combined = pages
      .map((p) => `[${p.url}]\n${p.text}`)
      .join("\n\n");
    const sources = pages.map((p) => p.url);

    try {
      const result = await callModel(company, combined, sources);
      if (!result.sources || result.sources.length === 0) result.sources = sources;
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      };
    } catch (err) {
      return { statusCode: 502, body: JSON.stringify({ error: String(err.message || err) }) };
    }
  }

  // No URL provided: ask the model to use its own web tools to find the site.
  // (Unchanged fallback path — only reached when the user gives a name alone.)
  try {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [
          {
            role: "user",
            content: `No URL was provided. Find the official website for "${company}", read its public pages (landing, about, mission, impact), and extract the impact commitment per the rules. If you cannot locate an official site for this specific company, set found:false and explain — but do not confuse a different company of a similar name for this one.`,
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || "anthropic-request-failed");
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .replace(/```json|```/g, "")
      .trim();
    const result = JSON.parse(text);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        notFoundPayload(
          company,
          "",
          `Could not automatically locate a website for "${company}". Try entering the website URL in the optional field.`
        )
      ),
    };
  }
}
