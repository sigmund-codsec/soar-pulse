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
  playbookRuns: (id, days) => apiFetch(`/api/playbooks/${id}/runs`, { days }),
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
  <svg width={size * 1.8} height={size} viewBox="0 0 72 40" fill="none">
    <defs>
      <linearGradient id="pulseGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#da009e" />
        <stop offset="50%" stopColor="#a855f7" />
        <stop offset="100%" stopColor="#6cb4ff" />
      </linearGradient>
    </defs>
    {/* Pulse / ECG waveform */}
    <polyline
      points="0,20 10,20 14,8 18,32 22,14 26,26 30,20 42,20 46,4 50,36 54,20 72,20"
      stroke="url(#pulseGrad)" strokeWidth="2.5" fill="none"
      strokeLinecap="round" strokeLinejoin="round"
    />
    {/* Accent dot at peak */}
    <circle cx="46" cy="4" r="2.5" fill="#da009e" />
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

// ── Main App ─────────────────────────────────────────────────────────

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
    fetchData("trends", () => api.caseTrends(180));
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

  const refreshAll = loadAll;

  const ov = data.overview || {};
  const anyLoading = Object.values(loading).some(Boolean);

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
              <span style={{ color: theme.textDim, fontWeight: 400, marginLeft: 8 }}>Pulse</span>
            </h1>
            <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
              Google Chronicle SOAR Assessment
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
            ) : (() => {
              const pbs = data.playbooks?.playbooks || [];
              const active = pbs.filter(p => p.status === "Active").length;
              const disabled = pbs.filter(p => p.status === "Disabled").length;
              const allIntegrations = [...new Set(pbs.flatMap(p => p.integrations || []))].sort();
              return (
                <>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                    <StatCard icon={Layers} label="Total" value={pbs.length} />
                    <StatCard icon={CheckCircle} label="Active" value={active} color={theme.green} />
                    <StatCard icon={XCircle} label="Disabled" value={disabled} color={theme.yellow} />
                    <StatCard icon={Link2} label="Integrations Used" value={allIntegrations.length} color={theme.purple} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
                    {pbs.map((pb, i) => {
                      const isActive = pb.status === "Active";
                      return (
                        <div key={i} style={{
                          background: theme.bgCard, border: `1px solid ${theme.border}`,
                          borderRadius: 16, padding: 20,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                            <span style={{
                              fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600,
                              background: isActive ? theme.greenDim : theme.yellowDim,
                              color: isActive ? theme.green : theme.yellow,
                            }}>{pb.status}</span>
                            <span style={{
                              fontSize: 11, padding: "3px 10px", borderRadius: 20,
                              background: `${theme.border}`, color: theme.textMuted,
                            }}>{pb.playbookType || "Playbook"}</span>
                          </div>
                          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{pb.name}</div>
                          <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 8, fontFamily: "monospace" }}>{pb.category}</div>
                          {pb.description && (
                            <p style={{ fontSize: 12, color: theme.textDim, lineHeight: 1.6, marginBottom: 10,
                              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {pb.description}
                            </p>
                          )}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
                            {(pb.integrations || []).length === 0
                              ? <span style={{ fontSize: 11, color: theme.textMuted, fontFamily: "monospace" }}>No integrations detected</span>
                              : (pb.integrations || []).map(intg => (
                                <span key={intg} style={{
                                  fontSize: 11, padding: "2px 9px", borderRadius: 20,
                                  background: `${theme.border}88`, color: theme.textDim,
                                  border: `1px solid ${theme.border}`, fontFamily: "monospace",
                                }}>{intg}</span>
                              ))
                            }
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between",
                            borderTop: `1px solid ${theme.border}44`, paddingTop: 10, fontSize: 11, color: theme.textMuted, fontFamily: "monospace" }}>
                            <span>{pb.steps || 0} steps</span>
                            <span>{pb.updateTime ? pb.updateTime.slice(0, 10) : "—"}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
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

        {/* CONNECTORS */}
        {tab === "connectors" && (
          <>
            {loading.connectors ? <LoadingState /> : errors.connectors ? (
              <ErrorState message={errors.connectors} onRetry={() => fetchData("connectors", api.connectors)} />
            ) : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                  <StatCard icon={Plug} label="Total Connectors" value={data.connectors?.total || 0} />
                  <StatCard icon={CheckCircle} label="Integrations"
                    value={Object.keys(data.connectors?.connectors || {}).length} color={theme.green} />
                </div>
                {Object.entries(data.connectors?.connectors || {}).map(([integration, cards]) => (
                  <div key={integration} style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.textDim, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.6 }}>{integration}</div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                            {["Connector Name", "Enabled"].map(h => (
                              <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: theme.textMuted, fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cards.map((c, i) => (
                            <tr key={i} style={{ borderBottom: `1px solid ${theme.border}22` }}>
                              <td style={{ padding: "12px 14px", fontWeight: 500 }}>{c.name}</td>
                              <td style={{ padding: "12px 14px" }}>
                                <span style={{ color: c.isEnabled ? theme.green : theme.textMuted, fontWeight: 500 }}>{c.isEnabled ? "Yes" : "No"}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* WEBHOOKS */}
        {tab === "webhooks" && (
          <>
            {loading.webhooks ? <LoadingState /> : errors.webhooks ? (
              <ErrorState message={errors.webhooks} onRetry={() => fetchData("webhooks", api.webhooks)} />
            ) : (
              <>
                <StatCard icon={Webhook} label="Total Webhooks" value={data.webhooks?.total || 0} />
                <div style={{ overflowX: "auto", marginTop: 20 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        {["Name", "Environment", "Enabled"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "12px 14px", color: theme.textMuted, fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.webhooks?.webhooks || []).map((wh, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}22` }}>
                          <td style={{ padding: "14px", fontWeight: 500 }}>{wh.name || wh.identifier}</td>
                          <td style={{ padding: "14px", color: theme.textDim }}>{wh.environment || "—"}</td>
                          <td style={{ padding: "14px" }}>
                            <span style={{ color: wh.isEnabled ? theme.green : theme.textMuted, fontWeight: 500 }}>{wh.isEnabled ? "Yes" : "No"}</span>
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

        {/* ENVIRONMENTS */}
        {tab === "environments" && (
          <>
            {loading.environments ? <LoadingState /> : errors.environments ? (
              <ErrorState message={errors.environments} onRetry={() => fetchData("environments", api.environments)} />
            ) : (
              <>
                <StatCard icon={Globe} label="Environments" value={data.environments?.total || 0} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>
                  {(data.environments?.environments || []).map((env, i) => (
                    <div key={i} style={{
                      background: theme.bgCard, border: `1px solid ${theme.border}`,
                      borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 500,
                    }}>{env}</div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* AGENTS */}
        {tab === "agents" && (
          <>
            {loading.agents ? <LoadingState /> : errors.agents ? (
              <ErrorState message={errors.agents} onRetry={() => fetchData("agents", api.agents)} />
            ) : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                  <StatCard icon={Bot} label="Total Agents" value={data.agents?.total || 0} />
                  <StatCard icon={CheckCircle} label="Live"
                    value={(data.agents?.agents || []).filter(a => a.status === "Live").length} color={theme.green} />
                  <StatCard icon={XCircle} label="Failed"
                    value={(data.agents?.agents || []).filter(a => a.status === "Failed").length} color={theme.red} />
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        {["Name", "Status", "Environments"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "12px 14px", color: theme.textMuted, fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.agents?.agents || []).map((a, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}22` }}>
                          <td style={{ padding: "14px", fontWeight: 500 }}>{a.name}</td>
                          <td style={{ padding: "14px" }}>
                            <span style={{
                              color: a.status === "Live" ? theme.green : a.status === "Failed" ? theme.red : theme.yellow,
                              fontWeight: 500,
                            }}>{a.status}</span>
                          </td>
                          <td style={{ padding: "14px", color: theme.textDim, fontSize: 12 }}>{(a.environments || []).join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {/* USERS */}
        {tab === "users" && (
          <>
            {loading.users ? <LoadingState /> : errors.users ? (
              <ErrorState message={errors.users} onRetry={() => fetchData("users", api.users)} />
            ) : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                  <StatCard icon={Users} label="Total Users" value={data.users?.total || 0} />
                  <StatCard icon={XCircle} label="Disabled"
                    value={(data.users?.users || []).filter(u => u.isDisabled).length} color={theme.red} />
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        {["Email", "Roles", "Provider", "Environments", "Disabled"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "12px 14px", color: theme.textMuted, fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.users?.users || []).map((u, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}22` }}>
                          <td style={{ padding: "14px", fontWeight: 500 }}>{u.email}</td>
                          <td style={{ padding: "14px", color: theme.textDim, fontSize: 12 }}>{(u.socRoles || []).join(", ") || "—"}</td>
                          <td style={{ padding: "14px", color: theme.textDim, fontSize: 12 }}>{u.providerName || "—"}</td>
                          <td style={{ padding: "14px", color: theme.textMuted, fontSize: 12 }}>{(u.environments || []).join(", ") || "—"}</td>
                          <td style={{ padding: "14px" }}>
                            <span style={{ color: u.isDisabled ? theme.red : theme.green, fontWeight: 500 }}>{u.isDisabled ? "Yes" : "No"}</span>
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

        {/* INTEGRATION INSTANCES */}
        {tab === "instances" && (
          <>
            {loading.instances ? <LoadingState /> : errors.instances ? (
              <ErrorState message={errors.instances} onRetry={() => fetchData("instances", api.instances)} />
            ) : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                  <StatCard icon={Package} label="Total Instances" value={data.instances?.total || 0} />
                  <StatCard icon={Bot} label="Remote"
                    value={(data.instances?.instances || []).filter(i => i.isRemote).length} color={theme.purple} />
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        {["Environment", "Integration Type", "Instance Name", "Remote"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "12px 14px", color: theme.textMuted, fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.instances?.instances || []).map((inst, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}22` }}>
                          <td style={{ padding: "14px", color: theme.textDim }}>{inst.environment}</td>
                          <td style={{ padding: "14px", fontWeight: 500 }}>{inst.type}</td>
                          <td style={{ padding: "14px" }}>{inst.name}</td>
                          <td style={{ padding: "14px" }}>
                            <span style={{ color: inst.isRemote ? theme.purple : theme.textMuted, fontWeight: 500 }}>{inst.isRemote ? "Yes" : "No"}</span>
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

        {/* JOBS */}
        {tab === "jobs" && (
          <>
            {loading.jobs ? <LoadingState /> : errors.jobs ? (
              <ErrorState message={errors.jobs} onRetry={() => fetchData("jobs", api.jobs)} />
            ) : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                  <StatCard icon={Briefcase} label="Total Jobs" value={data.jobs?.total || 0} />
                  <StatCard icon={CheckCircle} label="Enabled"
                    value={(data.jobs?.jobs || []).filter(j => j.isEnabled).length} color={theme.green} />
                  <StatCard icon={Code} label="Custom"
                    value={(data.jobs?.jobs || []).filter(j => j.isCustom).length} color={theme.purple} />
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        {["Name", "Integration", "Enabled", "Custom"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "12px 14px", color: theme.textMuted, fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.jobs?.jobs || []).map((j, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}22` }}>
                          <td style={{ padding: "14px", fontWeight: 500 }}>{j.name}</td>
                          <td style={{ padding: "14px", color: theme.textDim }}>{j.integration || "—"}</td>
                          <td style={{ padding: "14px" }}>
                            <span style={{ color: j.isEnabled ? theme.green : theme.textMuted, fontWeight: 500 }}>{j.isEnabled ? "Yes" : "No"}</span>
                          </td>
                          <td style={{ padding: "14px" }}>
                            <span style={{ color: j.isCustom ? theme.purple : theme.textMuted, fontWeight: 500 }}>{j.isCustom ? "Yes" : "No"}</span>
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

        {/* IDE */}
        {tab === "ide" && (
          <>
            {loading.ide ? <LoadingState /> : errors.ide ? (
              <ErrorState message={errors.ide} onRetry={() => fetchData("ide", api.ide)} />
            ) : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
                  <StatCard icon={Code} label="Integrations" value={data.ide?.total || 0} />
                  <StatCard icon={Zap} label="Custom"
                    value={(data.ide?.integrations || []).filter(i => i.isCustom).length} color={theme.purple} />
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        {["Integration", "Custom", "Actions"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "12px 14px", color: theme.textMuted, fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.ide?.integrations || []).map((intg, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}22` }}>
                          <td style={{ padding: "14px", fontWeight: 500 }}>{intg.name}</td>
                          <td style={{ padding: "14px" }}>
                            <span style={{ color: intg.isCustom ? theme.purple : theme.textMuted, fontWeight: 500 }}>{intg.isCustom ? "Yes" : "No"}</span>
                          </td>
                          <td style={{ padding: "14px", color: theme.textDim, fontSize: 12 }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {(intg.actions || []).slice(0, 8).map((a, j) => (
                                <span key={j} style={{
                                  background: theme.border, borderRadius: 6, padding: "2px 8px",
                                  fontSize: 11, color: theme.textDim,
                                }}>{a}</span>
                              ))}
                              {(intg.actions || []).length > 8 && (
                                <span style={{ fontSize: 11, color: theme.textMuted }}>+{intg.actions.length - 8} more</span>
                              )}
                            </div>
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
