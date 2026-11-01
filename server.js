import express from "express";
import cors from "cors";
import Stripe from "stripe";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env if present (simple parse, no dotenv dependency needed for test)
function loadEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
    const content = fs.readFileSync(envPath, "utf-8");
    content.split("\n").forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const [key, ...rest] = trimmed.split("=");
        const value = rest.join("=").trim();
        if (!process.env[key]) process.env[key] = value;
      }
    });
  } catch {}
}
loadEnv();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error("ERROR: STRIPE_SECRET_KEY not configured");
  process.exit(1);
}
const PORT = process.env.PORT || 3000;

const stripe = new Stripe(STRIPE_SECRET_KEY);
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ============ STRIPE ENDPOINTS ============

// Create PaymentIntent for one-time purchases (books)
app.post("/api/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency = "usd", description = "", mode = "payment", metadata = {} } = req.body;

    if (!amount || amount < 50) {
      return res.status(400).json({ error: "Amount must be at least 50 cents" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency,
      description,
      payment_method_types: ["card"],
      metadata: { ...metadata, mode }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status
    });
  } catch (err) {
    console.error("Stripe error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create subscription for membership
app.post("/api/create-subscription", async (req, res) => {
  try {
    const { email, priceId } = req.body;

    // Create customer
    const customer = await stripe.customers.create({
      email,
      description: "League Tennis Aventura member"
    });

    // Create subscription (requires a Stripe Price ID)
    // For demo, we use a setup intent approach
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ["card"],
      metadata: { mode: "subscription", app: "league-tennis" }
    });

    res.json({
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
      message: "Subscription setup initiated. Use a Stripe Price ID for recurring billing."
    });
  } catch (err) {
    console.error("Subscription error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get payment status
app.get("/api/payment-status/:paymentIntentId", async (req, res) => {
  try {
    const pi = await stripe.paymentIntents.retrieve(req.params.paymentIntentId);
    res.json({ status: pi.status, amount: pi.amount, description: pi.description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stripe webhook for async confirmation
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log("[WEBHOOK]", event.type, event.data?.object?.id);

    switch (event.type) {
      case "payment_intent.succeeded":
        console.log("[PAYMENT OK]", event.data.object.amount, event.data.object.description);
        break;
      case "payment_intent.payment_failed":
        console.log("[PAYMENT FAILED]", event.data.object.last_payment_error?.message);
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ============ GITHUB CMS ENDPOINTS ============

function ghHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN || ""}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "league-tennis-app"
  };
}

// Read a file from GitHub repo
app.get("/api/cms/:path{/.+}", async (req, res) => {
  try {
    const filePath = req.params.path;
    const branch = req.query.branch || process.env.GITHUB_BRANCH || "main";
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
    const resp = await fetch(url, { headers: ghHeaders() });

    if (!resp.ok) return res.status(resp.status).json({ error: "File not found" });

    const json = await resp.json();
    const content = Buffer.from(json.content, "base64").toString("utf-8");
    res.json({ content, sha: json.sha, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Write/update a file in GitHub repo
app.put("/api/cms/:path{/.+}", async (req, res) => {
  try {
    const filePath = req.params.path;
    const { content, message = "update", branch } = req.body;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const targetBranch = branch || process.env.GITHUB_BRANCH || "main";

    // Get current SHA if exists
    let sha;
    const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${targetBranch}`;
    const getResp = await fetch(getUrl, { headers: ghHeaders() });
    if (getResp.ok) {
      const getJson = await getResp.json();
      sha = getJson.sha;
    }

    const encodedContent = Buffer.from(content, "utf-8").toString("base64");

    const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const putResp = await fetch(putUrl, {
      method: "PUT",
      headers: ghHeaders(),
      body: JSON.stringify({ message, content: encodedContent, branch: targetBranch, sha })
    });

    if (!putResp.ok) {
      const errText = await putResp.text();
      return res.status(putResp.status).json({ error: errText });
    }

    const result = await putResp.json();
    res.json({ success: true, path: filePath, sha: result.content.sha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test GitHub connection
app.get("/api/cms-test", async (req, res) => {
  try {
    const url = `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`;
    const resp = await fetch(url, { headers: ghHeaders() });
    if (!resp.ok) return res.status(resp.status).json({ error: "Connection failed" });
    const json = await resp.json();
    res.json({ connected: true, repo: json.full_name, private: json.private });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ TRANSACTION LOG ============

const TX_FILE = path.join(__dirname, "data", "transactions.json");

function loadTxLog() {
  try { return JSON.parse(fs.readFileSync(TX_FILE, "utf-8")); } catch { return []; }
}

function saveTxLog(data) {
  fs.mkdirSync(path.dirname(TX_FILE), { recursive: true });
  fs.writeFileSync(TX_FILE, JSON.stringify(data, null, 2));
}

app.post("/api/log-transaction", (req, res) => {
  try {
    const tx = { ...req.body, server_timestamp: new Date().toISOString() };
    const log = loadTxLog();
    log.push(tx);
    saveTxLog(log);
    res.json({ success: true, id: log.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/transactions", (req, res) => {
  res.json(loadTxLog());
});

// ============ START ============
app.listen(PORT, () => {
  console.log(`\n🎾 League Tennis Aventura — Web Server`);
  console.log(`   Running at: http://localhost:${PORT}`);
  console.log(`   Stripe: test mode`);
  console.log(`   GitHub CMS: ${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}\n`);
});
