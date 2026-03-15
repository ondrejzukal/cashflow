import { useState, useMemo, useCallback, useRef, useEffect } from "react";

// ─── Constants ───
const MONTHS = ["Led","Úno","Bře","Dub","Kvě","Čer","Čec","Srp","Zář","Říj","Lis","Pro"];
const MONTH_FULL = ["Leden","Únor","Březen","Duben","Květen","Červen","Červenec","Srpen","Září","Říjen","Listopad","Prosinec"];

const PROJECT_COLORS = ["#6366f1","#8b5cf6","#a78bfa","#c4b5fd","#7c3aed","#4f46e5","#818cf8","#6d28d9","#5b21b6","#4c1d95"];

const DEFAULT_PROJECTS = [
  { id: 1, name: "Platba z prosince", startMonth: 0, durationMonths: 1, invoiceAmount: 45000, paymentDelay: 0, color: "#6366f1" },
  { id: 2, name: "Branding B", startMonth: 0, durationMonths: 2, invoiceAmount: 110000, paymentDelay: 1, color: "#8b5cf6" },
  { id: 3, name: "Redesign D", startMonth: 1, durationMonths: 2, invoiceAmount: 85000, paymentDelay: 1, color: "#c4b5fd" },
  { id: 4, name: "App C", startMonth: 3, durationMonths: 3, invoiceAmount: 195000, paymentDelay: 1, color: "#a78bfa" },
  { id: 5, name: "E-shop E", startMonth: 8, durationMonths: 2, invoiceAmount: 155000, paymentDelay: 1, color: "#7c3aed" },
];

const DEFAULT_FIXED_COSTS = [
  { name: "Kancelář", amount: 8000 },
  { name: "Internet + telefon", amount: 1500 },
  { name: "Auto (leasing)", amount: 5500 },
  { name: "Software", amount: 2000 },
  { name: "Účetní", amount: 1000 },
];

const TAX_REGIMES = [
  { id: "pausalni", label: "Paušální daň", desc: "Fixní měsíční platba, žádné odpisy", monthlyTax: 7498, canDeduct: false },
  { id: "vydajovy", label: "Výdajový paušál 60 %", desc: "60 % příjmů = výdaje, zbytek zdaníš", rate: 0.60, canDeduct: false },
  { id: "evidence", label: "Daňová evidence", desc: "Skutečné výdaje + odpisy", rate: null, canDeduct: true },
];

// Scenarios use project ID, not array index
const DEFAULT_SCENARIOS = [
  { label: "Vše OK", icon: "✓", overrides: {} },
  { label: "Branding B +2 měs.", icon: "⏳", overrides: { 2: { addDelay: 2 } } },
  { label: "E-shop E neplatí", icon: "✗", overrides: { 5: { neverPays: true } } },
];

// ─── Utility ───
const fmt = (n) => { if (Math.abs(n) >= 1000) return (n/1000).toFixed(0)+"k"; return Math.round(n).toString(); };
const fmtFull = (n) => new Intl.NumberFormat("cs-CZ").format(Math.round(n)) + " Kč";
let _nextId = 100;
const nextId = () => ++_nextId;

// ─── Data Engine ───
function computeData(projects, fixedCosts, scenario, employeeGross, reserve) {
  const overrides = DEFAULT_SCENARIOS[scenario]?.overrides || {};
  const totalFixed = fixedCosts.reduce((s,c) => s + c.amount, 0);

  const empNet = Math.round(employeeGross * 0.75);
  const employeeCumulative = MONTHS.map((_,i) => empNet * (i+1));
  const employeeMonthly = MONTHS.map(() => empNet);

  const freelancerIncome = new Array(12).fill(0);
  const freelancerCosts = new Array(12).fill(totalFixed);
  const freelancerNet = new Array(12).fill(0);
  const freelancerCumulative = new Array(12).fill(0);

  const projectBars = [];
  const invoiceEvents = [];
  const paymentEvents = [];
  const unpaidEvents = [];

  projects.forEach((p) => {
    projectBars.push({ ...p, endMonth: Math.min(p.startMonth + p.durationMonths - 1, 11) });
    const invoiceMonth = Math.min(p.startMonth + p.durationMonths, 11);
    invoiceEvents.push({ month: invoiceMonth, amount: p.invoiceAmount, project: p.name, projectId: p.id, color: p.color });

    // Apply scenario override by project ID
    const ov = overrides[p.id];
    if (ov && ov.neverPays) {
      // Mark as unpaid
      unpaidEvents.push({ month: invoiceMonth, amount: p.invoiceAmount, project: p.name, color: p.color });
      return; // no income from this project
    }

    let delay = p.paymentDelay;
    if (ov && ov.addDelay) {
      delay += ov.addDelay;
    }

    const payMonth = invoiceMonth + delay;
    if (payMonth < 12) {
      freelancerIncome[payMonth] += p.invoiceAmount;
      paymentEvents.push({ month: payMonth, amount: p.invoiceAmount, project: p.name, color: p.color });
    } else {
      // Payment falls outside the year — still owed, shown as pending
      unpaidEvents.push({ month: invoiceMonth, amount: p.invoiceAmount, project: p.name, color: p.color, pending: true, expectedMonth: payMonth });
    }
  });

  let cumul = reserve;
  for (let i = 0; i < 12; i++) {
    freelancerNet[i] = freelancerIncome[i] - freelancerCosts[i];
    cumul += freelancerNet[i];
    freelancerCumulative[i] = cumul;
  }

  // Tax
  const totalIncomeYear = freelancerIncome.reduce((s,v) => s+v, 0);
  const totalCostsYear = totalFixed * 12;
  const taxData = {};
  TAX_REGIMES.forEach(regime => {
    let taxBase, tax, netAfterTax, healthSocial;
    if (regime.id === "pausalni") {
      tax = regime.monthlyTax * 12; taxBase = 0; healthSocial = 0;
      netAfterTax = totalIncomeYear - totalCostsYear - tax;
    } else if (regime.id === "vydajovy") {
      const expenses = totalIncomeYear * regime.rate;
      taxBase = Math.max(0, totalIncomeYear - expenses);
      tax = Math.round(taxBase * 0.15);
      healthSocial = Math.round(taxBase * 0.5 * (0.131 + 0.292));
      netAfterTax = totalIncomeYear - totalCostsYear - tax - healthSocial;
    } else {
      taxBase = Math.max(0, totalIncomeYear - totalCostsYear);
      tax = Math.round(taxBase * 0.15);
      healthSocial = Math.round(taxBase * 0.5 * (0.131 + 0.292));
      netAfterTax = totalIncomeYear - totalCostsYear - tax - healthSocial;
    }
    taxData[regime.id] = { taxBase, tax, healthSocial, netAfterTax, totalIncome: totalIncomeYear, totalCosts: totalCostsYear };
  });

  const unpaidTotal = unpaidEvents.reduce((s,e) => s + e.amount, 0);

  return {
    employeeMonthly, employeeCumulative,
    freelancerIncome, freelancerCosts, freelancerNet, freelancerCumulative,
    projectBars, invoiceEvents, paymentEvents, unpaidEvents, unpaidTotal,
    totalFixed, taxData
  };
}

