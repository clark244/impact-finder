# Impact Commitment Finder

Enter a company name (and optionally its website); the app reads the company's
public pages and returns a one-sentence impact commitment — beneficiary,
mechanism, and intended outcome — captured as stated, not judged. Every result
is an **unverified first-pass draft** that needs human review.

The browser never holds the API key. It calls `/api/commitment`, a Netlify
serverless function that holds the key server-side and talks to the Anthropic API.

---

## What you need before starting

1. A free **GitHub** account — github.com
2. A free **Netlify** account — netlify.com (sign up with your GitHub login; it's simplest)
3. An **Anthropic API key** — console.anthropic.com → API Keys → Create Key.
   Note: usage against this key costs money. See "Cost & abuse" at the bottom.

---

## Step 1 — Put the code on GitHub

You have two options.

**Option A — GitHub website (no command line):**
1. Go to github.com and click **New repository**. Name it `impact-finder`,
   keep it Public or Private, click **Create repository**.
2. On the new repo page, click **uploading an existing file**.
3. Unzip the project folder on your computer, then drag *all* its contents
   (not the outer folder — the files inside it: `index.html`, `package.json`,
   `src/`, `netlify/`, etc.) into the upload area.
4. Click **Commit changes**.

**Option B — command line (if you're comfortable with git):**
```bash
cd impact-finder
git init
git add .
git commit -m "Impact Commitment Finder"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/impact-finder.git
git push -u origin main
```

Either way: confirm the repo does **not** contain a `node_modules` folder or any
`.env` file. The included `.gitignore` prevents this.

---

## Step 2 — Connect the repo to Netlify

1. Log in to netlify.com.
2. Click **Add new site → Import an existing project**.
3. Choose **GitHub**, authorize if asked, and pick your `impact-finder` repo.
4. Netlify reads `netlify.toml` and fills in the build settings automatically:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
   Leave these as they are.
5. **Do not click Deploy yet** — add the key first (next step). If you already
   clicked it, that's fine; you'll redeploy after Step 3.

---

## Step 3 — Add your API key (this is the important one)

1. In your new site, go to **Site configuration → Environment variables**.
2. Click **Add a variable → Add a single variable**.
3. Key (exact, case-sensitive): `ANTHROPIC_API_KEY`
4. Value: paste your Anthropic API key (starts with `sk-ant-`).
5. Save.

The key lives only in Netlify's settings and is read by the serverless function
at runtime. It is never sent to the browser and never appears in your GitHub repo.

---

## Step 4 — Deploy

1. Go to the **Deploys** tab → **Trigger deploy → Deploy site**
   (or push any change to GitHub; Netlify rebuilds automatically).
2. When it finishes, Netlify gives you a URL like
   `https://your-site-name.netlify.app`. That's your shareable link.
3. You can rename it under **Site configuration → Change site name**.

Open the link, type a company, and confirm a result comes back. If it does,
you're done — share that URL.

---

## Running it locally first (optional)

If you want to test on your own machine before deploying:
```bash
npm install
npm install -g netlify-cli
netlify dev
```
`netlify dev` runs both the site and the function together. Create a file named
`.env` in the project root with one line:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```
(`.env` is gitignored, so it won't be uploaded.) Plain `npm run dev` runs the
UI but **not** the function, so lookups will fail — use `netlify dev`.

---

## Troubleshooting

- **"Server is missing ANTHROPIC_API_KEY"** → the environment variable isn't set,
  or the name is misspelled. Re-check Step 3, then redeploy (Step 4).
- **Lookups fail right after deploy** → make sure you redeployed *after* adding
  the key. Variables added later only take effect on the next deploy.
- **The result box never appears** → open the browser's developer console
  (F12 → Console / Network) and look at the `/api/commitment` request for the
  error message.
- **Page loads but looks unstyled** → confirm `src/styles.css` uploaded and that
  the publish directory is `dist`.

---

## Cost & abuse — read before sharing widely

- Every lookup runs a model with web search **on your API key**, so every use
  costs you money. A public link means strangers can spend your credits.
- Set a spending cap in the Anthropic console (Billing → usage limits).
- For anything beyond a small trusted audience, add rate limiting or a simple
  access password. The current build has neither.
- Every result is an unverified draft. Per the source methodology, automated
  extraction misclassifies outcomes and over-fills blanks — the on-screen
  warning says so, but make sure whoever you share it with understands it too.
