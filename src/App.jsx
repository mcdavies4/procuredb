import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "procuredb-suppliers";
const HISTORY_KEY = "procuredb-history";
const PRICE_HISTORY_KEY = "procuredb-prices";
const STALE_CONTACT_DAYS = 90;
const STALE_PRICE_DAYS = 60;

function parsePrice(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function priceCreep(priceHistory) {
  if (!priceHistory || priceHistory.length < 2) return null;
  const sorted = [...priceHistory].sort((a, b) => new Date(a.date) - new Date(b.date));
  const first = parsePrice(sorted[0].price);
  const last = parsePrice(sorted[sorted.length - 1].price);
  if (!first || !last) return null;
  return ((last - first) / first) * 100;
}

function PriceChart({ priceHistory }) {
  if (!priceHistory || priceHistory.length < 2) return (
    <div style={{ fontSize: 11, color: "#444", padding: "12px 0" }}>
      Price trend will appear after 2+ price changes are recorded.
    </div>
  );
  const sorted = [...priceHistory].sort((a, b) => new Date(a.date) - new Date(b.date));
  const values = sorted.map(p => parsePrice(p.price)).filter(Boolean);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 340, H = 80, PAD = 12;
  const points = values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
    const y = PAD + ((max - v) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(" ");
  const creep = priceCreep(priceHistory);
  const lineColor = creep > 10 ? "#c85a5a" : creep < -5 ? "#7cb87c" : "#8a9a6a";
  return (
    <div>
      <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
        <polyline points={points} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" />
        {values.map((v, i) => {
          const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
          const y = PAD + ((max - v) / range) * (H - PAD * 2);
          return <circle key={i} cx={x} cy={y} r={3} fill={lineColor} />;
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 10, color: "#444", fontFamily: "monospace" }}>{sorted[0].date}</span>
        <span style={{ fontSize: 10, color: "#444", fontFamily: "monospace" }}>{sorted[sorted.length - 1].date}</span>
      </div>
      {creep !== null && (
        <div style={{ marginTop: 8, fontSize: 12, color: creep > 10 ? "#c85a5a" : creep < 0 ? "#7cb87c" : "#aaa" }}>
          {creep > 0 ? "▲" : "▼"} {Math.abs(creep).toFixed(1)}% since first recorded
          {creep > 10 && <span style={{ marginLeft: 8, fontSize: 10, color: "#c85a5a" }}>⚠ significant increase</span>}
        </div>
      )}
    </div>
  );
}

function daysSince(dateStr) {
  if (!dateStr) return 9999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function healthScore(supplier) {
  const contactAge = daysSince(supplier.contactVerified);
  const priceAge = daysSince(supplier.priceVerified);
  let score = 100;
  if (contactAge > STALE_CONTACT_DAYS) score -= 40;
  else if (contactAge > 45) score -= 20;
  if (priceAge > STALE_PRICE_DAYS) score -= 40;
  else if (priceAge > 30) score -= 20;
  if (!supplier.contact || !supplier.email) score -= 10;
  if (!supplier.price) score -= 10;
  return Math.max(0, score);
}

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://igltpdpjgupjrntvffrb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbHRwZHBqZ3VwanJudHZmZnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NTY3MDksImV4cCI6MjA4OTIzMjcwOX0.cxKrhCCa7Kps7j5-ar-0QgqX3SYr63PzC-S1EN_dDxE";

const db = {
  async fetchAll(table) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=id.desc`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) throw new Error(`fetch ${table} failed`);
    const rows = await res.json();
    return rows.map(r => r.data);
  },
  async upsert(table, record) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json", Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({ id: record.id, data: record, ...(record.supplierId ? { supplier_id: record.supplierId } : {}) })
    });
    if (!res.ok) throw new Error(`upsert ${table} failed`);
  },
  async remove(table, id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) throw new Error(`delete ${table} failed`);
  },
  async bulkInsert(table, records) {
    if (!records.length) return;
    const rows = records.map(r => ({ id: r.id, data: r, ...(r.supplierId ? { supplier_id: r.supplierId } : {}) }));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json", Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(rows)
    });
    if (!res.ok) throw new Error(`bulkInsert ${table} failed`);
  }
};

// localStorage kept as local cache only
function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveToStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function exportToCSV(suppliers) {
  const headers = ["Name","Category","Contact","Email","Phone","Price","Price Unit","Contact Verified","Price Verified","Notes","Health Score","Created At"];
  const rows = suppliers.map(s => [
    s.name, s.category, s.contact, s.email, s.phone,
    s.price, s.priceUnit, s.contactVerified, s.priceVerified,
    (s.notes || "").replace(/,/g, ";"),
    healthScore(s), s.createdAt
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v ?? ""}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `procuredb-export-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function HealthBar({ score }) {
  const color = score >= 75 ? "#7cb87c" : score >= 40 ? "#c8a444" : "#c85a5a";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 60, height: 6, background: "#2a2a2a", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 11, color, fontFamily: "monospace", minWidth: 28 }}>{score}</span>
    </div>
  );
}

function Tag({ label, color }) {
  return (
    <span style={{
      fontSize: 10, padding: "2px 7px", borderRadius: 2,
      background: color + "22", color, border: `1px solid ${color}44`,
      fontFamily: "monospace", letterSpacing: 0.5, textTransform: "uppercase"
    }}>{label}</span>
  );
}

const CATEGORIES = ["Electronics","Raw Materials","Packaging","Logistics","Services","IT","Office","Other"];
const emptySupplier = { id: null, name: "", category: "Other", contact: "", email: "", phone: "", price: "", priceUnit: "", contactVerified: "", priceVerified: "", notes: "" };

const typeColors = { created: "#8a9a6a", updated: "#6a8a9a", verified: "#9a8a6a", note: "#7a7a9a", price: "#9a7a6a", negotiation: "#8a6a9a" };

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; }
  body { background: #111; color: #d4cfc8; font-family: 'IBM Plex Sans', sans-serif; -webkit-font-smoothing: antialiased; }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: #1a1a1a; }
  ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
  input, select, textarea, button { font-family: 'IBM Plex Sans', sans-serif; }
  input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.4); }
  .row-hover:hover { background: #1e1e1e !important; }
  .btn-hover:hover { opacity: 0.8; }
  @keyframes fadeIn { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: translateY(0); } }
  .fade-in { animation: fadeIn 0.2s ease forwards; }
