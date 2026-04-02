/**
 * CodSec Chronicle SOAR Evaluator — React Frontend
 * ==================================================
 * Setup:
 *   npm create vite@latest codsec-frontend -- --template react
 *   cd codsec-frontend
 *   npm install recharts lucide-react
 *   Replace src/App.jsx with this file
 *   Replace src/App.css with the provided CSS
 *   npm run dev
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  AreaChart, Area, PieChart, Pie,
} from "recharts";
import {
  Shield, Activity, AlertTriangle, CheckCircle, XCircle, Clock,
  Zap, TrendingUp, Layers, Link2, FileSearch, RefreshCw, Loader2,
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
  health: () => apiFetch("/api/health"),
  connect: (body) => fetch(`${API_BASE}/api/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({ detail: r.statusText })); throw new Error(e.detail || `Error ${r.status}`); } return r.json(); }),
  disconnect: () => fetch(`${API_BASE}/api/disconnect`, { method: "POST" }).then(r => r.json()),
  overview: () => apiFetch("/api/overview"),
  playbooks: () => apiFetch("/api/playbooks"),
  playbookRuns: (id, days) => apiFetch(`/api/playbooks/${id}/runs`, { days }),
  cases: (days, status, severity) => apiFetch("/api/cases", { days, status, severity }),
  caseTrends: (days) => apiFetch("/api/cases/trends", { days }),
  integrations: () => apiFetch("/api/integrations"),
  findings: () => apiFetch("/api/findings"),
};

// ── CodSec Brand Colors ──────────────────────────────────────────────

const theme = {
  bg: "#0a0212",         // deep dark purple-black
  bgCard: "#180433",     // card background
  bgCardHover: "#220845",
  border: "#2e0a5c",
  borderLight: "#3e0259",
  text: "#ffffff",
  textDim: "#a78bbf",
  textMuted: "#6b4f8a",
  accent: "#da009e",     // primary CodSec pink
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

// ── Logo Component ───────────────────────────────────────────────────

const CodSecLogo = ({ size = 36 }) => (
  <svg width={size} height={size * 0.6} viewBox="0 0 100 60" fill="none">
    <defs>
      <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ff2db5" />
        <stop offset="50%" stopColor="#a855f7" />
        <stop offset="100%" stopColor="#6cb4ff" />
      </linearGradient>
    </defs>
    {/* Infinity / double-loop mark approximating the CodSec logo */}
    <path
      d="M30 15 C10 15, 5 45, 25 45 C38 45, 42 30, 50 30 C58 30, 62 45, 75 45 C95 45, 90 15, 70 15 C57 15, 53 30, 50 30 C47 30, 43 15, 30 15 Z"
      stroke="url(#logoGrad)" strokeWidth="6" fill="none" strokeLinecap="round"
    />
    {/* Inner accent dot */}
    <circle cx="70" cy="26" r="5" fill="url(#logoGrad)" />
  </svg>
);

// ── Shared UI Components ─────────────────────────────────────────────

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

const Badge = ({ children, color, bg }) => (
  <span style={{
    fontSize: 11, fontWeight: 600, color, background: bg,
    padding: "3px 12px", borderRadius: 20, whiteSpace: "nowrap",
  }}>{children}</span>
);

const StatusBadge = ({ status }) => {
  const c = status === "Healthy" || status === "Active" ? theme.green
    : status === "Degraded" || status === "Disabled" ? theme.yellow : theme.red;
  const bg = status === "Healthy" || status === "Active" ? theme.greenDim
    : status === "Degraded" || status === "Disabled" ? theme.yellowDim : theme.redDim;
  return <Badge color={c} bg={bg}>{status}</Badge>;
};

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
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
      <text x={size/2} y={size/2-4} textAnchor="middle" fill={theme.text} fontSize={32} fontWeight={700}>{score}</text>
      <text x={size/2} y={size/2+18} textAnchor="middle" fill={theme.textMuted} fontSize={12}>/100</text>
    </svg>
  );
};

const LoadingState = () => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60, gap: 14 }}>
    <Loader2 size={32} color={theme.accent} style={{ animation: "spin 1s linear infinite" }} />
    <span style={{ color: theme.textDim, fontSize: 14 }}>Connecting to Chronicle SOAR...</span>
    <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
  </div>
);

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

// ── Tab Views ────────────────────────────────────────────────────────

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "playbooks", label: "Playbooks", icon: Layers },
  { id: "cases", label: "Cases", icon: FileSearch },
  { id: "integrations", label: "Integrations", icon: Link2 },
  { id: "findings", label: "Findings", icon: AlertTriangle },
];

// ── Connect Screen ───────────────────────────────────────────────────

