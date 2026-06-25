import React, { useState, useRef } from "react";

// ── Impact Commitment Finder ──────────────────────────────────────────────
// Browser calls /api/commitment (Netlify function holding the API key).
// Every result is an unverified first-pass draft needing human review.

export default function App() {
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef(null);

  async function run() {
    const query = company.trim();
    const site = url.trim();
    if (!query) return;
    setStatus("loading");
    setResult(null);
    setErrorMsg("");

    try {
      const response = await fetch("/api/commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: query, url: site }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "request-failed");

      setResult(data);
      setStatus("done");
    } catch (err) {
      setErrorMsg(
        "The lookup didn't return a usable result. Try the full company name, or add the website in the optional field."
      );
      setStatus("error");
    }
  }

  const notStated = (v) => !v || v.trim().toLowerCase() === "not stated";

  return (
    <div className="page">
      <header className="masthead">
        <div className="brandRow">
          <img className="logo" src="/cobalt-logo.png" alt="Cobalt" />
          <span className="brandName">Cobalt</span>
          <span className="brandDivider" aria-hidden="true" />
          <span className="kicker">Impact Commitment Finder</span>
        </div>
        <h1>
          What does a company <em>say</em> it does for the world?
        </h1>
      </header>

      <section className="console">
        <div className="fields">
          <input
            ref={inputRef}
            className="field"
            type="text"
            placeholder="Company name"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            aria-label="Company name"
          />
          <input
            className="field"
            type="text"
            placeholder="Website (optional)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            aria-label="Website (optional)"
          />
          <button
            className="go"
            onClick={() => run()}
            disabled={status === "loading" || !company.trim()}
          >
            {status === "loading" ? "Reading…" : "Find commitment"}
          </button>
        </div>
      </section>

      {status === "loading" && (
        <section className="working" aria-live="polite" aria-label="Reading…">
          <img className="workMark" src="/cobalt-logo.png" alt="" aria-hidden="true" />
        </section>
      )}

      {status === "error" && (
        <section className="errorCard" aria-live="polite">
          <p>{errorMsg}</p>
        </section>
      )}

      {status === "done" && result && (
        <section className="result" aria-live="polite">
          <div className="draftFlag">
            Unverified first-pass draft — review before use. Automated extraction
            misclassifies outcomes and over-fills blanks; confirm the slots and
            sources against the company's own pages.
          </div>

          <blockquote className="sentence">{result.oneSentence}</blockquote>

          {result.anchorQuote && result.anchorQuote.trim() !== "" && (
            <p className="anchor">Anchor: {result.anchorQuote}</p>
          )}

          <details className="details">
            <summary>
              <span className="summaryText">Details</span>
              <span className="summaryHint">company, slots &amp; sources</span>
              <span className="chevron" aria-hidden="true">&#8250;</span>
            </summary>

            <div className="detailsBody">
              <div className="resolved">
                <span className="resLabel">Found</span>
                <span className="resName">{result.companyResolved || company}</span>
                {result.website && result.website !== "not found" && (
                  <span className="resSite">{result.website}</span>
                )}
                <span className={`conf conf-${(result.confidence || "low").toLowerCase()}`}>
                  {(result.confidence || "low")} confidence
                </span>
              </div>

              <div className="slots">
                <Slot n="01" label="Beneficiary" value={result.beneficiary} blank={notStated(result.beneficiary)} />
                <Slot n="02" label="Mechanism" value={result.mechanism} blank={notStated(result.mechanism)} />
                <Slot n="03" label="Intended outcome" value={result.intendedOutcome} blank={notStated(result.intendedOutcome)} />
              </div>

              {result.ambiguityNote && result.ambiguityNote.trim() !== "" && (
                <div className="note">
                  <span className="noteLabel">Note</span> {result.ambiguityNote}
                </div>
              )}

              {Array.isArray(result.sources) && result.sources.length > 0 && (
                <div className="sources">
                  <span className="srcLabel">Sources</span>
                  <ul>
                    {result.sources.map((s, i) => (
                      <li key={i}>
                        <a href={s} target="_blank" rel="noopener noreferrer">{s}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        </section>
      )}

      <footer className="foot">
        Captures stated claims only — no fact-checking, ranking, or endorsement.
        A blank slot reads &ldquo;not stated&rdquo; rather than a guess.
      </footer>
    </div>
  );
}

function Slot({ n, label, value, blank }) {
  return (
    <div className={`slot ${blank ? "slot-blank" : ""}`}>
      <div className="slotHead">
        <span className="slotNum">{n}</span>
        <span className="slotLabel">{label}</span>
      </div>
      <div className="slotValue">{blank ? "not stated" : value}</div>
    </div>
  );
}
