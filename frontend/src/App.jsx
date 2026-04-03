/**
 * CodSec Chronicle SOAR Evaluator — React Frontend v3
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  AreaChart, Area,
} from "recharts";
import {
  Shield, Activity, AlertTriangle, CheckCircle, XCircle, Clock,
  Zap, TrendingUp, Layers, Link2, FileSearch, RefreshCw, Loader2,
  Plug, Webhook, Globe, Bot, Key, Users, Package, Briefcase, Code,
} from "lucide-react";

// ── API Service ──────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function apiFetch(endpoint, params = {}) {
  const url = new URL(`${API_BASE}${endpoint}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || `API error ${resp.status}`);
  }
  return resp.json();
}

const api = {
  overview: () => apiFetch("/api/overview"),
  playbooks: () => apiFetch("/api/playbooks"),
  cases: (days, status, severity) => apiFetch("/api/cases", { days, status, severity }),
  caseTrends: (days) => apiFetch("/api/cases/trends", { days }),
  connectors: () => apiFetch("/api/connectors"),
  webhooks: () => apiFetch("/api/webhooks"),
  environments: () => apiFetch("/api/environments"),
  agents: () => apiFetch("/api/agents"),
  apiKeys: () => apiFetch("/api/api-keys"),
  users: () => apiFetch("/api/users"),
  instances: () => apiFetch("/api/integration-instances"),
  jobs: () => apiFetch("/api/jobs"),
  ide: () => apiFetch("/api/ide"),
  findings: () => apiFetch("/api/findings"),
};

// ── Theme ─────────────────────────────────────────────────────────────

const theme = {
  bg: "#0a0212",
  bgCard: "#180433",
  border: "#2e0a5c",
  text: "#ffffff",
  textDim: "#a78bbf",
  textMuted: "#6b4f8a",
  accent: "#da009e",
  accentGlow: "rgba(218, 0, 158, 0.3)",
  gradient: "linear-gradient(135deg, #da009e 0%, #8b5cf6 50%, #4f8ff7 100%)",
  gradientText: "linear-gradient(135deg, #ff2db5 0%, #a855f7 50%, #6cb4ff 100%)",
  green: "#34d399",
  greenDim: "rgba(52, 211, 153, 0.15)",
  yellow: "#fbbf24",
  yellowDim: "rgba(251, 191, 36, 0.15)",
  red: "#f87171",
  redDim: "rgba(248, 113, 113, 0.15)",
  purple: "#a78bfa",
};

// ── Logo ─────────────────────────────────────────────────────────────

const CodSecLogo = ({ size = 36 }) => (
  <svg width={size * 1.8} height={size} viewBox="0 0 72 40" fill="none">
    <defs>
      <linearGradient id="pulseGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#da009e" />
        <stop offset="50%" stopColor="#a855f7" />
        <stop offset="100%" stopColor="#6cb4ff" />
      </linearGradient>
    </defs>
    <polyline points="0,20 10,20 14,8 18,32 22,14 26,26 30,20 42,20 46,4 50,36 54,20 72,20"
      stroke="url(#pulseGrad)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="46" cy="4" r="2.5" fill="#da009e" />
  </svg>
);

// ── Shared UI ─────────────────────────────────────────────────────────

const StatCard = ({ icon: Icon, label, value, sub, color, glow }) => (
  <div style={{
    background: theme.bgCard, borderRadius: 14, padding: "20px 22px",
    border: `1px solid ${theme.border}`, flex: "1 1 180px", minWidth: 170,
    position: "relative", overflow: "hidden",
  }}>
    {glow && <div style={{
      position: "absolute", top: -20, right: -20, width: 80, height: 80,
      borderRadius: "50%", background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`,
      pointerEvents: "none",
    }} />}
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      {Icon && <Icon size={16} color={color || theme.textMuted} />}
      <span style={{ fontSize: 12, color: theme.textDim, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</span>
    </div>
    <div style={{ fontSize: 30, fontWeight: 700, color: color || theme.text, lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 6 }}>{sub}</div>}
  </div>
);

const SeverityDot = ({ severity }) => {
  const c = severity === "CRITICAL" ? theme.red : severity === "HIGH" ? "#fb923c"
    : severity === "MEDIUM" ? theme.yellow : theme.textMuted;
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c, marginRight: 6 }} />;
};

const FindingCard = ({ finding }) => {
  const fc = finding.type === "critical" ? theme.red : finding.type === "warning" ? theme.yellow : theme.accent;
  return (
    <div style={{
      background: theme.bgCard, borderRadius: 14, padding: "18px 22px",
      border: `1px solid ${theme.border}`, borderLeft: `4px solid ${fc}`, marginBottom: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        {finding.type === "critical" ? <XCircle size={16} color={fc} /> :
         finding.type === "warning" ? <AlertTriangle size={16} color={fc} /> :
         <CheckCircle size={16} color={fc} />}
        <span style={{ fontWeight: 600, fontSize: 14 }}>{finding.title}</span>
      </div>
      <div style={{ fontSize: 13, color: theme.textDim, lineHeight: 1.6 }}>{finding.detail}</div>
    </div>
  );
};

const ScoreRing = ({ score, size = 130 }) => {
  const r = (size - 18) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <svg width={size} height={size}>
      <defs>
        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff2db5" />
          <stop offset="100%" stopColor="#6cb4ff" />
        </linearGradient>
      </defs>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={theme.border} strokeWidth={9} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="url(#ringGrad)" strokeWidth={9}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      <text x={size/2} y={size/2-4} textAnchor="middle" fill={theme.text} fontSize={32} fontWeight={700}>{score}</text>
      <text x={size/2} y={size/2+18} textAnchor="middle" fill={theme.textMuted} fontSize={12}>/100</text>
    </svg>
  );
};

const ErrorState = ({ message, onRetry }) => (
  <div style={{
    background: theme.redDim, border: `1px solid ${theme.red}33`, borderRadius: 14,
    padding: "24px 28px", textAlign: "center", margin: "20px 0",
  }}>
    <XCircle size={24} color={theme.red} style={{ marginBottom: 10 }} />
    <div style={{ color: theme.red, fontWeight: 600, marginBottom: 6 }}>Connection Error</div>
    <div style={{ color: theme.textDim, fontSize: 13, marginBottom: 14 }}>{message}</div>
    {onRetry && (
      <button onClick={onRetry} style={{
        background: theme.accent, color: "#fff", border: "none", borderRadius: 8,
        padding: "8px 20px", cursor: "pointer", fontSize: 13, fontWeight: 600,
      }}>Retry</button>
    )}
  </div>
);

const chartTooltipStyle = {
  contentStyle: { background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.text, fontSize: 12 },
  labelStyle: { color: theme.textDim },
};

// ── Loading Progress Bar ──────────────────────────────────────────────

function LoadingOverlay({ keys, loading }) {
  const total = keys.length;
  const done = keys.filter(k => loading[k] === false).length;
  const anyLoading = keys.some(k => loading[k] === true);
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);

  if (!anyLoading && pct === 100) return null;

  const size = 140;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "rgba(10, 2, 18, 0.85)", backdropFilter: "blur(6px)",
    }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id="loadGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#da009e" />
            <stop offset="50%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#6cb4ff" />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={theme.border} strokeWidth={stroke} />
        {/* Progress arc */}
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="url(#loadGrad)" strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
        {/* Percentage text */}
        <text x={size/2} y={size/2 - 6} textAnchor="middle" fill={theme.text} fontSize={28} fontWeight={700}>{pct}%</text>
        <text x={size/2} y={size/2 + 16} textAnchor="middle" fill={theme.textMuted} fontSize={11}>Loading</text>
      </svg>
      <div style={{ marginTop: 18, fontSize: 13, color: theme.textDim }}>
        {done} of {total} data sources
      </div>
    </div>
  );
}