// ─── SVG: Cumulative ───
function CumulativeChart({ data, animMonth, reserve, macInMonth, macPrice, macIsLeasing, macMonthlyPmt }) {
  const { employeeCumulative: ec, freelancerCumulative: fc } = data;
  const visEc = animMonth !== null ? ec.slice(0, animMonth+1) : ec;
  const visFc = animMonth !== null ? fc.slice(0, animMonth+1) : fc;
  const all = [...ec, ...fc, 0, reserve];
  const maxV = Math.max(...all); const minV = Math.min(...all);
  const range = maxV - minV || 1;
  const pad = 52; const W = 700; const H = 260;
  const toY = v => pad + (H - 2*pad) * (1 - (v - minV)/range);
  const toX = i => pad + (i/11)*(W - 2*pad);

  const buildPath = (arr) => arr.map((v,i) => `${i===0?"M":"L"}${toX(i)},${toY(v)}`).join(" ");
  const empP = buildPath(visEc);
  const freeP = buildPath(visFc);
  const freeArea = visFc.length > 0 ? freeP + ` L${toX(visFc.length-1)},${toY(0)} L${toX(0)},${toY(0)} Z` : "";
  const gridN = 5; const step = range / gridN;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 280 }}>
      {Array.from({length: gridN+1}).map((_,i) => { const v = minV + step*i; return (
        <g key={i}><line x1={pad} x2={W-pad} y1={toY(v)} y2={toY(v)} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3"/>
        <text x={pad-6} y={toY(v)+4} fill="rgba(255,255,255,0.25)" fontSize="9" textAnchor="end" fontFamily="monospace">{fmt(v)}</text></g>
      );})}
      <line x1={pad} x2={W-pad} y1={toY(0)} y2={toY(0)} stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      {MONTHS.map((m,i) => <text key={m} x={toX(i)} y={H-4} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="middle" fontFamily="monospace">{m}</text>)}
      {reserve > 0 && <><line x1={pad} x2={W-pad} y1={toY(reserve)} y2={toY(reserve)} stroke="rgba(251,191,36,0.25)" strokeDasharray="6 3" strokeWidth="1"/>
        <text x={W-pad+4} y={toY(reserve)+3} fill="rgba(251,191,36,0.5)" fontSize="8" fontFamily="monospace">rezerva {fmt(reserve)}</text></>}
      {/* Mac purchase marker */}
      {macInMonth >= 0 && <><line x1={toX(macInMonth)} x2={toX(macInMonth)} y1={pad-8} y2={H-22} stroke={macIsLeasing ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"} strokeDasharray="4 3" strokeWidth="1.5"/>
        <rect x={toX(macInMonth)-30} y={pad-18} width={60} height={14} rx="3" fill={macIsLeasing ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.1)"} stroke={macIsLeasing ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.25)"} strokeWidth="0.5"/>
        <text x={toX(macInMonth)} y={pad-8} fill={macIsLeasing ? "#22c55e" : "#ef4444"} fontSize="7.5" textAnchor="middle" fontWeight="600">{macIsLeasing ? `🖥 ${fmt(macMonthlyPmt)}/m` : `🖥 ${fmt(macPrice)}`}</text></>}
      {freeArea && <path d={freeArea} fill="rgba(139,92,246,0.06)"/>}
      <path d={empP} fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d={freeP} fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      {visEc.map((v,i) => <circle key={`e${i}`} cx={toX(i)} cy={toY(v)} r="3" fill="#22d3ee"/>)}
      {visFc.map((v,i) => <circle key={`f${i}`} cx={toX(i)} cy={toY(v)} r="3" fill={v < 0 ? "#ef4444" : "#a78bfa"}/>)}
      {visEc.length === 12 && <text x={toX(11)+6} y={toY(ec[11])+4} fill="#22d3ee" fontSize="10" fontWeight="600" fontFamily="monospace">{fmtFull(ec[11])}</text>}
      {visFc.length === 12 && <text x={toX(11)+6} y={toY(fc[11])+(fc[11]>ec[11]?-8:14)} fill="#a78bfa" fontSize="10" fontWeight="600" fontFamily="monospace">{fmtFull(fc[11])}</text>}
    </svg>
  );
}

// ─── SVG: Monthly Bars ───
function MonthlyBars({ data, animMonth }) {
  const { freelancerIncome: fi, freelancerCosts: fco, freelancerNet: fn } = data;
  const visN = animMonth !== null ? animMonth+1 : 12;
  const maxV = Math.max(...fi, ...fco) * 1.15 || 1;
  const pad = 52; const W = 700; const H = 200;
  const barW = (W - 2*pad)/12;
  const toY = v => pad + (H - 2*pad)*(1 - v/maxV);
  const toX = i => pad + i*barW;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 220 }}>
      {MONTHS.map((m,i) => <text key={m} x={toX(i)+barW/2} y={H-2} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="middle" fontFamily="monospace">{m}</text>)}
      <line x1={pad} x2={W-pad} y1={toY(0)} y2={toY(0)} stroke="rgba(255,255,255,0.1)"/>
      {fco.slice(0,visN).map((v,i) => <rect key={`c${i}`} x={toX(i)+barW*0.12} y={toY(v)} width={barW*0.35} height={toY(0)-toY(v)} rx="2" fill="#ef4444" opacity="0.55"/>)}
      {fi.slice(0,visN).map((v,i) => v > 0 ? <rect key={`i${i}`} x={toX(i)+barW*0.53} y={toY(v)} width={barW*0.35} height={toY(0)-toY(v)} rx="2" fill="#22c55e" opacity="0.65"/> : null)}
    </svg>
  );
}

// ─── SVG: Project Timeline ───
function ProjectTimeline({ data, projects }) {
  const { projectBars, invoiceEvents, paymentEvents, unpaidEvents } = data;
  const pad = 52; const W = 700; const rowH = 34;
  const H = projects.length * rowH + 40;
  const mW = (W - 2*pad)/12;
  const toX = m => pad + (m/11)*(W - 2*pad);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
      {MONTHS.map((m,i) => <g key={m}><line x1={toX(i)} x2={toX(i)} y1={0} y2={H-20} stroke="rgba(255,255,255,0.03)"/>
        <text x={toX(i)+mW/2} y={H-4} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="middle" fontFamily="monospace">{m}</text></g>)}
      {projectBars.map((p,i) => { const x1=toX(p.startMonth); const x2=toX(p.endMonth)+mW; const y=i*rowH+8;
        // Check if this project is unpaid
        const isUnpaid = unpaidEvents.some(e => e.project === p.name && !e.pending);
        return (
        <g key={i}>
          <rect x={x1} y={y} width={x2-x1} height={rowH-14} rx="4" fill={p.color} opacity={isUnpaid ? "0.1" : "0.2"} stroke={isUnpaid ? "#ef4444" : p.color} strokeWidth="1" strokeDasharray={isUnpaid ? "4 2" : "none"}/>
          <text x={x1+6} y={y+rowH/2-3} fill="white" fontSize="9.5" fontWeight="500" opacity={isUnpaid ? 0.4 : 0.8}>{p.name}</text>
          <text x={x1+6} y={y+rowH/2+9} fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="monospace">{fmtFull(p.invoiceAmount)}</text>
          {isUnpaid && <text x={x2+4} y={y+rowH/2+2} fill="#ef4444" fontSize="8" fontWeight="600">NEZAPLACENO</text>}
        </g>
      );})}
      {invoiceEvents.map((e,i) => { const x=toX(e.month)+mW/2; const row=projectBars.findIndex(p=>p.name===e.project); if(row<0) return null; const y=row*rowH+rowH/2+1; return (
        <g key={`inv${i}`}><circle cx={x} cy={y} r="5.5" fill="none" stroke="#fbbf24" strokeWidth="1.5"/>
        <text x={x} y={y+3.5} fill="#fbbf24" fontSize="7" textAnchor="middle" fontWeight="700">F</text></g>
      );})}
      {paymentEvents.map((e,i) => { const x=toX(e.month)+mW/2; const row=projectBars.findIndex(p=>p.name===e.project); if(row<0) return null; const y=row*rowH+rowH/2+1; return (
        <g key={`pay${i}`}><circle cx={x} cy={y} r="5.5" fill="#22c55e"/>
        <text x={x} y={y+3.5} fill="white" fontSize="7" textAnchor="middle" fontWeight="700">₿</text></g>
      );})}
      {/* Unpaid markers: red X at invoice position */}
      {unpaidEvents.filter(e => !e.pending).map((e,i) => { const x=toX(e.month)+mW/2+14; const row=projectBars.findIndex(p=>p.name===e.project); if(row<0) return null; const y=row*rowH+rowH/2+1; return (
        <g key={`unp${i}`}><circle cx={x} cy={y} r="5.5" fill="#ef4444" opacity="0.8"/>
        <text x={x} y={y+3.5} fill="white" fontSize="7" textAnchor="middle" fontWeight="700">✗</text></g>
      );})}
      {/* Pending (payment next year) */}
      {unpaidEvents.filter(e => e.pending).map((e,i) => { const x=toX(11)+mW/2; const row=projectBars.findIndex(p=>p.name===e.project); if(row<0) return null; const y=row*rowH+rowH/2+1; return (
        <g key={`pend${i}`}><circle cx={x} cy={y} r="5.5" fill="none" stroke="#fb923c" strokeWidth="1.5" strokeDasharray="2 2"/>
        <text x={x} y={y+3.5} fill="#fb923c" fontSize="6" textAnchor="middle" fontWeight="700">→</text></g>
      );})}
    </svg>
  );
}