`;

export default function App() {
  const [suppliers, setSuppliers] = useState(() => loadFromStorage(STORAGE_KEY, []));
  const [history, setHistory] = useState(() => loadFromStorage(HISTORY_KEY, []));
  const [priceHistory, setPriceHistory] = useState(() => loadFromStorage(PRICE_HISTORY_KEY, []));
  const [view, setView] = useState("dashboard");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptySupplier);
  const [historyNote, setHistoryNote] = useState("");
  const [historyType, setHistoryType] = useState("note");
  const [filterStale, setFilterStale] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [compareCategory, setCompareCategory] = useState("All");
  const [compareSelected, setCompareSelected] = useState([]);
  const [dbReady, setDbReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [showMigrate, setShowMigrate] = useState(false);

  // Load from Supabase on mount
  useEffect(() => {
    (async () => {
      try {
        const [s, h, p] = await Promise.all([
          db.fetchAll("suppliers"),
          db.fetchAll("activity_history"),
          db.fetchAll("price_history"),
        ]);
        setSuppliers(s);
        setHistory(h);
        setPriceHistory(p);
        saveToStorage(STORAGE_KEY, s);
        saveToStorage(HISTORY_KEY, h);
        saveToStorage(PRICE_HISTORY_KEY, p);
        setDbReady(true);
        // Show migration banner if local data exists but cloud is empty
        const localS = loadFromStorage(STORAGE_KEY, []);
        if (s.length === 0 && localS.length > 0) setShowMigrate(true);
      } catch {
        // Supabase unavailable — fall back to localStorage silently
        setDbReady(false);
      }
    })();
  }, []);

  const handleMigrateData = async () => {
    setMigrating(true);
    try {
      const localS = loadFromStorage(STORAGE_KEY, []);
      const localH = loadFromStorage(HISTORY_KEY, []);
      const localP = loadFromStorage(PRICE_HISTORY_KEY, []);
      await db.bulkInsert("suppliers", localS);
      await db.bulkInsert("activity_history", localH);
      await db.bulkInsert("price_history", localP);
      setSuppliers(localS);
      setHistory(localH);
      setPriceHistory(localP);
      setShowMigrate(false);
      showToast(`Migrated ${localS.length} suppliers to cloud ✓`);
    } catch {
      showToast("Migration failed — check connection", false);
    }
    setMigrating(false);
  };

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2600);
  };

  const addHistoryEntry = useCallback((supplierId, type, text, currentHistory) => {
    const entry = { id: Date.now() + Math.random(), supplierId, type, text, date: new Date().toISOString() };
    return [entry, ...currentHistory].slice(0, 500);
  }, []);

  const handleSaveSupplier = async () => {
    if (!form.name.trim()) return showToast("Supplier name required", false);
    const now = new Date().toISOString().split("T")[0];
    let newSuppliers, newHistory, newPriceHistory = priceHistory;
    let newSupplierRecord, newHistoryEntry, newPriceEntry;
    if (editing === "new") {
      const s = { ...form, id: Date.now(), createdAt: now };
      newSuppliers = [s, ...suppliers];
      newHistoryEntry = { id: Date.now() + Math.random(), supplierId: s.id, type: "created", text: "Supplier created", date: new Date().toISOString() };
      newHistory = [newHistoryEntry, ...history].slice(0, 500);
      newSupplierRecord = s;
      if (form.price) {
        newPriceEntry = { id: Date.now() + 1, supplierId: s.id, price: form.price, date: now };
        newPriceHistory = [newPriceEntry, ...priceHistory];
      }
      showToast("Supplier added ✓");
    } else {
      const existing = suppliers.find(s => s.id === form.id);
      newSuppliers = suppliers.map(s => s.id === form.id ? { ...form } : s);
      newSupplierRecord = form;
      if (existing && form.price && form.price !== existing.price) {
        newPriceEntry = { id: Date.now(), supplierId: form.id, price: form.price, oldPrice: existing.price, date: now };
        newPriceHistory = [newPriceEntry, ...priceHistory];
        newHistoryEntry = { id: Date.now() + Math.random(), supplierId: form.id, type: "price", text: `Price updated: ${existing.price} → ${form.price}`, date: new Date().toISOString() };
        newHistory = [newHistoryEntry, ...history].slice(0, 500);
        showToast("Saved — price change logged ✓");
      } else {
        newHistoryEntry = { id: Date.now() + Math.random(), supplierId: form.id, type: "updated", text: "Record updated", date: new Date().toISOString() };
        newHistory = [newHistoryEntry, ...history].slice(0, 500);
        showToast("Saved ✓");
      }
    }
    setSuppliers(newSuppliers);
    setHistory(newHistory);
    setPriceHistory(newPriceHistory);
    saveToStorage(STORAGE_KEY, newSuppliers);
    saveToStorage(HISTORY_KEY, newHistory);
    saveToStorage(PRICE_HISTORY_KEY, newPriceHistory);
    // Sync to Supabase
    if (dbReady) {
      setSyncing(true);
      try {
        await db.upsert("suppliers", newSupplierRecord);
        await db.upsert("activity_history", newHistoryEntry);
        if (newPriceEntry) await db.upsert("price_history", newPriceEntry);
      } catch { showToast("Saved locally — cloud sync failed", false); }
      setSyncing(false);
    }
    setEditing(null);
    if (editing === "new") setView("list");
    else setSelected(form);
  };

  const handleVerifyContact = async (s) => {
    const today = new Date().toISOString().split("T")[0];
    const updated = { ...s, contactVerified: today };
    const newSuppliers = suppliers.map(x => x.id === s.id ? updated : x);
    const entry = { id: Date.now() + Math.random(), supplierId: s.id, type: "verified", text: "Contact verified", date: new Date().toISOString() };
    const newHistory = [entry, ...history].slice(0, 500);
    setSuppliers(newSuppliers); setHistory(newHistory);
    saveToStorage(STORAGE_KEY, newSuppliers); saveToStorage(HISTORY_KEY, newHistory);
    if (selected?.id === s.id) setSelected(updated);
    showToast("Contact verified ✓");
    if (dbReady) { try { await db.upsert("suppliers", updated); await db.upsert("activity_history", entry); } catch {} }
  };

  const handleVerifyPrice = async (s) => {
    const today = new Date().toISOString().split("T")[0];
    const updated = { ...s, priceVerified: today };
    const newSuppliers = suppliers.map(x => x.id === s.id ? updated : x);
    const entry = { id: Date.now() + Math.random(), supplierId: s.id, type: "price", text: "Price verified", date: new Date().toISOString() };
    const newHistory = [entry, ...history].slice(0, 500);
    setSuppliers(newSuppliers); setHistory(newHistory);
    saveToStorage(STORAGE_KEY, newSuppliers); saveToStorage(HISTORY_KEY, newHistory);
    if (selected?.id === s.id) setSelected(updated);
    showToast("Price verified ✓");
    if (dbReady) { try { await db.upsert("suppliers", updated); await db.upsert("activity_history", entry); } catch {} }
  };

  const handleAddNote = async (supplierId) => {
    if (!historyNote.trim()) return;
    const entry = { id: Date.now() + Math.random(), supplierId, type: historyType, text: historyNote, date: new Date().toISOString() };
    const newHistory = [entry, ...history].slice(0, 500);
    setHistory(newHistory);
    saveToStorage(HISTORY_KEY, newHistory);
    setHistoryNote("");
    showToast("Logged ✓");
    if (dbReady) { try { await db.upsert("activity_history", entry); } catch {} }
  };

  const handleDelete = async (id) => {
    const newSuppliers = suppliers.filter(s => s.id !== id);
    setSuppliers(newSuppliers);
    saveToStorage(STORAGE_KEY, newSuppliers);
    setView("list"); setSelected(null);
    showToast("Supplier removed");
    if (dbReady) { try { await db.remove("suppliers", id); } catch {} }
  };

  const staleCount = suppliers.filter(s =>
    daysSince(s.contactVerified) > STALE_CONTACT_DAYS || daysSince(s.priceVerified) > STALE_PRICE_DAYS
  ).length;

  const filtered = suppliers.filter(s => {
    const matchSearch = !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.category.toLowerCase().includes(search.toLowerCase()) ||
      (s.contact || "").toLowerCase().includes(search.toLowerCase());
    const matchStale = !filterStale || (
      daysSince(s.contactVerified) > STALE_CONTACT_DAYS ||
      daysSince(s.priceVerified) > STALE_PRICE_DAYS
    );
    return matchSearch && matchStale;
  });

  // ─── STYLES ───────────────────────────────────────────────────────────────
  const S = {
    app: { minHeight: "100vh", background: "#111", display: "flex", flexDirection: "column" },
    header: { background: "#161616", borderBottom: "1px solid #252525", padding: "0 28px", display: "flex", alignItems: "center", height: 54, position: "sticky", top: 0, zIndex: 100, gap: 0 },
    logo: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 500, color: "#8a9a6a", letterSpacing: 2, marginRight: 32, textTransform: "uppercase" },
    navBtn: (active) => ({ background: active ? "#1d1d1d" : "transparent", border: "none", color: active ? "#d4cfc8" : "#666", padding: "10px 18px", fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", borderBottom: active ? "2px solid #8a9a6a" : "2px solid transparent", cursor: "pointer", transition: "all 0.15s" }),
    main: { flex: 1, padding: "28px 28px", maxWidth: 1140, width: "100%", margin: "0 auto" },
    card: { background: "#161616", border: "1px solid #252525", borderRadius: 4, padding: 22, marginBottom: 16 },
    sectionTitle: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#555", letterSpacing: 2, textTransform: "uppercase", marginBottom: 16, borderBottom: "1px solid #1e1e1e", paddingBottom: 10 },
    statGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 },
    stat: (warn) => ({ background: "#161616", border: `1px solid ${warn ? "#5a3030" : "#252525"}`, borderRadius: 4, padding: "18px 22px" }),
    statNum: (warn) => ({ fontSize: 32, fontFamily: "'IBM Plex Mono', monospace", color: warn ? "#c85a5a" : "#d4cfc8", lineHeight: 1 }),
    statLabel: { fontSize: 10, color: "#555", marginTop: 6, textTransform: "uppercase", letterSpacing: 1 },
    btn: (variant = "default") => ({ padding: "8px 16px", borderRadius: 3, fontSize: 12, fontWeight: 500, border: "none", letterSpacing: 0.3, cursor: "pointer", background: variant === "primary" ? "#8a9a6a" : variant === "danger" ? "#6a3030" : "#222", color: variant === "primary" ? "#111" : variant === "danger" ? "#e8a0a0" : "#aaa", transition: "opacity 0.15s" }),
    input: { width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 3, padding: "9px 12px", color: "#d4cfc8", fontSize: 13, outline: "none" },
    label: { fontSize: 10, color: "#666", letterSpacing: 1, textTransform: "uppercase", marginBottom: 5, display: "block" },
    row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 },
    tableHead: { display: "grid", gridTemplateColumns: "2fr 1fr 1.5fr 1fr 1fr 80px", padding: "8px 16px", background: "#111", fontSize: 10, color: "#555", letterSpacing: 1, textTransform: "uppercase", borderBottom: "1px solid #1e1e1e" },
    tableRow: (stale) => ({ display: "grid", gridTemplateColumns: "2fr 1fr 1.5fr 1fr 1fr 80px", padding: "12px 16px", borderBottom: "1px solid #1c1c1c", cursor: "pointer", background: stale ? "#1a1515" : "transparent", transition: "background 0.1s" }),
    toast: (ok) => ({ position: "fixed", bottom: 28, right: 28, zIndex: 999, background: ok ? "#1a2a1a" : "#2a1a1a", border: `1px solid ${ok ? "#3a5a3a" : "#5a3a3a"}`, color: ok ? "#7acc7a" : "#cc7a7a", padding: "10px 20px", borderRadius: 4, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 0.5, boxShadow: "0 4px 24px rgba(0,0,0,0.5)" }),
    badge: (color = "#c85a5a") => ({ fontSize: 9, background: color + "22", color, border: `1px solid ${color}33`, padding: "2px 6px", borderRadius: 2, fontFamily: "monospace" }),
    histType: (active) => ({ padding: "5px 12px", borderRadius: 3, border: "none", fontSize: 11, background: active ? "#252525" : "transparent", color: active ? "#d4cfc8" : "#555", cursor: "pointer" }),
  };

  // ─── EDIT VIEW ─────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div style={S.app}>
        <style>{CSS}</style>
        <header style={S.header}>
          <span style={S.logo}>ProcureDB</span>
          <button style={S.navBtn(false)} onClick={() => setEditing(null)}>← Cancel</button>
        </header>
        <div style={S.main}>
          <div style={{ ...S.card, maxWidth: 700 }} className="fade-in">
            <div style={S.sectionTitle}>{editing === "new" ? "New Supplier" : "Edit Supplier"}</div>
            <div style={S.row2}>
              <div><label style={S.label}>Supplier Name *</label><input style={S.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="ACME Corp" /></div>
              <div><label style={S.label}>Category</label>
                <select style={S.input} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div style={{ ...S.sectionTitle, marginTop: 4 }}>Contact</div>
            <div style={S.row2}>
              <div><label style={S.label}>Contact Name</label><input style={S.input} value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder="Jane Smith" /></div>
              <div><label style={S.label}>Email</label><input style={S.input} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="jane@acme.com" /></div>
            </div>
            <div style={S.row2}>
              <div><label style={S.label}>Phone</label><input style={S.input} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" /></div>
              <div><label style={S.label}>Contact Last Verified</label><input type="date" style={S.input} value={form.contactVerified} onChange={e => setForm({ ...form, contactVerified: e.target.value })} /></div>
            </div>
            <div style={{ ...S.sectionTitle, marginTop: 4 }}>Pricing</div>
            <div style={S.row2}>
              <div><label style={S.label}>Price / Rate</label><input style={S.input} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="$4.50" /></div>
              <div><label style={S.label}>Unit / Description</label><input style={S.input} value={form.priceUnit} onChange={e => setForm({ ...form, priceUnit: e.target.value })} placeholder="per unit" /></div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Price Last Verified</label>
              <input type="date" style={{ ...S.input, maxWidth: 220 }} value={form.priceVerified} onChange={e => setForm({ ...form, priceVerified: e.target.value })} />
            </div>
            <div style={{ marginBottom: 22 }}>
              <label style={S.label}>Notes</label>
              <textarea style={{ ...S.input, minHeight: 80, resize: "vertical" }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Payment terms, lead times, negotiation notes..." />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={S.btn("primary")} className="btn-hover" onClick={handleSaveSupplier}>Save Supplier</button>
              <button style={S.btn()} className="btn-hover" onClick={() => setEditing(null)}>Cancel</button>
              {editing !== "new" && <button style={{ ...S.btn("danger"), marginLeft: "auto" }} className="btn-hover" onClick={() => handleDelete(form.id)}>Delete Supplier</button>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── SUPPLIER DETAIL VIEW ─────────────────────────────────────────────────
  if (selected && view === "supplier") {
    const sc = healthScore(selected);
    const sHistory = history.filter(h => h.supplierId === selected.id);
    const contactStale = daysSince(selected.contactVerified) > STALE_CONTACT_DAYS;
    const priceStale = daysSince(selected.priceVerified) > STALE_PRICE_DAYS;
    return (
      <div style={S.app}>
        <style>{CSS}</style>
        <header style={S.header}>
          <span style={S.logo}>ProcureDB</span>
          <button style={S.navBtn(false)} onClick={() => { setView("list"); setSelected(null); }}>← All Suppliers</button>
        </header>
        <div style={S.main}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }} className="fade-in">
            <div>
              <div style={S.card}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 600, color: "#e8e4de", marginBottom: 6 }}>{selected.name}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Tag label={selected.category} color="#8a9a6a" />
                      <HealthBar score={sc} />
                    </div>
                  </div>
                  <button style={S.btn()} className="btn-hover" onClick={() => { setForm({ ...selected }); setEditing(selected.id); }}>Edit</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                  <div>
                    <div style={S.sectionTitle}>Contact Info</div>
                    {[["Name", selected.contact], ["Email", selected.email], ["Phone", selected.phone]].map(([l, v]) => (
                      <div key={l} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 10, color: "#555", marginBottom: 2 }}>{l}</div>
                        <div style={{ fontSize: 13, color: l === "Email" ? "#8a9a6a" : "#ccc" }}>{v || <span style={{ color: "#444" }}>—</span>}</div>
                      </div>
                    ))}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#555" }}>Last verified</div>
                        <div style={{ fontFamily: "monospace", fontSize: 12, color: contactStale ? "#c85a5a" : "#7cb87c" }}>
                          {selected.contactVerified ? `${daysSince(selected.contactVerified)}d ago` : "Never"}
                        </div>
                      </div>
                      <button style={S.btn()} className="btn-hover" onClick={() => handleVerifyContact(selected)}>✓ Verify Now</button>
                    </div>
                  </div>
                  <div>
                    <div style={S.sectionTitle}>Pricing</div>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>Current Rate</div>
                      <div style={{ fontSize: 28, fontFamily: "monospace", color: "#e8e4de", lineHeight: 1 }}>{selected.price || <span style={{ fontSize: 16, color: "#444" }}>Not set</span>}</div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{selected.priceUnit}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#555" }}>Last verified</div>
                        <div style={{ fontFamily: "monospace", fontSize: 12, color: priceStale ? "#c85a5a" : "#7cb87c" }}>
                          {selected.priceVerified ? `${daysSince(selected.priceVerified)}d ago` : "Never"}
                        </div>
                      </div>
                      <button style={S.btn()} className="btn-hover" onClick={() => handleVerifyPrice(selected)}>✓ Verify Now</button>
                    </div>
                  </div>
                </div>
                {/* Price trend chart */}
                {priceHistory.filter(p => p.supplierId === selected.id).length > 0 && (
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #1e1e1e" }}>
                    <div style={{ fontSize: 10, color: "#555", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Price History</div>
                    <PriceChart priceHistory={priceHistory.filter(p => p.supplierId === selected.id)} />
                  </div>
                )}
                {selected.notes && (
                  <div style={{ marginTop: 18, padding: "12px 16px", background: "#1a1a1a", borderRadius: 3, fontSize: 13, color: "#888", lineHeight: 1.7, borderLeft: "3px solid #2a2a2a" }}>
                    {selected.notes}
                  </div>
                )}
              </div>

              <div style={S.card}>
                <div style={S.sectionTitle}>Log Activity</div>
                <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                  {["note", "negotiation", "price", "verified"].map(t => (
                    <button key={t} style={S.histType(historyType === t)} onClick={() => setHistoryType(t)}>{t}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input style={S.input} value={historyNote}
                    onChange={e => setHistoryNote(e.target.value)}
                    placeholder={historyType === "negotiation" ? "Negotiated 5% discount for Q3..." : "Add a note..."}
                    onKeyDown={e => e.key === "Enter" && handleAddNote(selected.id)} />
                  <button style={{ ...S.btn("primary"), whiteSpace: "nowrap" }} className="btn-hover" onClick={() => handleAddNote(selected.id)}>Log</button>
                </div>
              </div>
            </div>

            <div>
              <div style={{ ...S.card, maxHeight: 580, overflowY: "auto" }}>
                <div style={S.sectionTitle}>History ({sHistory.length})</div>
                {sHistory.length === 0 && <div style={{ fontSize: 12, color: "#444", padding: "8px 0" }}>No activity logged yet.</div>}
                {sHistory.map(h => (
                  <div key={h.id} style={{ borderLeft: `2px solid ${typeColors[h.type] || "#333"}`, paddingLeft: 12, marginBottom: 16 }}>
                    <div style={{ marginBottom: 4 }}><Tag label={h.type} color={typeColors[h.type] || "#666"} /></div>
                    <div style={{ fontSize: 13, color: "#bbb", marginBottom: 3, lineHeight: 1.5 }}>{h.text}</div>
                    <div style={{ fontSize: 10, color: "#3a3a3a", fontFamily: "monospace" }}>
                      {new Date(h.date).toLocaleDateString()} · {new Date(h.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {toast && <div style={S.toast(toast.ok)} className="fade-in">{toast.msg}</div>}
      </div>
    );
  }

  // ─── MAIN VIEWS ────────────────────────────────────────────────────────────
  return (
    <div style={S.app}>
      <style>{CSS}</style>
      <header style={S.header}>
        <span style={S.logo}>ProcureDB</span>
        <nav style={{ display: "flex" }}>
          {["dashboard", "list", "compare", "tasks"].map(v => (
            <button key={v} style={S.navBtn(view === v)} onClick={() => setView(v)}>
              {v === "dashboard" ? "Dashboard" : v === "list" ? "Suppliers" : v === "compare" ? "Compare" : "Tasks"}
            </button>
          ))}
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {/* Sync status dot */}
          <div title={dbReady ? "Connected to cloud" : "Offline — saving locally"} style={{ width: 7, height: 7, borderRadius: "50%", background: syncing ? "#c8a444" : dbReady ? "#7cb87c" : "#666", boxShadow: dbReady && !syncing ? "0 0 6px #7cb87c66" : "none", transition: "all 0.3s" }} />
          {suppliers.length > 0 && (
            <button style={S.btn()} className="btn-hover" onClick={() => exportToCSV(suppliers)} title="Export to CSV">
              ↓ Export CSV
            </button>
          )}
          <button style={S.btn("primary")} className="btn-hover" onClick={() => { setForm({ ...emptySupplier }); setEditing("new"); }}>
            + Add Supplier
          </button>
        </div>
      </header>

      {/* Migration banner */}
      {showMigrate && (
        <div style={{ background: "#1a1e14", borderBottom: "1px solid #3a4a2a", padding: "10px 28px", display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 12, color: "#a8b88a" }}>📦 You have local supplier data — migrate it to the cloud so your whole team can access it.</span>
          <button style={{ ...S.btn("primary"), fontSize: 11 }} className="btn-hover" onClick={handleMigrateData} disabled={migrating}>
            {migrating ? "Migrating..." : "Migrate to Cloud"}
          </button>
          <button style={{ ...S.btn(), fontSize: 11 }} className="btn-hover" onClick={() => setShowMigrate(false)}>Dismiss</button>
        </div>
      )}

      <div style={S.main} className="fade-in">

        {/* DASHBOARD */}
        {view === "dashboard" && (
          <>
            <div style={S.statGrid}>
              {[
                { n: suppliers.length, l: "Total Suppliers", warn: false },
                { n: staleCount, l: "Stale Records", warn: staleCount > 0 },
                { n: suppliers.filter(s => healthScore(s) >= 75).length, l: "Healthy Records", warn: false },
                { n: history.length, l: "Activity Entries", warn: false },
              ].map((st, i) => (
                <div key={i} style={S.stat(st.warn)}>
                  <div style={S.statNum(st.warn)}>{st.n}</div>
                  <div style={S.statLabel}>{st.l}</div>
                </div>
              ))}
            </div>

            {staleCount > 0 && (
              <div style={{ ...S.card, borderColor: "#5a3030", background: "#191414" }}>
                <div style={{ ...S.sectionTitle, color: "#c85a5a", borderColor: "#2a1a1a" }}>⚠ Attention Required — {staleCount} Stale Record{staleCount > 1 ? "s" : ""}</div>
                {suppliers
                  .filter(s => daysSince(s.contactVerified) > STALE_CONTACT_DAYS || daysSince(s.priceVerified) > STALE_PRICE_DAYS)
                  .slice(0, 6)
                  .map(s => (
                    <div key={s.id} className="row-hover" style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid #221a1a", cursor: "pointer" }}
                      onClick={() => { setSelected(s); setView("supplier"); }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 13, color: "#c8bfb8" }}>{s.name}</span>
                        <span style={{ marginLeft: 8 }}><Tag label={s.category} color="#8a9a6a" /></span>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {daysSince(s.contactVerified) > STALE_CONTACT_DAYS && <span style={S.badge("#c85a5a")}>contact</span>}
                        {daysSince(s.priceVerified) > STALE_PRICE_DAYS && <span style={S.badge("#c8a444")}>price</span>}
                      </div>
                      <HealthBar score={healthScore(s)} />
                    </div>
                  ))}
                {staleCount > 6 && <div style={{ fontSize: 11, color: "#554040", marginTop: 10 }}>+{staleCount - 6} more — view Suppliers tab</div>}
              </div>
            )}

            {suppliers.length === 0 && (
              <div style={{ ...S.card, textAlign: "center", padding: "60px 40px", borderStyle: "dashed" }}>
                <div style={{ fontFamily: "monospace", fontSize: 13, color: "#444", marginBottom: 16 }}>No suppliers yet</div>
                <div style={{ fontSize: 12, color: "#333", marginBottom: 20 }}>Add your first supplier to start tracking data quality</div>
                <button style={S.btn("primary")} className="btn-hover" onClick={() => { setForm({ ...emptySupplier }); setEditing("new"); }}>+ Add First Supplier</button>
              </div>
            )}

            {history.length > 0 && (
              <div style={S.card}>
                <div style={S.sectionTitle}>Recent Activity</div>
                {history.slice(0, 8).map(h => {
                  const sup = suppliers.find(s => s.id === h.supplierId);
                  return (
                    <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid #1c1c1c" }}>
                      <Tag label={h.type} color={typeColors[h.type] || "#666"} />
                      <div style={{ flex: 1, fontSize: 12, color: "#888" }}>
                        {sup
                          ? <span style={{ color: "#bbb", cursor: "pointer", textDecoration: "none" }} onClick={() => { setSelected(sup); setView("supplier"); }}>{sup.name}</span>
                          : "Unknown"} — {h.text}
                      </div>
                      <div style={{ fontSize: 10, color: "#3a3a3a", fontFamily: "monospace" }}>{new Date(h.date).toLocaleDateString()}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* SUPPLIER LIST */}
        {view === "list" && (
          <div style={S.card}>
            <div style={{ display: "flex", gap: 10, marginBottom: 18, alignItems: "center" }}>
              <input style={{ ...S.input, maxWidth: 300 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, category, contact..." />
              <button style={S.btn(filterStale ? "primary" : "default")} className="btn-hover" onClick={() => setFilterStale(!filterStale)}>
                {filterStale ? "● Stale Only" : "Filter: Stale"}
              </button>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#444", fontFamily: "monospace" }}>{filtered.length} / {suppliers.length} suppliers</span>
            </div>

            {filtered.length === 0 && (
              <div style={{ padding: "48px 0", textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "#3a3a3a" }}>
                  {suppliers.length === 0 ? 'No suppliers yet. Click "+ Add Supplier" to begin.' : "No suppliers match your filter."}
                </div>
              </div>
            )}

            {filtered.length > 0 && (
              <>
                <div style={S.tableHead}>
                  <span>Supplier</span><span>Category</span><span>Contact</span><span>Price</span><span>Health</span><span>Flags</span>
                </div>
                {filtered.map(sup => {
                  const hs = healthScore(sup);
                  const cStale = daysSince(sup.contactVerified) > STALE_CONTACT_DAYS;
                  const pStale = daysSince(sup.priceVerified) > STALE_PRICE_DAYS;
                  return (
                    <div key={sup.id} className="row-hover" style={S.tableRow(cStale || pStale)}
                      onClick={() => { setSelected(sup); setView("supplier"); }}>
                      <span style={{ fontSize: 13, color: "#d4cfc8", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sup.name}</span>
                      <span style={{ fontSize: 12, color: "#666" }}>{sup.category}</span>
                      <span style={{ fontSize: 12, color: "#777", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sup.contact || "—"}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: "#aaa" }}>{sup.price ? `${sup.price}` : "—"}</span>
                      <HealthBar score={hs} />
                      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {cStale && <span style={S.badge("#c85a5a")}>contact</span>}
                        {pStale && <span style={S.badge("#c8a444")}>price</span>}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* COMPARE VIEW */}
        {view === "compare" && (() => {
          const cats = ["All", ...Array.from(new Set(suppliers.map(s => s.category)))];
          const pool = compareCategory === "All" ? suppliers : suppliers.filter(s => s.category === compareCategory);
          const toggleCompare = (id) => {
            setCompareSelected(prev =>
              prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 5 ? [...prev, id] : prev
            );
          };
          const comparing = suppliers.filter(s => compareSelected.includes(s.id));

          // Best supplier: weighted health score + price competitiveness
          let bestId = null;
          if (comparing.length > 1) {
            const scored = comparing.map(s => {
              const hs = healthScore(s);
              const p = parsePrice(s.price);
              const prices = comparing.map(x => parsePrice(x.price)).filter(Boolean);
              const minP = prices.length ? Math.min(...prices) : null;
              const priceScore = p && minP ? (minP / p) * 40 : 0;
              return { id: s.id, total: hs * 0.6 + priceScore };
            });
            bestId = scored.sort((a, b) => b.total - a.total)[0].id;
          }

          const rows = [
            { label: "Category", fn: s => s.category },
            { label: "Contact", fn: s => s.contact || "—" },
            { label: "Email", fn: s => s.email || "—" },
            { label: "Price", fn: s => s.price ? `${s.price}${s.priceUnit ? " / " + s.priceUnit : ""}` : "—", mono: true },
            { label: "Price Trend", fn: s => {
              const ph = priceHistory.filter(p => p.supplierId === s.id);
              const c = priceCreep(ph);
              if (c === null) return "No history";
              return `${c > 0 ? "▲" : "▼"} ${Math.abs(c).toFixed(1)}%`;
            }, color: s => {
              const ph = priceHistory.filter(p => p.supplierId === s.id);
              const c = priceCreep(ph);
              return c === null ? "#555" : c > 10 ? "#c85a5a" : c < 0 ? "#7cb87c" : "#aaa";
            }},
            { label: "Health Score", fn: s => healthScore(s), mono: true, color: s => {
              const hs = healthScore(s);
              return hs >= 75 ? "#7cb87c" : hs >= 40 ? "#c8a444" : "#c85a5a";
            }},
            { label: "Contact Age", fn: s => s.contactVerified ? `${daysSince(s.contactVerified)}d ago` : "Never", mono: true, color: s => daysSince(s.contactVerified) > STALE_CONTACT_DAYS ? "#c85a5a" : "#7cb87c" },
            { label: "Price Age", fn: s => s.priceVerified ? `${daysSince(s.priceVerified)}d ago` : "Never", mono: true, color: s => daysSince(s.priceVerified) > STALE_PRICE_DAYS ? "#c85a5a" : "#7cb87c" },
            { label: "Notes", fn: s => s.notes ? s.notes.slice(0, 60) + (s.notes.length > 60 ? "…" : "") : "—" },
          ];

          return (
            <div>
              <div style={S.card}>
                <div style={S.sectionTitle}>Step 1 — Filter by Category</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                  {cats.map(c => (
                    <button key={c} style={{ ...S.btn(compareCategory === c ? "primary" : "default") }}
                      className="btn-hover" onClick={() => { setCompareCategory(c); setCompareSelected([]); }}>
                      {c}
                    </button>
                  ))}
                </div>
                <div style={S.sectionTitle}>Step 2 — Select Suppliers to Compare (max 5)</div>
                {pool.length === 0 && <div style={{ fontSize: 12, color: "#444" }}>No suppliers in this category yet.</div>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
                  {pool.map(s => {
                    const checked = compareSelected.includes(s.id);
                    const hs = healthScore(s);
                    return (
                      <div key={s.id} onClick={() => toggleCompare(s.id)} style={{
                        padding: "12px 14px", borderRadius: 4, cursor: "pointer",
                        border: `1px solid ${checked ? "#8a9a6a" : "#252525"}`,
                        background: checked ? "#1a2016" : "#1a1a1a",
                        transition: "all 0.15s"
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: checked ? "#c8d4b8" : "#aaa" }}>{s.name}</div>
                          <div style={{ width: 14, height: 14, borderRadius: 2, border: `2px solid ${checked ? "#8a9a6a" : "#333"}`, background: checked ? "#8a9a6a" : "transparent", flexShrink: 0 }} />
                        </div>
                        <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{s.price || "No price set"}</div>
                        <div style={{ marginTop: 8 }}><HealthBar score={hs} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {comparing.length >= 2 && (
                <div style={S.card} className="fade-in">
                  <div style={S.sectionTitle}>Side-by-Side Comparison — {comparing.length} Suppliers</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", padding: "8px 14px", fontSize: 10, color: "#555", fontWeight: 400, letterSpacing: 1, textTransform: "uppercase", borderBottom: "1px solid #222", width: 130 }}>Field</th>
                          {comparing.map(s => (
                            <th key={s.id} style={{ textAlign: "left", padding: "8px 14px", borderBottom: "1px solid #222", minWidth: 170 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 13, color: "#d4cfc8", fontWeight: 600 }}>{s.name}</span>
                                {s.id === bestId && (
                                  <span style={{ fontSize: 9, padding: "2px 6px", background: "#8a9a6a22", color: "#8a9a6a", border: "1px solid #8a9a6a44", borderRadius: 2, fontFamily: "monospace", textTransform: "uppercase" }}>★ Best</span>
                                )}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? "#111" : "transparent" }}>
                            <td style={{ padding: "10px 14px", fontSize: 10, color: "#555", letterSpacing: 1, textTransform: "uppercase", borderBottom: "1px solid #1a1a1a", whiteSpace: "nowrap" }}>{row.label}</td>
                            {comparing.map(s => (
                              <td key={s.id} style={{ padding: "10px 14px", borderBottom: "1px solid #1a1a1a", fontFamily: row.mono ? "monospace" : "inherit", color: row.color ? row.color(s) : "#c8c4be", fontSize: 13 }}>
                                {String(row.fn(s))}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 14, fontSize: 11, color: "#3a3a3a" }}>
                    ★ Best = highest health score + lowest price, weighted. Click any supplier in the Suppliers tab to log a negotiation or update their record.
                  </div>
                </div>
              )}

              {comparing.length === 1 && (
                <div style={{ ...S.card, textAlign: "center", padding: "28px", color: "#555", fontSize: 13 }}>
                  Select at least one more supplier to see the comparison table.
                </div>
              )}

              {suppliers.length === 0 && (
                <div style={{ ...S.card, textAlign: "center", padding: "48px", color: "#444", fontSize: 13 }}>
                  No suppliers yet — add some from the Suppliers tab first.
                </div>
              )}
            </div>
          );
        })()}

        {/* TASKS VIEW */}
        {view === "tasks" && (() => {
          // Build task list from all suppliers
          const tasks = [];
          suppliers.forEach(s => {
            const contactAge = daysSince(s.contactVerified);
            const priceAge = daysSince(s.priceVerified);
            if (contactAge > STALE_CONTACT_DAYS) {
              tasks.push({ id: `${s.id}-contact`, supplierId: s.id, type: "contact", name: s.name, category: s.category, age: contactAge, label: "Verify contact details", urgency: contactAge > 180 ? "high" : "medium" });
            } else if (contactAge > 60) {
              tasks.push({ id: `${s.id}-contact-soon`, supplierId: s.id, type: "contact", name: s.name, category: s.category, age: contactAge, label: "Contact due for verification soon", urgency: "low" });
            }
            if (priceAge > STALE_PRICE_DAYS) {
              tasks.push({ id: `${s.id}-price`, supplierId: s.id, type: "price", name: s.name, category: s.category, age: priceAge, label: "Verify current pricing", urgency: priceAge > 120 ? "high" : "medium" });
            } else if (priceAge > 40) {
              tasks.push({ id: `${s.id}-price-soon`, supplierId: s.id, type: "price", name: s.name, category: s.category, age: priceAge, label: "Price due for verification soon", urgency: "low" });
            }
            if (!s.contact && !s.email) {
              tasks.push({ id: `${s.id}-missing`, supplierId: s.id, type: "contact", name: s.name, category: s.category, age: 9999, label: "Missing contact info entirely", urgency: "high" });
            }
            if (!s.price) {
              tasks.push({ id: `${s.id}-noprice`, supplierId: s.id, type: "price", name: s.name, category: s.category, age: 9999, label: "No price recorded", urgency: "high" });
            }
          });

          // Sort: high → medium → low, then by age desc
          const urgencyOrder = { high: 0, medium: 1, low: 2 };
          tasks.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency] || b.age - a.age);

          const high = tasks.filter(t => t.urgency === "high");
          const medium = tasks.filter(t => t.urgency === "medium");
          const low = tasks.filter(t => t.urgency === "low");

          const urgencyColor = { high: "#c85a5a", medium: "#c8a444", low: "#6a8a6a" };
          const urgencyBg = { high: "#1a1313", medium: "#1a1813", low: "#131a13" };
          const urgencyBorder = { high: "#5a3030", medium: "#5a4a20", low: "#2a3a2a" };

          const handleTaskDone = (task) => {
            if (task.type === "contact") handleVerifyContact(suppliers.find(s => s.id === task.supplierId));
            else handleVerifyPrice(suppliers.find(s => s.id === task.supplierId));
          };

          const TaskRow = ({ task }) => (
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", borderBottom: "1px solid #1c1c1c", background: urgencyBg[task.urgency] }}>
              <div style={{ width: 3, height: 36, borderRadius: 2, background: urgencyColor[task.urgency], flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#d4cfc8" }}>{task.name}</span>
                  <Tag label={task.category} color="#6a7a5a" />
                  <Tag label={task.type} color={task.type === "contact" ? "#6a8a9a" : "#9a8a6a"} />
                </div>
                <div style={{ fontSize: 12, color: "#888" }}>{task.label}
                  {task.age < 9999 && <span style={{ marginLeft: 8, fontFamily: "monospace", fontSize: 11, color: urgencyColor[task.urgency] }}>{task.age}d ago</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button style={S.btn()} className="btn-hover" onClick={() => { setSelected(suppliers.find(s => s.id === task.supplierId)); setView("supplier"); }}>View</button>
                <button style={{ ...S.btn("primary"), fontSize: 11 }} className="btn-hover" onClick={() => handleTaskDone(task)}>✓ Done</button>
              </div>
            </div>
          );

          return (
            <div>
              {/* Summary bar */}
              <div style={S.statGrid}>
                {[
                  { n: tasks.length, l: "Total Tasks", warn: tasks.length > 0 },
                  { n: high.length, l: "High Priority", warn: high.length > 0 },
                  { n: medium.length, l: "Medium Priority", warn: false },
                  { n: low.length, l: "Coming Up Soon", warn: false },
                ].map((st, i) => (
                  <div key={i} style={S.stat(st.warn)}>
                    <div style={S.statNum(st.warn)}>{st.n}</div>
                    <div style={S.statLabel}>{st.l}</div>
                  </div>
                ))}
              </div>

              {tasks.length === 0 && (
                <div style={{ ...S.card, textAlign: "center", padding: "60px 40px", borderColor: "#2a3a2a", background: "#131a13" }}>
                  <div style={{ fontSize: 20, marginBottom: 12 }}>✓</div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, color: "#7cb87c", marginBottom: 8 }}>All clear — no tasks pending</div>
                  <div style={{ fontSize: 12, color: "#3a4a3a" }}>All supplier data is up to date. Check back in a few weeks.</div>
                </div>
              )}

              {high.length > 0 && (
                <div style={{ ...S.card, padding: 0, overflow: "hidden", borderColor: urgencyBorder.high }}>
                  <div style={{ padding: "12px 16px", background: "#1a1313", borderBottom: "1px solid #2a1a1a" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "#c85a5a", letterSpacing: 2, textTransform: "uppercase" }}>⚠ High Priority — {high.length} task{high.length > 1 ? "s" : ""}</span>
                  </div>
                  {high.map(t => <TaskRow key={t.id} task={t} />)}
                </div>
              )}

              {medium.length > 0 && (
                <div style={{ ...S.card, padding: 0, overflow: "hidden", borderColor: urgencyBorder.medium }}>
                  <div style={{ padding: "12px 16px", background: "#1a1813", borderBottom: "1px solid #2a2010" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "#c8a444", letterSpacing: 2, textTransform: "uppercase" }}>Medium Priority — {medium.length} task{medium.length > 1 ? "s" : ""}</span>
                  </div>
                  {medium.map(t => <TaskRow key={t.id} task={t} />)}
                </div>
              )}

              {low.length > 0 && (
                <div style={{ ...S.card, padding: 0, overflow: "hidden", borderColor: urgencyBorder.low }}>
                  <div style={{ padding: "12px 16px", background: "#131a13", borderBottom: "1px solid #1a2a1a" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "#6a9a6a", letterSpacing: 2, textTransform: "uppercase" }}>Coming Up — {low.length} task{low.length > 1 ? "s" : ""}</span>
                  </div>
                  {low.map(t => <TaskRow key={t.id} task={t} />)}
                </div>
              )}

              {suppliers.length === 0 && (
                <div style={{ ...S.card, textAlign: "center", padding: "48px", color: "#444", fontSize: 13 }}>
                  No suppliers yet — add some from the Suppliers tab first.
                </div>
              )}
            </div>
          );
        })()}

      </div>

      {toast && <div style={S.toast(toast.ok)} className="fade-in">{toast.msg}</div>}
    </div>
  );
}