// ── Generic DataTable ─────────────────────────────────────────────────

const PAGE_SIZE = 25;

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}> ↕</span>;
  return <span style={{ fontSize: 10, color: theme.accent }}> {sortDir === "asc" ? "↑" : "↓"}</span>;
}

function pageBtnStyle(disabled) {
  return {
    padding: "5px 10px", borderRadius: 6, border: `1px solid ${theme.border}`,
    background: "transparent", color: disabled ? theme.border : theme.textMuted,
    cursor: disabled ? "default" : "pointer", fontSize: 13, lineHeight: 1,
    opacity: disabled ? 0.4 : 1,
  };
}

function Pagination({ page, totalPages, setPage }) {
  const safe = Math.min(page, totalPages);
  const nums = Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
    if (totalPages <= 7) return i + 1;
    if (safe <= 4) return i + 1;
    if (safe >= totalPages - 3) return totalPages - 6 + i;
    return safe - 3 + i;
  });
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button onClick={() => setPage(1)} disabled={safe === 1} style={pageBtnStyle(safe === 1)}>«</button>
      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safe === 1} style={pageBtnStyle(safe === 1)}>‹</button>
      {nums.map(p => (
        <button key={p} onClick={() => setPage(p)} style={{
          ...pageBtnStyle(false),
          background: safe === p ? theme.accent : "transparent",
          color: safe === p ? "#fff" : theme.textMuted,
          border: `1px solid ${safe === p ? theme.accent : theme.border}`,
        }}>{p}</button>
      ))}
      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safe === totalPages} style={pageBtnStyle(safe === totalPages)}>›</button>
      <button onClick={() => setPage(totalPages)} disabled={safe === totalPages} style={pageBtnStyle(safe === totalPages)}>»</button>
    </div>
  );
}

/**
 * DataTable — generic sortable paginated table.
 *
 * columns: [{ key, label, render?, numeric?, noSort? }]
 * rows: array of objects
 * searchKeys: keys to match against search string
 * filters: [{ label, key, values: ["All", ...] }]  — optional
 * statsBar: JSX node rendered above filters
 */
