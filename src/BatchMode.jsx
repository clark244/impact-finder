import React, { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

// ── Batch mode ──────────────────────────────────────────────────────────
// Upload a spreadsheet of company names (+ optional websites), run each
// through the existing /api/commitment function with limited concurrency,
// and render/export the results as a table. Every row is flagged for
// review per the source methodology (Section 6.2) — outcome/mechanism
// classification and "not stated" calls are never automation-safe.

const CONCURRENCY = 4;

function notStated(v) {
  return !v || String(v).trim().toLowerCase() === "not stated";
}

function reviewReasonsFor(row) {
  const reasons = [];
  if (row.error) return ["lookup failed"];
  if (notStated(row.beneficiary)) reasons.push("beneficiary not stated");
  if (notStated(row.mechanism)) reasons.push("mechanism not stated");
  if (notStated(row.intendedOutcome)) reasons.push("outcome not stated");
  if (row.website === "not found" || !row.website) reasons.push("website not found");
  if ((row.confidence || "low").toLowerCase() !== "high") reasons.push(`${row.confidence || "low"} confidence`);
  if (row.ambiguityNote && row.ambiguityNote.trim() !== "") reasons.push("ambiguity noted");
  if (reasons.length === 0) reasons.push("standard review — automated draft");
  return reasons;
}

function parseFile(file) {
  return new Promise((resolve, reject) => {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv")) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data),
        error: reject,
      });
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          resolve(rows);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    } else {
      reject(new Error("Unsupported file type. Upload a .csv or .xlsx file."));
    }
  });
}

function normalizeRows(raw) {
  // Accept "Company"/"company"/"Company Name" and "Website"/"website"/"URL" header variants.
  return raw
    .map((r) => {
      const keys = Object.keys(r);
      const companyKey = keys.find((k) => /^company/i.test(k.trim()));
      const websiteKey = keys.find((k) => /website|url|domain/i.test(k.trim()));
      const company = companyKey ? String(r[companyKey] || "").trim() : "";
      const website = websiteKey ? String(r[websiteKey] || "").trim() : "";
      return { company, website };
    })
    .filter((r) => r.company !== "");
}

async function runOne(row) {
  try {
    const response = await fetch("/api/commitment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: row.company, url: row.website }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { company: row.company, website: row.website || "not stated", error: data.error || "request failed" };
    }
    return { ...data, inputCompany: row.company };
  } catch (err) {
    return { company: row.company, website: row.website || "not stated", error: String(err) };
  }
}

async function runBatch(rows, onProgress) {
  const results = new Array(rows.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < rows.length) {
      const i = nextIndex++;
      results[i] = await runOne(rows[i]);
      completed++;
      onProgress(completed, rows.length, results.slice());
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker);
  await Promise.all(workers);
  return results;
}