function ConnectScreen({ onConnected }) {
  const [form, setForm] = useState({
    host: "",
    app_key: "",
    bearer_token: "",
    project_id: "",
    region: "eu",
    instance_id: "",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleConnect = async () => {
    if (!form.host.trim() || (!form.app_key.trim() && !form.bearer_token.trim())) {
      setError("Instance URL and at least one credential (App Key or Bearer Token) are required.");
      return;
    }
    setConnecting(true); setError("");
    try {
      await api.connect(form);
      onConnected();
    } catch (e) {
      setError(e.message || "Connection failed.");
    } finally {
      setConnecting(false);
    }
  };

  const inp = {
    width: "100%", background: "rgba(255,255,255,0.04)",
    border: `1px solid ${theme.border}`, borderRadius: 10,
    padding: "11px 14px", color: theme.text, fontSize: 13,
    fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };

  const Field = ({ label, name, type = "text", placeholder }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, color: theme.textMuted,
        textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 }}>{label}</label>
      <input style={inp} type={type} placeholder={placeholder}
        value={form[name]} onChange={set(name)}
        onKeyDown={e => e.key === "Enter" && handleConnect()} />
    </div>
  );

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: theme.bg, padding: 24,
    }}>
      <div style={{
        background: theme.bgCard, border: `1px solid ${theme.border}`,
        borderRadius: 20, padding: "36px 32px", width: "100%", maxWidth: 460,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <CodSecLogo size={40} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700,
              background: theme.gradientText, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              CODSEC
            </div>
            <div style={{ fontSize: 12, color: theme.textMuted }}>SOAR Evaluator</div>
          </div>
        </div>

        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Connect to Chronicle</h2>
        <p style={{ fontSize: 13, color: theme.textDim, marginBottom: 24, lineHeight: 1.6 }}>
          Enter your Google SecOps SOAR instance details to load the dashboard.
        </p>

        <Field label="Instance URL" name="host" placeholder="https://rb.siemplify-soar.com" />
        <Field label="App Key" name="app_key" type="password" placeholder="Settings → Integrations → API Key" />
        <Field label="Bearer Token" name="bearer_token" type="password" placeholder="eyJhbGci… (optional if App Key set)" />

        <div style={{ marginBottom: 14 }}>
          <button onClick={() => setShowAdvanced(v => !v)} style={{
            background: "none", border: "none", color: theme.textMuted,
            fontSize: 12, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 4,
          }}>
            {showAdvanced ? "▾" : "▸"} Advanced (for Cases & Integrations)
          </button>
        </div>

        {showAdvanced && (
          <>
            <Field label="Project ID" name="project_id" placeholder="806183131932" />
            <Field label="Region" name="region" placeholder="eu" />
            <Field label="Instance ID" name="instance_id" placeholder="88c7bc29-b1c1-4dbf-b50a-..." />
          </>
        )}

        {error && (
          <div style={{
            background: theme.redDim, border: `1px solid ${theme.red}44`,
            borderRadius: 10, padding: "10px 14px", color: theme.red,
            fontSize: 13, marginBottom: 16,
          }}>{error}</div>
        )}

        <button onClick={handleConnect} disabled={connecting} style={{
          width: "100%", padding: "13px",
          background: connecting ? theme.border : theme.accent,
          color: "#fff", border: "none", borderRadius: 12,
          fontWeight: 700, fontSize: 14, cursor: connecting ? "default" : "pointer",
          transition: "background 0.15s",
        }}>
          {connecting ? "Connecting…" : "Connect & Load Dashboard"}
        </button>

        <p style={{ fontSize: 11, color: theme.textMuted, textAlign: "center", marginTop: 14 }}>
          App Key: Settings → Integrations → API Key · Credentials stored in memory only.
        </p>
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────

export default function App() {
  const [connected, setConnected] = useState(false);
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
    fetchData("integrations", api.integrations);
    fetchData("findings", api.findings);
    fetchData("cases", () => api.cases(30));
    fetchData("trends", () => api.caseTrends(180));
  }, [fetchData]);

  const handleConnected = () => { setConnected(true); loadAll(); };

  const handleDisconnect = async () => {
    await api.disconnect().catch(() => {});
    setConnected(false);
    setData({});
    setErrors({});
  };

  const refreshAll = loadAll;

  const ov = data.overview || {};
  const anyLoading = Object.values(loading).some(Boolean);

  if (!connected) return <ConnectScreen onConnected={handleConnected} />;

  return (
    <div style={{
      background: theme.bg, color: theme.text, minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      {/* ── Header ── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 28px", borderBottom: `1px solid ${theme.border}`,
        background: `linear-gradient(180deg, ${theme.bgCard} 0%, ${theme.bg} 100%)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <CodSecLogo size={44} />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>
              <span style={{ background: theme.gradientText, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                CODSEC
              </span>
              <span style={{ color: theme.textDim, fontWeight: 400, marginLeft: 8 }}>SOAR Evaluator</span>
            </h1>
            <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
              Chronicle Security Operations &middot; Environment Assessment
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={refreshAll} style={{
            display: "flex", alignItems: "center", gap: 6, background: "transparent",
            border: `1px solid ${theme.border}`, borderRadius: 10, padding: "8px 16px",
            color: theme.textDim, cursor: "pointer", fontSize: 12, fontWeight: 500,
          }}>
            <RefreshCw size={14} className={anyLoading ? "spinning" : ""} />
            Refresh
          </button>
          <button onClick={handleDisconnect} style={{
            display: "flex", alignItems: "center", gap: 6, background: "transparent",
            border: `1px solid ${theme.borderLight}`, borderRadius: 10, padding: "8px 16px",
            color: theme.textMuted, cursor: "pointer", fontSize: 12, fontWeight: 500,
          }}>
            Disconnect
          </button>
        </div>
      </header>

      {/* ── Tabs ── */}
      <nav style={{
        display: "flex", gap: 2, padding: "12px 28px",
        borderBottom: `1px solid ${theme.border}`, overflowX: "auto",
      }}>
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
              <t.icon size={15} />
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* ── Content ── */}
      <main style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>

        {/* OVERVIEW */}
        {tab === "overview" && (
          <>
            {loading.overview ? <LoadingState /> : errors.overview ? (
              <ErrorState message={errors.overview} onRetry={() => fetchData("overview", api.overview)} />
            ) : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                  <StatCard icon={Layers} label="Playbooks" value={ov.totalPlaybooks || 0}
                    sub={`${ov.activePlaybooks || 0} active · ${ov.disabledPlaybooks || 0} disabled`} />
                  <StatCard icon={FileSearch} label="Cases (30d)" value={(ov.totalCases30d || 0).toLocaleString()}
                    color={theme.accent} glow={theme.accentGlow} />
                  <StatCard icon={Clock} label="Avg MTTR" value={`${ov.avgMttrHours || 0}h`} sub="Mean time to resolve" />
                  <StatCard icon={Zap} label="Automation" value={`${ov.automationRate || 0}%`}
                    color={theme.green} glow={theme.greenDim} sub="Benchmark: ~60%" />
                </div>

                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <div style={{
                    background: theme.bgCard, borderRadius: 14, padding: 22,
                    border: `1px solid ${theme.border}`, flex: "2 1 360px",
                  }}>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Case Volume Trend</div>
                    <div style={{ display: "flex", gap: 16, fontSize: 11, color: theme.textMuted, marginBottom: 12 }}>
                      <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: theme.accent, marginRight: 5 }} />Automated</span>
                      <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: theme.purple, marginRight: 5 }} />Manual</span>
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

                  <div style={{
                    background: theme.bgCard, borderRadius: 14, padding: 22,
                    border: `1px solid ${theme.border}`, flex: "1 1 200px",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  }}>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Maturity Score</div>
                    <ScoreRing score={ov.maturityScore || 0} />
                    <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 10, textAlign: "center" }}>
                      {(ov.maturityScore || 0) >= 80 ? "Excellent" : (ov.maturityScore || 0) >= 60 ? "Good — room to improve" : "Needs attention"}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* PLAYBOOKS */}
        {tab === "playbooks" && (
          <>
            {loading.playbooks ? <LoadingState /> : errors.playbooks ? (
              <ErrorState message={errors.playbooks} onRetry={() => fetchData("playbooks", api.playbooks)} />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <div style={{ marginBottom: 16, fontSize: 13, color: theme.textDim }}>
                  {(data.playbooks?.playbooks || []).length} playbooks found
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                      {["Playbook", "Status", "Category", "Created", "Last Updated"].map(h => (
                        <th key={h} style={{
                          textAlign: "left", padding: "12px 14px", color: theme.textMuted,
                          fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data.playbooks?.playbooks || []).map((pb, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${theme.border}22` }}>
                        <td style={{ padding: "14px", fontWeight: 500 }}>{pb.name}</td>
                        <td style={{ padding: "14px" }}><StatusBadge status={pb.status} /></td>
                        <td style={{ padding: "14px", color: theme.textDim }}>{pb.category}</td>
                        <td style={{ padding: "14px", color: theme.textMuted, fontSize: 12 }}>
                          {pb.createTime ? new Date(pb.createTime).toLocaleDateString() : "—"}
                        </td>
                        <td style={{ padding: "14px", color: theme.textMuted, fontSize: 12 }}>
                          {pb.updateTime ? new Date(pb.updateTime).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* CASES */}
        {tab === "cases" && (
          <>
            {loading.cases ? <LoadingState /> : errors.cases ? (
              <ErrorState message={errors.cases} onRetry={() => fetchData("cases", () => api.cases(30))} />
            ) : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                  <StatCard icon={FileSearch} label="Total Cases" value={(data.cases?.total_cases || 0).toLocaleString()} sub="Last 30 days" />
                  <StatCard icon={Clock} label="Avg MTTR" value={`${data.cases?.avg_mttr_hours || 0}h`} color={theme.accent} />
                </div>

                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                  <div style={{
                    background: theme.bgCard, borderRadius: 14, padding: 22,
                    border: `1px solid ${theme.border}`, flex: "1 1 300px",
                  }}>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Severity Breakdown</div>
                    {Object.entries(data.cases?.severity_breakdown || {}).map(([sev, count]) => (
                      <div key={sev} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                        <SeverityDot severity={sev} />
                        <span style={{ flex: 1, fontSize: 13 }}>{sev}</span>
                        <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 40, textAlign: "right" }}>{count}</span>
                        <div style={{ width: 100, height: 6, background: theme.border, borderRadius: 3, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: 3, width: `${Math.min((count / Math.max(...Object.values(data.cases?.severity_breakdown || { x: 1 }))) * 100, 100)}%`,
                            background: sev === "CRITICAL" ? theme.red : sev === "HIGH" ? "#fb923c" : sev === "MEDIUM" ? theme.yellow : theme.textMuted,
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{
                    background: theme.bgCard, borderRadius: 14, padding: 22,
                    border: `1px solid ${theme.border}`, flex: "1 1 300px",
                  }}>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Status Distribution</div>
                    {Object.entries(data.cases?.status_breakdown || {}).map(([st, count]) => (
                      <div key={st} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                        <span style={{ flex: 1, fontSize: 13, color: theme.textDim }}>{st.replace(/_/g, " ")}</span>
                        <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* INTEGRATIONS */}
        {tab === "integrations" && (
          <>
            {loading.integrations ? <LoadingState /> : errors.integrations ? (
              <ErrorState message={errors.integrations} onRetry={() => fetchData("integrations", api.integrations)} />
            ) : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                  <StatCard icon={Link2} label="Total" value={data.integrations?.total || 0} />
                  <StatCard icon={CheckCircle} label="Healthy"
                    value={(data.integrations?.integrations || []).filter(i => i.status === "Healthy").length}
                    color={theme.green} />
                  <StatCard icon={AlertTriangle} label="Degraded"
                    value={(data.integrations?.integrations || []).filter(i => i.status === "Degraded").length}
                    color={theme.yellow} />
                  <StatCard icon={XCircle} label="Error"
                    value={(data.integrations?.integrations || []).filter(i => i.status === "Error").length}
                    color={theme.red} />
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        {["Integration", "Status", "Type", "Version", "Last Heartbeat", "Enabled"].map(h => (
                          <th key={h} style={{
                            textAlign: "left", padding: "12px 14px", color: theme.textMuted,
                            fontWeight: 600, fontSize: 11, textTransform: "uppercase",
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.integrations?.integrations || []).map((intg, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}22` }}>
                          <td style={{ padding: "14px", fontWeight: 500 }}>{intg.name}</td>
                          <td style={{ padding: "14px" }}><StatusBadge status={intg.status} /></td>
                          <td style={{ padding: "14px", color: theme.textDim }}>{intg.type || "—"}</td>
                          <td style={{ padding: "14px", color: theme.textMuted, fontSize: 12 }}>{intg.version || "—"}</td>
                          <td style={{ padding: "14px", color: theme.textMuted, fontSize: 12 }}>
                            {intg.lastHeartbeat ? new Date(intg.lastHeartbeat).toLocaleString() : "—"}
                          </td>
                          <td style={{ padding: "14px", fontSize: 12 }}>
                            <span style={{
                              color: intg.isEnabled ? theme.green : theme.textMuted,
                              fontWeight: 500,
                            }}>{intg.isEnabled ? "Yes" : "No"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {/* FINDINGS */}
        {tab === "findings" && (
          <>
            {loading.findings ? <LoadingState /> : errors.findings ? (
              <ErrorState message={errors.findings} onRetry={() => fetchData("findings", api.findings)} />
            ) : (
              <>
                <p style={{ fontSize: 13, color: theme.textMuted, marginTop: 0, marginBottom: 18 }}>
                  Automated assessment based on environment scan — {(data.findings?.findings || []).length} findings detected.
                </p>
                {(data.findings?.findings || []).map((f, i) => (
                  <FindingCard key={i} finding={f} />
                ))}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