function DataTable({ columns, rows, searchKeys = [], filters = [], statsBar, emptyMsg = "No results." }) {
  const [sortCol, setSortCol] = useState(columns[0]?.key || "");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterVals, setFilterVals] = useState(() =>
    Object.fromEntries(filters.map(f => [f.key, "All"]))
  );

  const filtered = useMemo(() => {
    let r = rows;
    for (const f of filters) {
      if (filterVals[f.key] !== "All") r = r.filter(row => String(row[f.key]) === filterVals[f.key]);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(row => searchKeys.some(k => String(row[k] ?? "").toLowerCase().includes(q)));
    }
    const col = columns.find(c => c.key === sortCol);
    return [...r].sort((a, b) => {
      let av = col?.getValue ? col.getValue(a) : (a[sortCol] ?? "");
      let bv = col?.getValue ? col.getValue(b) : (b[sortCol] ?? "");
      if (typeof av === "number" && typeof bv === "number")
        return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [rows, sortCol, sortDir, search, filterVals, filters, searchKeys, columns]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleSort = (key) => {
    if (sortCol === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(key); setSortDir("asc"); }
    setPage(1);
  };

  const thS = (key, noSort) => ({
    padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600,
    color: theme.textMuted, cursor: noSort ? "default" : "pointer", userSelect: "none",
    borderBottom: `1px solid ${theme.border}`,
    background: !noSort && sortCol === key ? `${theme.border}55` : "transparent",
    whiteSpace: "nowrap",
  });

  const tdS = { padding: "10px 14px", fontSize: 13, borderBottom: `1px solid ${theme.border}22`, verticalAlign: "middle" };

  return (
    <>
      {statsBar && <div style={{ marginBottom: 20 }}>{statsBar}</div>}

      {/* Filters row */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {searchKeys.length > 0 && (
          <input
            placeholder="Search…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{
              flex: "1 1 200px", padding: "7px 12px", borderRadius: 8,
              border: `1px solid ${theme.border}`, background: theme.bgCard,
              color: theme.text, fontSize: 13, outline: "none",
            }}
          />
        )}
        {filters.map(f => (
          <div key={f.key} style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: theme.textMuted, marginRight: 2 }}>{f.label}:</span>
            {f.values.map(v => (
              <button key={v} onClick={() => { setFilterVals(prev => ({ ...prev, [f.key]: v })); setPage(1); }} style={{
                padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${filterVals[f.key] === v ? theme.accent : theme.border}`,
                background: filterVals[f.key] === v ? `${theme.accent}22` : theme.bgCard,
                color: filterVals[f.key] === v ? theme.accent : theme.textMuted,
              }}>{v}</button>
            ))}
          </div>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: theme.textMuted }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col.key} style={thS(col.key, col.noSort)} onClick={() => !col.noSort && handleSort(col.key)}>
                    {col.label}{!col.noSort && <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={columns.length} style={{ ...tdS, textAlign: "center", color: theme.textMuted, padding: 32 }}>
                  {emptyMsg}
                </td></tr>
              ) : pageRows.map((row, i) => (
                <tr key={row._key || i}
                  style={{ transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = `${theme.border}22`}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  {columns.map(col => (
                    <td key={col.key} style={{ ...tdS, ...(col.tdStyle || {}) }}>
                      {col.render ? col.render(row) : (row[col.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderTop: `1px solid ${theme.border}`, fontSize: 12, color: theme.textMuted,
        }}>
          <span>
            Showing {filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <Pagination page={safePage} totalPages={totalPages} setPage={setPage} />
        </div>
      </div>
    </>
  );
}

// Helper: yes/no badge
const YesNo = ({ val, yesColor, noColor }) => (
  <span style={{ color: val ? (yesColor || theme.green) : (noColor || theme.textMuted), fontWeight: 500 }}>
    {val ? "Yes" : "No"}
  </span>
);

function VersionRiskBadge({ risk }) {
  const map = {
    high:    { label: "High",    bg: "#3d1a1a", color: "#f87171" },
    medium:  { label: "Medium",  bg: "#3d2e10", color: "#fbbf24" },
    low:     { label: "Low",     bg: "#132d1f", color: "#4ade80" },
    ok:      { label: "OK",      bg: "transparent", color: "#6b7280" },
    unknown: { label: "Unknown", bg: "transparent", color: "#6b7280" },
  };
  const s = map[risk] || map.unknown;
  return (
    <span style={{
      background: s.bg, color: s.color,
      borderRadius: 6, padding: "2px 8px",
      fontSize: 11, fontWeight: 600,
      border: s.bg !== "transparent" ? `1px solid ${s.color}33` : "none",
    }}>{s.label}</span>
  );
}

// Helper: tag pill
const Tag = ({ children }) => (
  <span style={{
    fontSize: 10, padding: "2px 7px", borderRadius: 20,
    background: `${theme.border}88`, color: theme.textDim,
    border: `1px solid ${theme.border}`, fontFamily: "monospace", whiteSpace: "nowrap",
  }}>{children}</span>
);

// ── Tab Definitions ───────────────────────────────────────────────────

const TABS = [
  { id: "overview",     label: "Overview",     icon: Activity },
  { id: "playbooks",    label: "Playbooks",    icon: Layers },
  { id: "cases",        label: "Cases",        icon: FileSearch },
  { id: "connectors",   label: "Connectors",   icon: Plug },
  { id: "webhooks",     label: "Webhooks",     icon: Webhook },
  { id: "environments", label: "Environments", icon: Globe },
  { id: "agents",       label: "Agents",       icon: Bot },
  { id: "users",        label: "Users",        icon: Users },
  { id: "instances",    label: "Instances",    icon: Package },
  { id: "jobs",         label: "Jobs",         icon: Briefcase },
  { id: "ide",          label: "IDE",          icon: Code },
  { id: "findings",     label: "Findings",     icon: AlertTriangle },
];

// ── Status badge helper ───────────────────────────────────────────────

function StatusBadge({ val, trueLabel = "Active", falseLabel = "Disabled", trueColor, falseColor }) {
  const isTrue = val === true || val === trueLabel || val === "Yes" || val === "Live" || val === "Enabled";
  const label = isTrue ? trueLabel : falseLabel;
  const color = isTrue ? (trueColor || theme.green) : (falseColor || theme.yellow);
  const bg = isTrue ? theme.greenDim : theme.yellowDim;
  return (
    <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600, color, background: bg, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// ── Main App ──────────────────────────────────────────────────────────

const ALL_KEYS = ["overview", "playbooks", "cases", "trends", "connectors", "webhooks",
  "environments", "agents", "apiKeys", "users", "instances", "jobs", "ide", "findings"];

export default function App() {
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});

  const fetchData = useCallback(async (key, fetcher) => {
    setLoading(prev => ({ ...prev, [key]: true }));
    setErrors(prev => ({ ...prev, [key]: null }));
    try {
      const result = await fetcher();
      setData(prev => ({ ...prev, [key]: result }));
    } catch (e) {
      setErrors(prev => ({ ...prev, [key]: e.message }));
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  }, []);

  const loadAll = useCallback(() => {
    fetchData("overview", api.overview);
    fetchData("playbooks", api.playbooks);
    fetchData("cases", () => api.cases(30));
    fetchData("trends", () => api.caseTrends(90));
    fetchData("connectors", api.connectors);
    fetchData("webhooks", api.webhooks);
    fetchData("environments", api.environments);
    fetchData("agents", api.agents);
    fetchData("apiKeys", api.apiKeys);
    fetchData("users", api.users);
    fetchData("instances", api.instances);
    fetchData("jobs", api.jobs);
    fetchData("ide", api.ide);
    fetchData("findings", api.findings);
  }, [fetchData]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const ov = data.overview || {};
  const anyLoading = Object.values(loading).some(Boolean);

  // ── Playbooks columns ─────────────────────────────────────────────
  const pbRows = (data.playbooks?.playbooks || []).map((p, i) => ({ ...p, _key: p.id || i }));
  const pbCols = [
    {
      key: "name", label: "Playbook Name",
      tdStyle: { fontWeight: 600, maxWidth: 260 },
      render: r => (
        <div>
          <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 250 }} title={r.name}>{r.name}</div>
          {r.description && <div style={{ fontSize: 11, color: theme.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 250 }} title={r.description}>{r.description}</div>}
        </div>
      ),
    },
    { key: "status", label: "Status", render: r => <StatusBadge val={r.status} trueLabel="Active" falseLabel="Disabled" /> },
    { key: "playbookType", label: "Type", render: r => <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: theme.border, color: theme.textMuted }}>{r.playbookType || "Playbook"}</span> },
    {
      key: "integrations", label: "Integrations", noSort: false,
      getValue: r => (r.integrations || []).length,
      tdStyle: { maxWidth: 280 },
      render: r => (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {(r.integrations || []).length === 0
            ? <span style={{ color: theme.textMuted, fontSize: 11 }}>—</span>
            : (r.integrations || []).map(t => <Tag key={t}>{t}</Tag>)}
        </div>
      ),
    },
    { key: "steps", label: "Steps", getValue: r => r.steps || 0, tdStyle: { textAlign: "center" }, render: r => r.steps || 0 },
    { key: "category", label: "Category", tdStyle: { fontSize: 11, color: theme.textMuted, fontFamily: "monospace", whiteSpace: "nowrap" } },
    { key: "updateTime", label: "Last Modified", tdStyle: { fontSize: 11, color: theme.textMuted, fontFamily: "monospace", whiteSpace: "nowrap" }, render: r => r.updateTime ? r.updateTime.slice(0, 10) : "—" },
  ];

  // ── Connectors: flatten grouped object into rows ───────────────────
  const connRows = Object.entries(data.connectors?.connectors || {}).flatMap(([intg, cards]) =>
    cards.map((c, i) => ({ ...c, _intg: intg, _key: `${intg}-${i}` }))
  );
  const connCols = [
    { key: "name", label: "Connector Name", tdStyle: { fontWeight: 500 } },
    { key: "_intg", label: "Integration", tdStyle: { color: theme.textDim, fontFamily: "monospace", fontSize: 12 } },
    { key: "isEnabled", label: "Enabled", render: r => <YesNo val={r.isEnabled} /> },
  ];

  // ── Webhooks ──────────────────────────────────────────────────────
  const whRows = (data.webhooks?.webhooks || []).map((w, i) => ({ ...w, _key: i, _name: w.name || w.identifier }));
  const whCols = [
    { key: "_name", label: "Name", tdStyle: { fontWeight: 500 } },
    { key: "environment", label: "Environment", tdStyle: { color: theme.textDim } },
    { key: "isEnabled", label: "Enabled", render: r => <YesNo val={r.isEnabled} /> },
  ];

  // ── Agents ────────────────────────────────────────────────────────
  const agentRows = (data.agents?.agents || []).map((a, i) => ({ ...a, _key: i, _envs: (a.environments || []).join(", ") || "—" }));
  const agentCols = [
    { key: "name", label: "Name", tdStyle: { fontWeight: 500 } },
    {
      key: "status", label: "Status",
      render: r => (
        <span style={{
          color: r.status === "Live" ? theme.green : r.status === "Failed" ? theme.red : theme.yellow,
          fontWeight: 600, fontSize: 12,
        }}>{r.status}</span>
      ),
    },
    { key: "_envs", label: "Environments", tdStyle: { color: theme.textDim, fontSize: 12 } },
  ];

  // ── Users ─────────────────────────────────────────────────────────
  const userRows = (data.users?.users || []).map((u, i) => ({
    ...u, _key: i,
    _roles: (u.socRoles || []).join(", ") || "—",
    _envs: (u.environments || []).join(", ") || "—",
  }));
  const userCols = [
    { key: "email", label: "Email", tdStyle: { fontWeight: 500 } },
    { key: "_roles", label: "Roles", tdStyle: { color: theme.textDim, fontSize: 12 } },
    { key: "providerName", label: "Provider", tdStyle: { color: theme.textDim, fontSize: 12 } },
    { key: "_envs", label: "Environments", tdStyle: { color: theme.textMuted, fontSize: 12 } },
    { key: "isDisabled", label: "Disabled", render: r => <YesNo val={r.isDisabled} yesColor={theme.red} noColor={theme.green} /> },
  ];

  // ── Instances ─────────────────────────────────────────────────────
  const instRows = (data.instances?.instances || []).map((inst, i) => ({ ...inst, _key: i }));
  const instCols = [
    { key: "environment", label: "Environment", tdStyle: { color: theme.textDim } },
    { key: "type", label: "Integration Type", tdStyle: { fontWeight: 500 } },
    { key: "name", label: "Instance Name" },
    { key: "isRemote", label: "Remote", render: r => <YesNo val={r.isRemote} yesColor={theme.purple} noColor={theme.textMuted} /> },
  ];

  // ── Jobs ─────────────────────────────────────────────────────────
  const jobRows = (data.jobs?.jobs || []).map((j, i) => ({ ...j, _key: i }));
  const jobCols = [
    { key: "name", label: "Name", tdStyle: { fontWeight: 500 } },
    { key: "integration", label: "Integration", tdStyle: { color: theme.textDim } },
    { key: "isEnabled", label: "Enabled", render: r => <YesNo val={r.isEnabled} /> },
    { key: "isCustom", label: "Custom", render: r => <YesNo val={r.isCustom} yesColor={theme.purple} noColor={theme.textMuted} /> },
  ];

  // ── IDE Integrations ──────────────────────────────────────────────
  const ideRows = (data.ide?.integrations || []).map((intg, i) => ({ ...intg, _key: i }));
  const ideCols = [
    { key: "name", label: "Integration", tdStyle: { fontWeight: 500 } },
    { key: "isCustom", label: "Custom", render: r => <YesNo val={r.isCustom} yesColor={theme.purple} noColor={theme.textMuted} /> },
    { key: "installedVersion", label: "Installed", tdStyle: { fontFamily: "monospace", fontSize: 12 } },
    { key: "latestVersion",    label: "Latest",    tdStyle: { fontFamily: "monospace", fontSize: 12 } },
    { key: "versionRisk",      label: "Risk",      render: r => <VersionRiskBadge risk={r.versionRisk} /> },
    {
      key: "actions", label: "Actions", noSort: true,
      render: r => (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {(r.actions || []).slice(0, 8).map((a, j) => (
            <span key={j} style={{ background: theme.border, borderRadius: 6, padding: "2px 8px", fontSize: 11, color: theme.textDim }}>{a}</span>
          ))}
          {(r.actions || []).length > 8 && <span style={{ fontSize: 11, color: theme.textMuted }}>+{r.actions.length - 8} more</span>}
        </div>
      ),
    },
  ];

  return (
    <div style={{ background: theme.bg, color: theme.text, minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .spinning { animation: spin 1s linear infinite }
      `}</style>

      {/* Global loading overlay */}
      <LoadingOverlay keys={ALL_KEYS} loading={loading} />

      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 28px", borderBottom: `1px solid ${theme.border}`,
        background: `linear-gradient(180deg, ${theme.bgCard} 0%, ${theme.bg} 100%)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <CodSecLogo size={44} />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>
              <span style={{ background: theme.gradientText, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>CODSEC</span>
              <span style={{ color: theme.textDim, fontWeight: 400, marginLeft: 8 }}>Pulse</span>
            </h1>
            <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>Google Chronicle SOAR Assessment</div>
          </div>
        </div>
        <button onClick={loadAll} style={{
          display: "flex", alignItems: "center", gap: 6, background: "transparent",
          border: `1px solid ${theme.border}`, borderRadius: 10, padding: "8px 16px",
          color: theme.textDim, cursor: "pointer", fontSize: 12, fontWeight: 500,
        }}>
          <RefreshCw size={14} className={anyLoading ? "spinning" : ""} /> Refresh
        </button>
      </header>

      {/* Tabs */}
      <nav style={{ display: "flex", gap: 2, padding: "12px 28px", borderBottom: `1px solid ${theme.border}`, overflowX: "auto" }}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "9px 20px",
              borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: active ? theme.accent : "transparent",
              color: active ? "#fff" : theme.textMuted,
              transition: "all 0.15s", whiteSpace: "nowrap",
              boxShadow: active ? `0 0 20px ${theme.accentGlow}` : "none",
            }}>
              <t.icon size={15} />{t.label}
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <main style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>

        {/* OVERVIEW */}
        {tab === "overview" && (
          errors.overview ? <ErrorState message={errors.overview} onRetry={() => fetchData("overview", api.overview)} /> : (
            <>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                <StatCard icon={Layers} label="Playbooks" value={ov.totalPlaybooks || 0} sub={`${ov.activePlaybooks || 0} active · ${ov.disabledPlaybooks || 0} disabled`} />
                <StatCard icon={FileSearch} label="Cases (30d)" value={(ov.totalCases30d || 0).toLocaleString()} color={theme.accent} glow={theme.accentGlow} />
                <StatCard icon={Clock} label="Avg MTTR" value={`${ov.avgMttrHours || 0}h`} sub="Mean time to resolve" />
                <StatCard icon={Zap} label="Close Rate" value={`${ov.automationRate || 0}%`} color={theme.green} glow={theme.greenDim} sub="Closed / total cases (90d)" />
                <StatCard
                  icon={AlertTriangle}
                  label="Outdated Integrations"
                  value={(ov.outdatedHigh || 0) + (ov.outdatedMedium || 0)}
                  color={(ov.outdatedHigh || 0) > 0 ? "#f87171" : theme.yellow}
                  glow={(ov.outdatedHigh || 0) > 0 ? "#f8717133" : undefined}
                  sub={`${ov.outdatedHigh || 0} major · ${ov.outdatedMedium || 0} minor behind`}
                />
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <div style={{ background: theme.bgCard, borderRadius: 14, padding: 22, border: `1px solid ${theme.border}`, flex: "2 1 360px" }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Case Volume Trend</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 11, color: theme.textMuted, marginBottom: 12 }}>
                    <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: theme.accent, marginRight: 5 }} />Closed</span>
                    <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: theme.purple, marginRight: 5 }} />Open</span>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={ov.caseTrends || []}>
                      <defs>
                        <linearGradient id="autoGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={theme.accent} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={theme.accent} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
                      <XAxis dataKey="month" tick={{ fill: theme.textMuted, fontSize: 11 }} />
                      <YAxis tick={{ fill: theme.textMuted, fontSize: 11 }} />
                      <Tooltip {...chartTooltipStyle} />
                      <Area type="monotone" dataKey="automated" stroke={theme.accent} fill="url(#autoGrad)" strokeWidth={2} />
                      <Area type="monotone" dataKey="manual" stroke={theme.purple} fill="transparent" strokeWidth={2} strokeDasharray="5 5" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ background: theme.bgCard, borderRadius: 14, padding: 22, border: `1px solid ${theme.border}`, flex: "1 1 200px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Maturity Score</div>
                  <ScoreRing score={ov.maturityScore || 0} />
                  <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 10, textAlign: "center" }}>
                    {(ov.maturityScore || 0) >= 80 ? "Excellent" : (ov.maturityScore || 0) >= 60 ? "Good — room to improve" : "Needs attention"}
                  </div>
                </div>
              </div>
            </>
          )
        )}

        {/* PLAYBOOKS */}
        {tab === "playbooks" && (
          errors.playbooks ? <ErrorState message={errors.playbooks} onRetry={() => fetchData("playbooks", api.playbooks)} /> : (
            <DataTable
              columns={pbCols}
              rows={pbRows}
              searchKeys={["name", "category"]}
              filters={[
                { key: "status", label: "Status", values: ["All", "Active", "Disabled"] },
                { key: "playbookType", label: "Type", values: ["All", "Playbook", "Block"] },
              ]}
              statsBar={
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <StatCard icon={Layers} label="Total" value={pbRows.length} />
                  <StatCard icon={CheckCircle} label="Active" value={pbRows.filter(p => p.status === "Active").length} color={theme.green} />
                  <StatCard icon={XCircle} label="Disabled" value={pbRows.filter(p => p.status === "Disabled").length} color={theme.yellow} />
                  <StatCard icon={Link2} label="Integrations Used" value={[...new Set(pbRows.flatMap(p => p.integrations || []))].length} color={theme.purple} />
                </div>
              }
              emptyMsg="No playbooks match your filters."
            />
          )
        )}

        {/* CASES */}
        {tab === "cases" && (
          errors.cases ? <ErrorState message={errors.cases} onRetry={() => fetchData("cases", () => api.cases(30))} /> : (
            <>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                <StatCard icon={FileSearch} label="Total Cases" value={(data.cases?.total_cases || 0).toLocaleString()} sub="Last 30 days" />
                <StatCard icon={Clock} label="Avg MTTR" value={`${data.cases?.avg_mttr_hours || 0}h`} color={theme.accent} />
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <div style={{ background: theme.bgCard, borderRadius: 14, padding: 22, border: `1px solid ${theme.border}`, flex: "1 1 300px" }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Severity Breakdown</div>
                  {Object.entries(data.cases?.severity_breakdown || {}).map(([sev, count]) => (
                    <div key={sev} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                      <SeverityDot severity={sev} />
                      <span style={{ flex: 1, fontSize: 13 }}>{sev}</span>
                      <span style={{ fontWeight: 700, minWidth: 40, textAlign: "right" }}>{count}</span>
                      <div style={{ width: 100, height: 6, background: theme.border, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: 3,
                          width: `${Math.min((count / Math.max(...Object.values(data.cases?.severity_breakdown || { x: 1 }))) * 100, 100)}%`,
                          background: sev === "CRITICAL" ? theme.red : sev === "HIGH" ? "#fb923c" : sev === "MEDIUM" ? theme.yellow : theme.textMuted,
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ background: theme.bgCard, borderRadius: 14, padding: 22, border: `1px solid ${theme.border}`, flex: "1 1 300px" }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Status Distribution</div>
                  {Object.entries(data.cases?.status_breakdown || {}).map(([st, count]) => (
                    <div key={st} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                      <span style={{ flex: 1, fontSize: 13, color: theme.textDim }}>{st.replace(/_/g, " ")}</span>
                      <span style={{ fontWeight: 700 }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )
        )}

        {/* CONNECTORS */}
        {tab === "connectors" && (
          errors.connectors ? <ErrorState message={errors.connectors} onRetry={() => fetchData("connectors", api.connectors)} /> : (
            <DataTable
              columns={connCols}
              rows={connRows}
              searchKeys={["name", "_intg"]}
              filters={[{ key: "isEnabled", label: "Enabled", values: ["All", "true", "false"] }]}
              statsBar={
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <StatCard icon={Plug} label="Total Connectors" value={data.connectors?.total || 0} />
                  <StatCard icon={CheckCircle} label="Integrations" value={Object.keys(data.connectors?.connectors || {}).length} color={theme.green} />
                  <StatCard icon={CheckCircle} label="Enabled" value={connRows.filter(c => c.isEnabled).length} color={theme.green} />
                </div>
              }
              emptyMsg="No connectors found."
            />
          )
        )}

        {/* WEBHOOKS */}
        {tab === "webhooks" && (
          errors.webhooks ? <ErrorState message={errors.webhooks} onRetry={() => fetchData("webhooks", api.webhooks)} /> : (
            <DataTable
              columns={whCols}
              rows={whRows}
              searchKeys={["_name", "environment"]}
              filters={[{ key: "isEnabled", label: "Enabled", values: ["All", "true", "false"] }]}
              statsBar={
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <StatCard icon={Webhook} label="Total Webhooks" value={data.webhooks?.total || 0} />
                  <StatCard icon={CheckCircle} label="Enabled" value={whRows.filter(w => w.isEnabled).length} color={theme.green} />
                </div>
              }
              emptyMsg="No webhooks found."
            />
          )
        )}

        {/* ENVIRONMENTS */}
        {tab === "environments" && (
          errors.environments ? <ErrorState message={errors.environments} onRetry={() => fetchData("environments", api.environments)} /> : (
            <>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                <StatCard icon={Globe} label="Environments" value={data.environments?.total || 0} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {(data.environments?.environments || []).map((env, i) => (
                  <div key={i} style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 500 }}>{env}</div>
                ))}
              </div>
            </>
          )
        )}

        {/* AGENTS */}
        {tab === "agents" && (
          errors.agents ? <ErrorState message={errors.agents} onRetry={() => fetchData("agents", api.agents)} /> : (
            <DataTable
              columns={agentCols}
              rows={agentRows}
              searchKeys={["name", "_envs"]}
              filters={[{ key: "status", label: "Status", values: ["All", "Live", "Failed", "Unknown"] }]}
              statsBar={
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <StatCard icon={Bot} label="Total Agents" value={data.agents?.total || 0} />
                  <StatCard icon={CheckCircle} label="Live" value={agentRows.filter(a => a.status === "Live").length} color={theme.green} />
                  <StatCard icon={XCircle} label="Failed" value={agentRows.filter(a => a.status === "Failed").length} color={theme.red} />
                </div>
              }
              emptyMsg="No agents found."
            />
          )
        )}

        {/* USERS */}
        {tab === "users" && (
          errors.users ? <ErrorState message={errors.users} onRetry={() => fetchData("users", api.users)} /> : (
            <DataTable
              columns={userCols}
              rows={userRows}
              searchKeys={["email", "_roles", "providerName"]}
              filters={[{ key: "isDisabled", label: "Disabled", values: ["All", "true", "false"] }]}
              statsBar={
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <StatCard icon={Users} label="Total Users" value={data.users?.total || 0} />
                  <StatCard icon={XCircle} label="Disabled" value={userRows.filter(u => u.isDisabled).length} color={theme.red} />
                  <StatCard icon={CheckCircle} label="Active" value={userRows.filter(u => !u.isDisabled).length} color={theme.green} />
                </div>
              }
              emptyMsg="No users found."
            />
          )
        )}

        {/* INTEGRATION INSTANCES */}
        {tab === "instances" && (
          errors.instances ? <ErrorState message={errors.instances} onRetry={() => fetchData("instances", api.instances)} /> : (
            <DataTable
              columns={instCols}
              rows={instRows}
              searchKeys={["environment", "type", "name"]}
              filters={[{ key: "isRemote", label: "Remote", values: ["All", "true", "false"] }]}
              statsBar={
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <StatCard icon={Package} label="Total Instances" value={data.instances?.total || 0} />
                  <StatCard icon={Bot} label="Remote" value={instRows.filter(i => i.isRemote).length} color={theme.purple} />
                </div>
              }
              emptyMsg="No instances found."
            />
          )
        )}

        {/* JOBS */}
        {tab === "jobs" && (
          errors.jobs ? <ErrorState message={errors.jobs} onRetry={() => fetchData("jobs", api.jobs)} /> : (
            <DataTable
              columns={jobCols}
              rows={jobRows}
              searchKeys={["name", "integration"]}
              filters={[
                { key: "isEnabled", label: "Enabled", values: ["All", "true", "false"] },
                { key: "isCustom", label: "Custom", values: ["All", "true", "false"] },
              ]}
              statsBar={
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <StatCard icon={Briefcase} label="Total Jobs" value={data.jobs?.total || 0} />
                  <StatCard icon={CheckCircle} label="Enabled" value={jobRows.filter(j => j.isEnabled).length} color={theme.green} />
                  <StatCard icon={Code} label="Custom" value={jobRows.filter(j => j.isCustom).length} color={theme.purple} />
                </div>
              }
              emptyMsg="No jobs found."
            />
          )
        )}

        {/* IDE */}
        {tab === "ide" && (
          errors.ide ? <ErrorState message={errors.ide} onRetry={() => fetchData("ide", api.ide)} /> : (
            <DataTable
              columns={ideCols}
              rows={ideRows}
              searchKeys={["name"]}
              filters={[
                { key: "isCustom", label: "Custom", values: ["All", "true", "false"] },
                { key: "versionRisk", label: "Risk", values: ["All", "high", "medium", "low", "ok", "unknown"] },
              ]}
              statsBar={
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <StatCard icon={Code} label="Integrations" value={data.ide?.total || 0} />
                  <StatCard icon={Zap} label="Custom" value={ideRows.filter(i => i.isCustom).length} color={theme.purple} />
                  <StatCard icon={AlertTriangle} label="High Risk" value={ideRows.filter(i => i.versionRisk === "high").length} color="#f87171" />
                  <StatCard icon={AlertTriangle} label="Medium Risk" value={ideRows.filter(i => i.versionRisk === "medium").length} color={theme.yellow} />
                </div>
              }
              emptyMsg="No integrations match your filters."
            />
          )
        )}

        {/* FINDINGS */}
        {tab === "findings" && (
          errors.findings ? <ErrorState message={errors.findings} onRetry={() => fetchData("findings", api.findings)} /> : (
            <>
              <p style={{ fontSize: 13, color: theme.textMuted, marginTop: 0, marginBottom: 18 }}>
                Automated assessment based on environment scan — {(data.findings?.findings || []).length} findings detected.
              </p>
              {(data.findings?.findings || []).map((f, i) => <FindingCard key={i} finding={f} />)}
            </>
          )
        )}

      </main>
    </div>
  );
}