function toCsv(results) {
  const cols = [
    "Company",
    "Website",
    "Beneficiary",
    "Mechanism",
    "Intended outcome",
    "One-sentence commitment",
    "Anchor quote",
    "Source URL(s)",
    "Date captured",
    "Needs review",
    "Review reasons",
    "Notes",
  ];
  const date = new Date().toISOString().slice(0, 10);
  const rows = results.map((r) => {
    const company = r.companyResolved || r.inputCompany || r.company || "not stated";
    const website = r.website && r.website !== "not found" ? r.website : "not stated";
    const beneficiary = r.error ? "not stated" : (notStated(r.beneficiary) ? "not stated" : r.beneficiary);
    const mechanism = r.error ? "not stated" : (notStated(r.mechanism) ? "not stated" : r.mechanism);
    const outcome = r.error ? "not stated" : (notStated(r.intendedOutcome) ? "not stated" : r.intendedOutcome);
    const sentence = r.error ? "not stated" : (r.oneSentence || "not stated");
    const anchor = r.anchorQuote || "";
    const sources = Array.isArray(r.sources) ? r.sources.join(" | ") : "";
    const reasons = reviewReasonsFor(r).join("; ");
    const notes = r.error ? `Lookup failed: ${r.error}` : (r.ambiguityNote || "");
    return [company, website, beneficiary, mechanism, outcome, sentence, anchor, sources, date, "Yes", reasons, notes];
  });

  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [cols.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  return lines.join("\n");
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function BatchMode() {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("idle"); // idle | ready | running | done | error
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [showTip, setShowTip] = useState(false);
  const fileInputRef = useRef(null);
  const tipRef = useRef(null);

  useEffect(() => {
    if (!showTip) return;
    function onDocClick(e) {
      if (tipRef.current && !tipRef.current.contains(e.target)) setShowTip(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
    };
  }, [showTip]);

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setErrorMsg("");
    try {
      const raw = await parseFile(file);
      const normalized = normalizeRows(raw);
      if (normalized.length === 0) {
        setErrorMsg("No usable rows found. Confirm the sheet has a \"Company\" column with at least one value.");
        setStatus("error");
        return;
      }
      setRows(normalized);
      setFileName(file.name);
      setStatus("ready");
      setResults([]);
    } catch (err) {
      setErrorMsg("Could not read that file. Confirm it's a .csv or .xlsx with a header row.");
      setStatus("error");
    }
  }

  async function start() {
    setStatus("running");
    setProgress({ done: 0, total: rows.length });
    const final = await runBatch(rows, (done, total, partial) => {
      setProgress({ done, total });
      setResults(partial);
    });
    setResults(final);
    setStatus("done");
  }

  function exportCsv() {
    const csv = toCsv(results);
    downloadCsv(csv, `impact-commitments-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  function reset() {
    setRows([]);
    setFileName("");
    setStatus("idle");
    setProgress({ done: 0, total: 0 });
    setResults([]);
    setErrorMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="batch">
      <div className="uploadRow">
        <label className="uploadLabel">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFile}
            disabled={status === "running"}
            style={{ display: "none" }}
          />
          <span className="uploadBtn" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
            {fileName ? "Choose a different file" : "Upload spreadsheet"}
          </span>
        </label>

        <div className="tipWrap" ref={tipRef}>
          <button
            type="button"
            className="tipIcon"
            aria-label="Spreadsheet format help"
            onClick={() => setShowTip((v) => !v)}
          >
            ?
          </button>
          {showTip && (
            <div className="tipPopover" role="tooltip">
              <strong>Spreadsheet format</strong>
              <p>CSV or XLSX, two columns:</p>
              <ul>
                <li><strong>Company</strong> (required) — company name</li>
                <li><strong>Website</strong> (optional) — leave blank and we'll look it up</li>
              </ul>
              <p>First row must be headers.</p>
              <a href="/cobalt-batch-template.csv" download>Download template</a>
            </div>
          )}
        </div>

        {fileName && <span className="fileName">{fileName} · {rows.length} companies</span>}
      </div>

      {errorMsg && status === "error" && (
        <section className="errorCard" aria-live="polite">
          <p>{errorMsg}</p>
        </section>
      )}

      {status === "ready" && (
        <div className="batchActions">
          <button className="go" onClick={start}>Run batch ({rows.length})</button>
          <button className="linkBtn" onClick={reset}>Start over</button>
        </div>
      )}

      {status === "running" && (
        <div className="batchProgress" aria-live="polite">
          <div className="progressBarTrack">
            <div
              className="progressBarFill"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <span className="progressLabel">{progress.done} of {progress.total} companies read…</span>
        </div>
      )}

      {results.length > 0 && (
        <>
          <div className="batchTop">
            <div className="draftFlag">
              Every row is an unverified first-pass draft — review before use. Automated
              extraction misclassifies outcomes and over-fills blanks; confirm the slots
              and sources against each company's own pages.
            </div>
            <div className="batchActions">
              {status === "done" && <button className="go" onClick={exportCsv}>Download CSV</button>}
              {status === "done" && <button className="linkBtn" onClick={reset}>Start over</button>}
            </div>
          </div>

          <div className="tableWrap">
            <table className="resultsTable">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Website</th>
                  <th>Beneficiary</th>
                  <th>Mechanism</th>
                  <th>Intended outcome</th>
                  <th>One-sentence commitment</th>
                  <th>Sources</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const reasons = reviewReasonsFor(r);
                  const company = r.companyResolved || r.inputCompany || r.company || "—";
                  return (
                    <tr key={i} className={r.error ? "rowError" : ""}>
                      <td>{company}</td>
                      <td>
                        {r.website && r.website !== "not found" ? (
                          <a href={r.website} target="_blank" rel="noopener noreferrer">{r.website}</a>
                        ) : (
                          <span className="blankCell">not stated</span>
                        )}
                      </td>
                      {r.error ? (
                        <td colSpan={4} className="errorCell">Lookup failed: {r.error}</td>
                      ) : (
                        <>
                          <td className={notStated(r.beneficiary) ? "blankCell" : ""}>{notStated(r.beneficiary) ? "not stated" : r.beneficiary}</td>
                          <td className={notStated(r.mechanism) ? "blankCell" : ""}>{notStated(r.mechanism) ? "not stated" : r.mechanism}</td>
                          <td className={notStated(r.intendedOutcome) ? "blankCell" : ""}>{notStated(r.intendedOutcome) ? "not stated" : r.intendedOutcome}</td>
                          <td>{r.oneSentence || "—"}</td>
                        </>
                      )}
                      <td>
                        {Array.isArray(r.sources) && r.sources.length > 0
                          ? r.sources.map((s, si) => (
                              <div key={si}><a href={s} target="_blank" rel="noopener noreferrer">{s}</a></div>
                            ))
                          : "—"}
                      </td>
                      <td>
                        <span className="reviewBadge" title={reasons.join("; ")}>Review</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