// ─── Tax Comparison ───
function TaxComparison({ taxData, activeTax, setActiveTax, macEnabled, macMode }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {TAX_REGIMES.map(r => (
          <button key={r.id} onClick={() => setActiveTax(r.id)} style={{
            padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 10, fontFamily: "inherit",
            background: activeTax === r.id ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.03)",
            color: activeTax === r.id ? "#a78bfa" : "rgba(255,255,255,0.35)", transition: "all 0.15s"
          }}>{r.label}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {TAX_REGIMES.map(r => {
          const d = taxData[r.id]; const isA = activeTax === r.id;
          const hasMac = d.macDeduction > 0 && r.id === "evidence";
          const rows = [
            ["Příjmy", fmtFull(d.totalIncome), "#22c55e"],
            ["Provozní náklady", fmtFull(d.totalCosts), "#ef4444"],
          ];
          if (hasMac) {
            rows.push(["🖥 " + d.macTaxLabel, "−" + fmtFull(d.macDeduction), "#22d3ee"]);
          }
          if (r.id === "vydajovy") {
            rows.push(["Paušální výdaje 60 %", fmtFull(d.deductibleCosts), "#fb923c"]);
          }
          rows.push(
            ["Základ daně", fmtFull(d.taxBase), "rgba(255,255,255,0.6)"],
            ["Daň z příjmu 15 %", fmtFull(d.tax), "#fbbf24"],
            ["Zdrav. + soc.", fmtFull(d.healthSocial), "#fb923c"],
          );
          // Separator + result
          rows.push(["_sep"]);
          rows.push(["Čistý zisk", fmtFull(d.netAfterTax), d.netAfterTax >= 0 ? "#22d3ee" : "#ef4444"]);

          return (
            <div key={r.id} onClick={() => setActiveTax(r.id)} style={{
              padding: 14, borderRadius: 10, cursor: "pointer", transition: "all 0.15s",
              background: isA ? "rgba(167,139,250,0.08)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${isA ? "rgba(167,139,250,0.25)" : "rgba(255,255,255,0.05)"}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: isA ? "#a78bfa" : "rgba(255,255,255,0.5)", marginBottom: 4 }}>{r.label}</div>
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginBottom: 10, lineHeight: 1.5 }}>{r.desc}</div>
              {rows.map((row, idx) => {
                if (row[0] === "_sep") return <div key={idx} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "4px 0" }} />;
                const [label, val, col] = row;
                const isMacRow = label.startsWith("🖥");
                return (
                  <div key={idx} style={{ 
                    display: "flex", justifyContent: "space-between", marginBottom: 3,
                    padding: isMacRow ? "3px 4px" : undefined,
                    borderRadius: isMacRow ? 4 : undefined,
                    background: isMacRow ? "rgba(34,211,238,0.06)" : undefined,
                  }}>
                    <span style={{ fontSize: isMacRow ? 8 : 9, color: isMacRow ? "#22d3ee" : "rgba(255,255,255,0.35)" }}>{label}</span>
                    <span style={{ fontSize: 9, fontWeight: label === "Čistý zisk" ? 700 : 600, color: col, fontFamily: "monospace" }}>{val}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Explanation */}
      {macEnabled && (
        <div style={{
          marginTop: 10, padding: "8px 10px", borderRadius: 6,
          background: "rgba(34,211,238,0.04)", border: "1px solid rgba(34,211,238,0.1)",
          fontSize: 9, color: "rgba(255,255,255,0.4)", lineHeight: 1.8
        }}>
          <strong style={{ color: "#22d3ee" }}>Jak Mac ovlivňuje daně:</strong><br/>
          {macMode === "cash" ? (
            <>
              <strong>Daňová evidence:</strong> Mac nad 80 000 Kč = hmotný majetek → odepisuješ 3 roky (1. odpisová skupina, zrychlený odpis: 1. rok ≈ ⅓ ceny). Mac pod 80 000 Kč = drobný majetek → celý náklad v roce pořízení.<br/>
              <strong>Paušální daň / výdajový paušál:</strong> Odpis se neuplatňuje — daň je fixní nebo počítaná z % příjmů.
            </>
          ) : (
            <>
              <strong>Daňová evidence:</strong> Splátky operativního leasingu jsou <strong style={{ color: "#22c55e" }}>plně daňově uznatelný provozní náklad</strong> v měsíci zaplacení. Na rozdíl od jednorázového nákupu si celou zaplacenou částku odečtete v daném roce — bez čekání na 3leté odpisy.<br/>
              <strong>Paušální daň / výdajový paušál:</strong> Splátky se neuplatňují — daň je fixní nebo počítaná z % příjmů.
            </>
          )}
        </div>
      )}

      {!macEnabled && (
        <div style={{ marginTop: 12, fontSize: 9, color: "rgba(255,255,255,0.3)", lineHeight: 1.7 }}>
          <strong style={{ color: "rgba(255,255,255,0.5)" }}>Poznámka:</strong> Zjednodušený výpočet pro ilustraci principu. Nezahrnuje slevy na dani ani specifika DPH.
          Zapněte nákup Macu výše a uvidíte, jak se Mac promítne do daňového základu v daňové evidenci.
        </div>
      )}
    </div>
  );
}

// ─── Project Editor ───
function ProjectEditor({ projects, setProjects }) {
  const add = () => {
    const id = nextId();
    setProjects(prev => [...prev, {
      id, name: `Projekt ${String.fromCharCode(65 + prev.length)}`,
      startMonth: 0, durationMonths: 1, invoiceAmount: 50000, paymentDelay: 1,
      color: PROJECT_COLORS[prev.length % PROJECT_COLORS.length]
    }]);
  };
  const remove = (id) => setProjects(prev => prev.filter(p => p.id !== id));
  const update = (id, field, value) => setProjects(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#a78bfa" }}>Projekty ({projects.length})</span>
        <button onClick={add} style={{
          padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(167,139,250,0.3)",
          background: "rgba(167,139,250,0.1)", color: "#a78bfa", fontSize: 10, cursor: "pointer", fontFamily: "inherit"
        }}>+ Přidat projekt</button>
      </div>
      {/* Header row */}
      <div style={{ display: "grid", gridTemplateColumns: "8px 1fr 80px 60px 60px 60px 28px", gap: 8, marginBottom: 4, padding: "0 10px" }}>
        {["","název","fakturace","začátek","délka","splatnost",""].map((h,i) => (
          <span key={i} style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{h}</span>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {projects.map((p) => (
          <div key={p.id} style={{
            padding: "8px 10px", borderRadius: 8,
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
            display: "grid", gridTemplateColumns: "8px 1fr 80px 60px 60px 60px 28px", gap: 8, alignItems: "center"
          }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
            <input value={p.name} onChange={e => update(p.id, "name", e.target.value)} style={{
              background: "transparent", border: "none", color: "white", fontSize: 10, fontFamily: "inherit", outline: "none", minWidth: 0
            }} />
            <input type="number" value={p.invoiceAmount} step={5000} onChange={e => update(p.id, "invoiceAmount", Math.max(0, Number(e.target.value)))} style={{
              width: "100%", padding: "2px 4px", borderRadius: 3, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
              color: "white", fontSize: 10, fontFamily: "inherit", textAlign: "right", boxSizing: "border-box"
            }} />
            <select value={p.startMonth} onChange={e => update(p.id, "startMonth", Number(e.target.value))} style={{
              padding: "2px 2px", borderRadius: 3, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
              color: "white", fontSize: 9, fontFamily: "inherit"
            }}>
              {MONTHS.map((m,i) => <option key={i} value={i} style={{ background: "#1a1a2e" }}>{m}</option>)}
            </select>
            <select value={p.durationMonths} onChange={e => update(p.id, "durationMonths", Number(e.target.value))} style={{
              padding: "2px 2px", borderRadius: 3, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
              color: "white", fontSize: 9, fontFamily: "inherit"
            }}>
              {[1,2,3,4,5,6].map(n => <option key={n} value={n} style={{ background: "#1a1a2e" }}>{n} měs.</option>)}
            </select>
            <select value={p.paymentDelay} onChange={e => update(p.id, "paymentDelay", Number(e.target.value))} style={{
              padding: "2px 2px", borderRadius: 3, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
              color: "white", fontSize: 9, fontFamily: "inherit"
            }}>
              {[0,1,2,3,4,5,6].map(n => <option key={n} value={n} style={{ background: "#1a1a2e" }}>{n === 0 ? "hned" : `+${n}m`}</option>)}
            </select>
            <button onClick={() => remove(p.id)} style={{
              width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer",
              background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center"
            }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Export ───
function ExportButton({ containerRef }) {
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const el = containerRef.current;
      if (!el) return;
      const svgs = el.querySelectorAll("svg");
      const canvas = document.createElement("canvas");
      const scale = 2;
      const totalH = 120 + svgs.length * 320;
      canvas.width = 800 * scale; canvas.height = totalH * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, 800, totalH);
      ctx.fillStyle = "white"; ctx.font = "bold 18px monospace";
      ctx.fillText("Cash Flow Simulátor — Snímek", 24, 36);
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "11px monospace";
      ctx.fillText(`Export: ${new Date().toLocaleString("cs-CZ")}`, 24, 58);
      ctx.fillText("Pro plnou interaktivitu otevřete aplikaci v prohlížeči", 24, 76);
      let yOff = 100;
      for (const svg of svgs) {
        try {
          const clone = svg.cloneNode(true);
          clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          const svgData = new XMLSerializer().serializeToString(clone);
          const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
          const aspect = img.naturalWidth / img.naturalHeight;
          const dW = Math.min(760, img.naturalWidth); const dH = dW / aspect;
          ctx.drawImage(img, 20, yOff, dW, dH);
          yOff += dH + 16;
          URL.revokeObjectURL(url);
        } catch(e) {}
      }
      canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `cashflow_${Date.now()}.png`; a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch(e) { console.error("Export failed:", e); }
    setTimeout(() => setExporting(false), 1000);
  };
  return (
    <button onClick={handleExport} disabled={exporting} style={{
      padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)",
      fontSize: 10, cursor: "pointer", fontFamily: "inherit", opacity: exporting ? 0.4 : 1
    }}>{exporting ? "Exportuji…" : "📸 Export PNG"}</button>
  );
}

// ═══════════════════════════════════════════════
// ─── MAIN APP ───
// ═══════════════════════════════════════════════
export default function CashFlowSimulator() {
  const [projects, setProjects] = useState(DEFAULT_PROJECTS);
  const [fixedCosts, setFixedCosts] = useState(DEFAULT_FIXED_COSTS);
  const [scenario, setScenario] = useState(0);
  const [employeeGross, setEmployeeGross] = useState(55000);
  const [reserve, setReserve] = useState(0);
  const [activeTab, setActiveTab] = useState("overview");
  const [activeTax, setActiveTax] = useState("evidence");
  const [showHelp, setShowHelp] = useState(false);
  const [animMonth, setAnimMonth] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [macEnabled, setMacEnabled] = useState(false);
  const [macMonth, setMacMonth] = useState(2); // default: March
  const [macPrice, setMacPrice] = useState(29990);
  const [macMode, setMacMode] = useState("cash"); // "cash" | "leasing"
  const [leasingMonths, setLeasingMonths] = useState(24);
  const containerRef = useRef(null);
  const animRef = useRef(null);

  const data = useMemo(
    () => computeData(projects, fixedCosts, scenario, employeeGross, reserve),
    [projects, fixedCosts, scenario, employeeGross, reserve]
  );

  const totalFixed = fixedCosts.reduce((s,c) => s + c.amount, 0);
  const totalIncome = data.freelancerIncome.reduce((s,v) => s + v, 0);
  const empAnnualNet = data.employeeMonthly[0] * 12;
  const worstMonth = data.freelancerCumulative.reduce((min,v,i) => v < min.val ? {val:v,idx:i} : min, {val:Infinity,idx:0});

  const updateFixedCost = useCallback((idx, amount) => {
    setFixedCosts(prev => prev.map((c,i) => i===idx ? {...c, amount: Math.max(0,amount)} : c));
  }, []);

  const startAnimation = () => {
    if (isAnimating) { clearInterval(animRef.current); setIsAnimating(false); setAnimMonth(null); return; }
    setAnimMonth(-1); setIsAnimating(true);
    let month = -1;
    animRef.current = setInterval(() => {
      month++;
      if (month > 11) { clearInterval(animRef.current); setIsAnimating(false); setAnimMonth(null); return; }
      setAnimMonth(month);
    }, 800);
  };
  useEffect(() => () => clearInterval(animRef.current), []);

  // Build scenario set — B and D are adjacent early-year projects; both late = cash flow crisis
  const dynamicScenarios = useMemo(() => {
    const base = [{ label: "Vše OK", icon: "✓", overrides: {} }];
    const projB = projects.find(p => p.id === 2);
    const projD = projects.find(p => p.id === 3); // Redesign D
    const projE = projects.find(p => p.id === 5);
    // 1) B alone late — tight but survivable (dip to -27k)
    if (projB) {
      base.push({ label: `${projB.name} +2 měs.`, icon: "⏳", overrides: { [projB.id]: { addDelay: 2 } } });
    }
    // 2) B + D both late — crisis (-45k in May)
    if (projB && projD) {
      base.push({
        label: `${projB.name} + ${projD.name} pozdě`, icon: "⚠",
        overrides: { [projB.id]: { addDelay: 2 }, [projD.id]: { addDelay: 2 } }
      });
    }
    // 3) Worst case — B +3, D never pays, E late (-63k in June)
    const wo = {};
    if (projB) wo[projB.id] = { addDelay: 3 };
    if (projD) wo[projD.id] = { neverPays: true };
    if (projE) wo[projE.id] = { addDelay: 2 };
    if (Object.keys(wo).length > 0) {
      base.push({ label: "Všechno špatně", icon: "💀", overrides: wo });
    }
    return base;
  }, [projects]);

  // Recompute with dynamic scenarios
  const dataFinal = useMemo(() => {
    const overrides = dynamicScenarios[scenario]?.overrides || {};
    const totalFixed = fixedCosts.reduce((s,c) => s + c.amount, 0);
    const empNet = Math.round(employeeGross * 0.75);
    const employeeCumulative = MONTHS.map((_,i) => empNet * (i+1));
    const employeeMonthly = MONTHS.map(() => empNet);
    const freelancerIncome = new Array(12).fill(0);
    const freelancerCosts = new Array(12).fill(totalFixed);
    // Inject Mac purchase
    let macMonthlyPayment = 0;
    if (macEnabled && macMonth >= 0 && macMonth < 12) {
      if (macMode === "cash") {
        freelancerCosts[macMonth] += macPrice;
      } else {
        // Leasing: monthly payments from macMonth onwards
        // Leasing markup ~10-15% over cash price, spread over term
        const leasingTotal = Math.round(macPrice * 1.12);
        macMonthlyPayment = Math.round(leasingTotal / leasingMonths);
        for (let i = macMonth; i < 12; i++) {
          freelancerCosts[i] += macMonthlyPayment;
        }
      }
    }
    const freelancerNet = new Array(12).fill(0);
    const freelancerCumulative = new Array(12).fill(0);
    const projectBars = []; const invoiceEvents = []; const paymentEvents = []; const unpaidEvents = [];

    projects.forEach((p) => {
      projectBars.push({ ...p, endMonth: Math.min(p.startMonth + p.durationMonths - 1, 11) });
      const invoiceMonth = Math.min(p.startMonth + p.durationMonths, 11);
      invoiceEvents.push({ month: invoiceMonth, amount: p.invoiceAmount, project: p.name, projectId: p.id, color: p.color });
      const ov = overrides[p.id];
      if (ov && ov.neverPays) {
        unpaidEvents.push({ month: invoiceMonth, amount: p.invoiceAmount, project: p.name, color: p.color });
        return;
      }
      let delay = p.paymentDelay;
      if (ov && ov.addDelay) delay += ov.addDelay;
      const payMonth = invoiceMonth + delay;
      if (payMonth < 12) {
        freelancerIncome[payMonth] += p.invoiceAmount;
        paymentEvents.push({ month: payMonth, amount: p.invoiceAmount, project: p.name, color: p.color });
      } else {
        unpaidEvents.push({ month: invoiceMonth, amount: p.invoiceAmount, project: p.name, color: p.color, pending: true, expectedMonth: payMonth });
      }
    });

    let cumul = reserve;
    for (let i = 0; i < 12; i++) {
      freelancerNet[i] = freelancerIncome[i] - freelancerCosts[i];
      cumul += freelancerNet[i];
      freelancerCumulative[i] = cumul;
    }

    const totalIncomeYear = freelancerIncome.reduce((s,v) => s+v, 0);
    const totalCostsYear = freelancerCosts.reduce((s,v) => s+v, 0);
    
    // Mac cost for tax purposes
    // - Paušální daň: Mac doesn't affect tax (fixed payment)
    // - Výdajový paušál: Mac doesn't affect tax (% of income = expenses)
    // - Daňová evidence: 
    //     Cash purchase over 80k = hmotný majetek, odpis group 1 (3 years), 
    //       first year accelerated = price/3, or if under 80k = full deduction
    //     Leasing = monthly payments are fully deductible operating expense
    let macTaxDeduction = 0;
    let macTaxLabel = "";
    if (macEnabled) {
      if (macMode === "cash") {
        if (macPrice > 80000) {
          // Hmotný majetek — zrychlený odpis, 1. rok = cena / 3
          macTaxDeduction = Math.round(macPrice / 3);
          macTaxLabel = `Odpis Macu 1. rok (z ${fmtFull(macPrice)})`;
        } else {
          // Drobný majetek — celý náklad v roce pořízení
          macTaxDeduction = macPrice;
          macTaxLabel = `Mac (drobný majetek)`;
        }
      } else {
        // Leasing — splátky zaplacené v tomto roce
        const leasingTotal = Math.round(macPrice * 1.12);
        const monthlyPmt = Math.round(leasingTotal / leasingMonths);
        const monthsInYear = Math.min(12 - macMonth, 12);
        macTaxDeduction = monthlyPmt * monthsInYear;
        macTaxLabel = `Leasing ${monthsInYear}× ${fmtFull(monthlyPmt)}/měs.`;
      }
    }

    const taxData = {};
    const baseCosts = totalFixed * 12; // provozní náklady bez Macu
    TAX_REGIMES.forEach(regime => {
      let taxBase, tax, netAfterTax, healthSocial, deductibleCosts, macDeduction = 0;
      if (regime.id === "pausalni") { 
        tax = regime.monthlyTax * 12; taxBase = 0; healthSocial = 0; 
        deductibleCosts = baseCosts;
        netAfterTax = totalIncomeYear - totalCostsYear - tax; 
      }
      else if (regime.id === "vydajovy") { 
        const exp = totalIncomeYear * regime.rate; 
        deductibleCosts = exp;
        taxBase = Math.max(0, totalIncomeYear - exp); 
        tax = Math.round(taxBase * 0.15); 
        healthSocial = Math.round(taxBase * 0.5 * 0.423); 
        netAfterTax = totalIncomeYear - totalCostsYear - tax - healthSocial; 
      }
      else { 
        // Daňová evidence — skutečné náklady + Mac odpis/leasing
        macDeduction = macTaxDeduction;
        deductibleCosts = baseCosts + macDeduction;
        taxBase = Math.max(0, totalIncomeYear - deductibleCosts); 
        tax = Math.round(taxBase * 0.15); 
        healthSocial = Math.round(taxBase * 0.5 * 0.423); 
        netAfterTax = totalIncomeYear - totalCostsYear - tax - healthSocial; 
      }
      taxData[regime.id] = { 
        taxBase, tax, healthSocial, netAfterTax, 
        totalIncome: totalIncomeYear, totalCosts: baseCosts,
        deductibleCosts, macDeduction, macTaxLabel
      };
    });

    const unpaidTotal = unpaidEvents.reduce((s,e) => s + e.amount, 0);
    return { employeeMonthly, employeeCumulative, freelancerIncome, freelancerCosts, freelancerNet, freelancerCumulative, projectBars, invoiceEvents, paymentEvents, unpaidEvents, unpaidTotal, totalFixed, taxData, macInMonth: macEnabled ? macMonth : -1, macMonthlyPayment };
  }, [projects, fixedCosts, scenario, employeeGross, reserve, dynamicScenarios, macEnabled, macMonth, macPrice, macMode, leasingMonths]);

  const d = dataFinal;
  const totalIncomeF = d.freelancerIncome.reduce((s,v) => s+v, 0);
  const worstM = d.freelancerCumulative.reduce((min,v,i) => v < min.val ? {val:v,idx:i} : min, {val:Infinity,idx:0});

  const tabs = [
    { id: "overview", label: "Kumulativ", icon: "📈" },
    { id: "monthly", label: "Měsíční tok", icon: "📊" },
    { id: "timeline", label: "Projekty", icon: "📅" },
    { id: "tax", label: "Daňové režimy", icon: "🧾" },
    { id: "controls", label: "Parametry", icon: "⚙" },
  ];

  return (
    <div ref={containerRef} style={{
      minHeight: "100vh", background: "#0a0a0f", color: "white",
      fontFamily: "'JetBrains Mono','SF Mono','Fira Code',monospace",
      padding: "20px 16px", maxWidth: 820, margin: "0 auto"
    }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9,
              background: "linear-gradient(135deg, #22d3ee, #a78bfa)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 700, color: "white"
            }}>CF</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>Cash Flow Simulátor</h1>
              <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Zaměstnanec vs. OSVČ — nelineární realita podnikání</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={startAnimation} style={{
              padding: "5px 12px", borderRadius: 6, border: `1px solid ${isAnimating ? "rgba(239,68,68,0.2)" : "rgba(34,211,238,0.2)"}`,
              background: isAnimating ? "rgba(239,68,68,0.1)" : "rgba(34,211,238,0.08)",
              color: isAnimating ? "#ef4444" : "#22d3ee", fontSize: 10, cursor: "pointer", fontFamily: "inherit"
            }}>{isAnimating ? "⏹ Stop" : "▶ Prezentace"}</button>
            <ExportButton containerRef={containerRef} />
            <button onClick={() => setShowHelp(!showHelp)} style={{
              padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.4)", fontSize: 10, cursor: "pointer", fontFamily: "inherit"
            }}>?</button>
          </div>
        </div>
        {showHelp && (
          <div style={{
            marginTop: 10, padding: 12, borderRadius: 8,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
            fontSize: 10, lineHeight: 1.8, color: "rgba(255,255,255,0.5)"
          }}>
            <strong style={{ color: "#22d3ee" }}>Modrá</strong> = zaměstnanec (lineární).
            <strong style={{ color: "#a78bfa", marginLeft: 8 }}>Fialová</strong> = OSVČ (nelineární).<br/>
            <strong style={{ color: "#ef4444" }}>Červená</strong> = fixní náklady.
            <strong style={{ color: "#22c55e", marginLeft: 8 }}>Zelená</strong> = příchozí platby.
            <span style={{ color: "#fbbf24", marginLeft: 8 }}>●F</span> = faktura · <span style={{ color: "#22c55e" }}>●₿</span> = platba · <span style={{ color: "#ef4444" }}>●✗</span> = nezaplaceno<br/>
            <strong>▶ Prezentace</strong> = měsíc po měsíci. <strong>📸 Export</strong> = PNG snímek. Scénáře se automaticky přizpůsobují vašim projektům.
          </div>
        )}
      </div>

      {/* Animation indicator */}
      {animMonth !== null && animMonth >= 0 && (
        <div style={{
          textAlign: "center", padding: "8px 0", marginBottom: 12,
          fontSize: 13, fontWeight: 700, color: "#a78bfa", letterSpacing: "0.05em",
          background: "rgba(167,139,250,0.06)", borderRadius: 8
        }}>{MONTH_FULL[animMonth]}{animMonth === 11 ? " — konec roku" : ""}</div>
      )}

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 16 }}>
        {[
          { label: "Zaměstnanec/rok", value: fmtFull(empAnnualNet), color: "#22d3ee", sub: "čistá mzda" },
          { label: "OSVČ příjmy", value: fmtFull(totalIncomeF), color: "#22c55e", sub: d.unpaidTotal > 0 ? `(-${fmt(d.unpaidTotal)} nezaplaceno)` : "fakturace" },
          { label: "OSVČ náklady", value: fmtFull(d.totalFixed*12), color: "#ef4444", sub: "fixní/rok" },
          { label: "Nejhorší měsíc", value: fmtFull(worstM.val), color: worstM.val<0?"#ef4444":"#a78bfa", sub: MONTHS[worstM.idx] },
          { label: "Rezerva", value: fmtFull(reserve), color: "#fbbf24", sub: "startovní" },
        ].map((k,i) => (
          <div key={i} style={{
            padding: "8px 10px", borderRadius: 8,
            background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)"
          }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>{k.label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Reserve */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 8,
        padding: "8px 12px", borderRadius: 8,
        background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.1)"
      }}>
        <span style={{ fontSize: 10, color: "#fbbf24", fontWeight: 600, whiteSpace: "nowrap" }}>Rezerva / kontokorent:</span>
        <input type="range" min={0} max={500000} step={10000} value={reserve}
          onChange={e => setReserve(Number(e.target.value))}
          style={{ flex: 1, accentColor: "#fbbf24" }} />
        <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 600, fontFamily: "monospace", minWidth: 80, textAlign: "right" }}>{fmtFull(reserve)}</span>
      </div>

      {/* Mac Purchase */}
      <div style={{
        padding: "10px 12px", borderRadius: 8, marginBottom: 14,
        background: macEnabled ? "rgba(34,211,238,0.05)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${macEnabled ? "rgba(34,211,238,0.15)" : "rgba(255,255,255,0.06)"}`,
        transition: "all 0.2s"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => setMacEnabled(!macEnabled)} style={{
            padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer",
            fontSize: 10, fontWeight: 600, fontFamily: "inherit",
            background: macEnabled ? "rgba(34,211,238,0.15)" : "rgba(255,255,255,0.06)",
            color: macEnabled ? "#22d3ee" : "rgba(255,255,255,0.35)", transition: "all 0.15s"
          }}>{macEnabled ? "🖥 Mac zapnutý" : "🖥 Přidat nákup Macu"}</button>
          {macEnabled && (
            <>
              <select value={macPrice} onChange={e => setMacPrice(Number(e.target.value))} style={{
                padding: "3px 4px", borderRadius: 4, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                color: "white", fontSize: 9, fontFamily: "inherit"
              }}>
                {[
                  { label: "MacBook Neo", price: 16990 },
                  { label: "iPad Air 11″ M4", price: 16490 },
                  { label: "iPhone 17e", price: 16990 },
                  { label: "iPad Air 13″ M4", price: 22490 },
                  { label: "MacBook Air 13″ M5", price: 29990 },
                  { label: "MacBook Air 15″ M5", price: 35990 },
                  { label: "iMac 24″ M4", price: 37990 },
                  { label: "MacBook Pro 14″ M5", price: 46990 },
                  { label: "MacBook Pro 14″ M5 Pro", price: 59990 },
                  { label: "MacBook Pro 16″ M5 Pro", price: 74990 },
                  { label: "MacBook Pro 14″ M5 Max", price: 99990 },
                ].map(m => (
                  <option key={m.price} value={m.price} style={{ background: "#1a1a2e" }}>{m.label} — {fmtFull(m.price)}</option>
                ))}
              </select>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>od</span>
              <select value={macMonth} onChange={e => setMacMonth(Number(e.target.value))} style={{
                padding: "3px 4px", borderRadius: 4, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                color: "white", fontSize: 9, fontFamily: "inherit"
              }}>
                {MONTHS.map((m,i) => <option key={i} value={i} style={{ background: "#1a1a2e" }}>{m}</option>)}
              </select>
            </>
          )}
        </div>

        {macEnabled && (
          <div style={{ marginTop: 10 }}>
            {/* Cash vs Leasing toggle */}
            <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
              <button onClick={() => setMacMode("cash")} style={{
                padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 600, fontFamily: "inherit",
                background: macMode === "cash" ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.04)",
                color: macMode === "cash" ? "#ef4444" : "rgba(255,255,255,0.3)", transition: "all 0.15s"
              }}>Jednorázově — {fmtFull(macPrice)}</button>
              <button onClick={() => setMacMode("leasing")} style={{
                padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 600, fontFamily: "inherit",
                background: macMode === "leasing" ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
                color: macMode === "leasing" ? "#22c55e" : "rgba(255,255,255,0.3)", transition: "all 0.15s"
              }}>Operativní leasing</button>
            </div>

            {macMode === "leasing" && (
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                {[12, 24, 36].map(term => {
                  const total = Math.round(macPrice * 1.12);
                  const monthly = Math.round(total / term);
                  return (
                    <button key={term} onClick={() => setLeasingMonths(term)} style={{
                      padding: "8px 12px", borderRadius: 7, border: "none", cursor: "pointer",
                      fontSize: 10, fontFamily: "inherit", flex: 1, textAlign: "center",
                      background: leasingMonths === term ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.03)",
                      color: leasingMonths === term ? "#22c55e" : "rgba(255,255,255,0.35)",
                      border: `1px solid ${leasingMonths === term ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.06)"}`,
                      transition: "all 0.15s"
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{fmtFull(monthly)}</div>
                      <div style={{ fontSize: 8, marginTop: 2, opacity: 0.6 }}>/měs. × {term} měs.</div>
                      <div style={{ fontSize: 8, marginTop: 1, opacity: 0.4 }}>celkem {fmtFull(total)}</div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Summary line */}
            <div style={{
              padding: "6px 10px", borderRadius: 6, fontSize: 9, lineHeight: 1.7,
              background: macMode === "cash" ? "rgba(239,68,68,0.04)" : "rgba(34,197,94,0.04)",
              border: `1px solid ${macMode === "cash" ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)"}`,
              color: "rgba(255,255,255,0.45)"
            }}>
              {macMode === "cash" ? (
                <>
                  <strong style={{ color: "#ef4444" }}>Jednorázový výdaj {fmtFull(macPrice)} v {MONTHS[macMonth]}.</strong>{" "}
                  Podnikatel má zakázky, bude fakturovat — ale musí počítat s rizikem zpoždění plateb. Přepněte scénář a uvidíte, proč řekne "teď ne".
                </>
              ) : (
                <>
                  <strong style={{ color: "#22c55e" }}>Splátka {fmtFull(Math.round(Math.round(macPrice * 1.12) / leasingMonths))}/měs. od {MONTHS[macMonth]}.</strong>{" "}
                  Operativní leasing rozloží investici do malých měsíčních částek. Cash flow zůstává stabilnější — přepněte mezi "Jednorázově" a "Leasing" a porovnejte dopad na graf.
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 14, flexWrap: "wrap" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: "7px 14px", borderRadius: 7, border: "none", cursor: "pointer",
            fontSize: 10, fontWeight: 600, fontFamily: "inherit",
            background: activeTab === t.id ? "rgba(167,139,250,0.12)" : "rgba(255,255,255,0.025)",
            color: activeTab === t.id ? "#a78bfa" : "rgba(255,255,255,0.35)", transition: "all 0.15s"
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      {/* Charts */}
      <div style={{
        padding: "14px", borderRadius: 10,
        background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)",
        marginBottom: 14
      }}>
        {activeTab === "overview" && (
          <div>
            <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 9 }}>
              <span style={{ color: "#22d3ee" }}>● Zaměstnanec kumulativ</span>
              <span style={{ color: "#a78bfa" }}>● OSVČ kumulativ</span>
              {reserve > 0 && <span style={{ color: "#fbbf24" }}>--- Rezerva</span>}
            </div>
            <CumulativeChart data={d} animMonth={animMonth} reserve={reserve} macInMonth={macEnabled ? macMonth : -1} macPrice={macPrice} macIsLeasing={macMode === "leasing"} macMonthlyPmt={d.macMonthlyPayment} />
            {d.unpaidTotal > 0 && (
              <div style={{
                marginTop: 8, padding: "6px 10px", borderRadius: 6,
                background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)",
                fontSize: 9, color: "#ef4444"
              }}>
                ⚠ Nezaplacené faktury: {fmtFull(d.unpaidTotal)} — tato částka se v grafu neobjeví jako příjem
              </div>
            )}
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 6, lineHeight: 1.7 }}>
              Zaměstnanec roste lineárně — každý měsíc +{fmtFull(d.employeeMonthly[0])}. OSVČ má nepředvídatelnou cestu.
              {reserve > 0 ? ` Rezerva ${fmtFull(reserve)} slouží jako buffer.` : " Zkuste přidat rezervu sliderem nahoře."}
            </p>
          </div>
        )}

        {activeTab === "monthly" && (
          <div>
            <div style={{ display: "flex", gap: 14, marginBottom: 10, fontSize: 9 }}>
              <span style={{ color: "#ef4444" }}>● Náklady</span>
              <span style={{ color: "#22c55e" }}>● Příjmy</span>
            </div>
            <MonthlyBars data={d} animMonth={animMonth} />
            <div style={{ marginTop: 10, overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 9, borderCollapse: "collapse" }}>
                <thead><tr style={{ color: "rgba(255,255,255,0.3)" }}>
                  <td style={{ padding: "3px 0", width: 60 }}></td>
                  {MONTHS.map(m => <td key={m} style={{ textAlign: "right", padding: "3px 2px" }}>{m}</td>)}
                  <td style={{ textAlign: "right", padding: "3px 2px", fontWeight: 600 }}>Σ</td>
                </tr></thead>
                <tbody>
                  <tr style={{ color: "#22c55e" }}><td>Příjmy</td>
                    {d.freelancerIncome.map((v,i) => <td key={i} style={{ textAlign: "right", padding: "3px 2px" }}>{v>0?fmt(v):"—"}</td>)}
                    <td style={{ textAlign: "right", padding: "3px 2px", fontWeight: 600 }}>{fmt(totalIncomeF)}</td></tr>
                  <tr style={{ color: "#ef4444" }}><td>Náklady</td>
                    {d.freelancerCosts.map((v,i) => <td key={i} style={{ textAlign: "right", padding: "3px 2px" }}>{fmt(v)}</td>)}
                    <td style={{ textAlign: "right", padding: "3px 2px", fontWeight: 600 }}>{fmt(d.totalFixed*12)}</td></tr>
                  <tr style={{ fontWeight: 600 }}><td style={{ color: "rgba(255,255,255,0.5)" }}>Netto</td>
                    {d.freelancerNet.map((v,i) => <td key={i} style={{ textAlign: "right", padding: "3px 2px", color: v<0?"#ef4444":"#22c55e" }}>{fmt(v)}</td>)}
                    <td style={{ textAlign: "right", padding: "3px 2px", color: totalIncomeF-d.totalFixed*12>=0?"#22c55e":"#ef4444" }}>{fmt(totalIncomeF-d.totalFixed*12)}</td></tr>
                  <tr style={{ fontWeight: 600 }}><td style={{ color: "rgba(255,255,255,0.5)" }}>Kumulativ</td>
                    {d.freelancerCumulative.map((v,i) => <td key={i} style={{ textAlign: "right", padding: "3px 2px", color: v<0?"#ef4444":"#a78bfa" }}>{fmt(v)}</td>)}
                    <td/></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "timeline" && (
          <div>
            <div style={{ display: "flex", gap: 14, marginBottom: 10, fontSize: 9 }}>
              <span style={{ color: "#fbbf24" }}>●F Faktura</span>
              <span style={{ color: "#22c55e" }}>●₿ Platba</span>
              <span style={{ color: "#ef4444" }}>●✗ Nezaplaceno</span>
              <span style={{ color: "#a78bfa" }}>█ Práce</span>
            </div>
            <ProjectTimeline data={d} projects={projects} />
          </div>
        )}

        {activeTab === "tax" && (
          <TaxComparison taxData={d.taxData} activeTax={activeTax} setActiveTax={setActiveTax} macEnabled={macEnabled} macMode={macMode} />
        )}

        {activeTab === "controls" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <h3 style={{ fontSize: 11, fontWeight: 600, color: "#22d3ee", margin: "0 0 10px 0" }}>Zaměstnanec</h3>
              <label style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", display: "block", marginBottom: 4 }}>
                Hrubá mzda: {fmtFull(employeeGross)} → čistá ~{fmtFull(Math.round(employeeGross*0.75))}
              </label>
              <input type="range" min={25000} max={150000} step={5000} value={employeeGross}
                onChange={e => setEmployeeGross(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#22d3ee" }} />
            </div>
            <div>
              <h3 style={{ fontSize: 11, fontWeight: 600, color: "#ef4444", margin: "0 0 10px 0" }}>Fixní náklady OSVČ — {fmtFull(totalFixed)}/měs.</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {fixedCosts.map((c,i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", width: 95 }}>{c.name}</span>
                    <input type="number" value={c.amount} step={500}
                      onChange={e => updateFixedCost(i, Number(e.target.value))}
                      style={{
                        width: 70, padding: "3px 5px", borderRadius: 3,
                        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                        color: "white", fontSize: 10, fontFamily: "inherit", textAlign: "right"
                      }} />
                  </div>
                ))}
              </div>
            </div>
            <ProjectEditor projects={projects} setProjects={setProjects} />
          </div>
        )}
      </div>

      {/* Scenarios */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" }}>Scénáře — co když?</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {dynamicScenarios.map((s,i) => {
            const colors = ["#22c55e","#fbbf24","#ef4444","#ef4444"];
            const bgs = ["rgba(34,197,94,0.12)","rgba(251,191,36,0.12)","rgba(239,68,68,0.12)","rgba(239,68,68,0.15)"];
            return (
              <button key={i} onClick={() => setScenario(Math.min(i, dynamicScenarios.length-1))} style={{
                padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 10, fontFamily: "inherit",
                background: scenario===i ? bgs[Math.min(i,3)] : "rgba(255,255,255,0.03)",
                color: scenario===i ? colors[Math.min(i,3)] : "rgba(255,255,255,0.35)",
                transition: "all 0.15s"
              }}>{s.icon} {s.label}</button>
            );
          })}
        </div>
      </div>

      {/* Insight */}
      <div style={{
        padding: 14, borderRadius: 9,
        background: worstM.val<0 ? "rgba(239,68,68,0.05)" : "rgba(34,197,94,0.05)",
        border: `1px solid ${worstM.val<0?"rgba(239,68,68,0.12)":"rgba(34,197,94,0.12)"}`,
        marginBottom: 14
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: worstM.val<0?"#ef4444":"#22c55e", marginBottom: 4 }}>
          {worstM.val<0 ? "⚠ Cash flow klesá do mínusu" : "✓ Cash flow zůstává pozitivní"}
        </div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", lineHeight: 1.8 }}>
          {worstM.val < 0
            ? `V ${MONTH_FULL[worstM.idx].toLowerCase()}u klesne kumulativní cash flow na ${fmtFull(worstM.val)}. ${macEnabled && macMode === "cash" ? `Jednorázový nákup Macu za ${fmtFull(macPrice)} situaci ${scenario > 0 ? "dramaticky zhoršil" : "zkomplikoval"} — zkuste přepnout na operativní leasing. ` : macEnabled && macMode === "leasing" ? `I se splátkou ${fmtFull(d.macMonthlyPayment)}/měs. je cash flow v mínusu — ale propad je výrazně menší než při jednorázovém nákupu. ` : ""}${reserve > 0 && worstM.val + reserve >= 0 ? `Rezerva ${fmtFull(reserve)} to pokryje.` : reserve > 0 ? `Ani rezerva ${fmtFull(reserve)} nestačí — chybí ${fmtFull(Math.abs(worstM.val) - reserve)}.` : "Podnikatel potřebuje rezervu nebo financování."}`
            : macEnabled && macMode === "leasing"
              ? `Operativní leasing za ${fmtFull(d.macMonthlyPayment)}/měs. udržel cash flow v zeleném${scenario > 0 ? " i při zpožděné platbě" : ""}. Přepněte na "Jednorázově" a porovnejte dopad.`
              : macEnabled && scenario === 0
                ? `Se zapnutým Macem za ${fmtFull(macPrice)} cash flow zatím drží — ale přepněte scénář zpoždění a uvidíte, proč podnikatel řekne "teď ne".`
                : `Cash flow zůstává pozitivní${reserve>0?` (díky rezervě ${fmtFull(reserve)})`:""}.${d.unpaidTotal > 0 ? ` Pozor: ${fmtFull(d.unpaidTotal)} nezaplaceno.` : !macEnabled ? " Zkuste zapnout nákup Macu." : ""}`}
        </div>
      </div>

      {/* Trainer note */}
      <div style={{
        padding: 11, borderRadius: 7,
        background: "rgba(167,139,250,0.03)", border: "1px solid rgba(167,139,250,0.08)",
        fontSize: 9, color: "rgba(255,255,255,0.3)", lineHeight: 1.8
      }}>
        <strong style={{ color: "#a78bfa" }}>Pro trenéra — postup na školení:</strong><br/>
        1. Kumulativ "Vše OK" — podnikatel vypadá dobře, zakázky má<br/>
        2. Zapnout 🖥 Mac za 40k v březnu, režim "Jednorázově" — pořád OK, ale těsnější<br/>
        3. Přepnout scénář "Branding B +2 měs." → <strong style={{ color: "#ef4444" }}>propad do mínusu</strong><br/>
        4. Otázka: „Proč vám zákazník řekne ‚teď ne', i když vydělává?"<br/>
        5. Přepnout na "Operativní leasing" 24 měs. → <strong style={{ color: "#22c55e" }}>cash flow zůstává pozitivní</strong><br/>
        6. Pointa: vaše role není jen prodat Mac, ale pomoct zákazníkovi najít cestu, jak si ho pořídit bez ohrožení byznysu
      </div>
    </div>
  );
}
