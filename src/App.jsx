import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Zap,
  Skull,
  Bug,
  Radar,
  Activity,
  Pause,
  Play,
  RotateCcw,
  Info,
} from "lucide-react";

/**
 * CYBERGRID: Breach Containment
 * ------------------------------------------------------
 * A single, cohesive cyber defense game rendered on <canvas>.
 * Core loop: contain a spreading malware outbreak across a live network graph
 * by applying tactical actions to nodes while managing energy and cooldowns.
 *
 * Actions (hotkeys):
 *  Q – Isolate node (toggle): severs links, halts spread but reduces uptime
 *  W – Patch node: hardens & cleans over time if infected
 *  E – Deploy Honeypot: lures attacks, slows global spread while active
 *  R – IDS Sweep: temporary global debuff to attacker spread
 *
 * Win: Survive until the timer hits 0 without Risk hitting 100%.
 * Lose: Risk reaches 100% (too much of the graph compromised / critical loss).
 *
 * This file is self-contained and production-ready as a single React export.
 */

// ------------------------- Utilities -------------------------
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const now = () => performance.now();

function seededRandom(seed = Math.floor(Math.random() * 1e9)) {
  // Mulberry32 — tiny fast RNG for stable layouts
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------- Game Types -------------------------
// typedefs left as comments for clarity

// ------------------------- Constants -------------------------
const NODES = 32; // total nodes in the grid
const CRITICAL_COUNT = 3;
const START_TIME = 180; // seconds to survive
const BASE_THREAT = 0.085; // baseline spread rate (per second)
const ENERGY_MAX = 100;
const ENERGY_REGEN = 7; // per second
const CLEAN_TIME = 6.5; // seconds for a patched infected node to auto-clean

const COLORS = {
  bg1: "#05060a",
  bg2: "#0b1020",
  grid: "#121629",
  safe: "#64fbd2",
  infected: "rgb(255,80,168)",
  isolated: "#6b7280",
  patched: "#58a6ff",
  honeypot: "#facc15",
  edge: "#1f2937",
  text: "#cbd5e1",
  critical: "#ff9d00",
};

const ACTIONS = {
  isolate: {
    key: "q",
    label: "Isolate",
    cost: 18,
    cooldown: 1200, // ms
    desc: "Toggle quarantine. Severs links, halts spread from/to node.",
  },
  patch: {
    key: "w",
    label: "Patch",
    cost: 24,
    cooldown: 1400,
    desc: "Hardens node and cleans infection over time.",
  },
  honeypot: {
    key: "e",
    label: "Honeypot",
    cost: 28,
    cooldown: 4000,
    desc: "Baits attacker. Slight global slowdown while active.",
  },
  sweep: {
    key: "r",
    label: "IDS Sweep",
    cost: 36,
    cooldown: 12000,
    desc: "Network-wide scan. Heavily reduces spread for 8s.",
  },
};

// ------------------------- Name Generators -------------------------
const PREFIX = ["core", "edge", "dmz", "auth", "cache", "db", "api", "ops", "mesh", "quant", "ml", "crypto", "telemetry", "log", "mail"];
const SUFFIX = ["-north", "-south", "-west", "-east", "-alpha", "-beta", "-gamma", "-x", "-y", "-z", "-01", "-02", "-03", "-svc", "-gw"];
const CRIT_NAMES = ["Core-DB", "Finance-DB", "Auth-Server", "PKI-Root", "Ledger", "SCADA-Hub"];

function genName(rand) {
  return `${PREFIX[Math.floor(rand()*PREFIX.length)]}${SUFFIX[Math.floor(rand()*SUFFIX.length)]}`;
}

// ------------------------- Network Generation -------------------------
function generateNetwork(width, height, seed) {
  const rand = seededRandom(seed);
  const nodes = [];
  const edges = [];

  const cx = width / 2, cy = height / 2;
  const radius = Math.min(width, height) * 0.36;

  // Place nodes in concentric rings with jitter
  const rings = 3;
  let id = 0;
  for (let r = 0; r < rings; r++) {
    const ringCount = Math.round((NODES / rings) * (1 + (r === 2 ? 0.2 : 0)));
    const rRadius = radius * (0.4 + r * 0.3);
    for (let i = 0; i < ringCount && id < NODES; i++) {
      const t = (i / ringCount) * Math.PI * 2 + rand() * 0.1;
      const jitter = (rand() - 0.5) * 30;
      const x = cx + Math.cos(t) * (rRadius + jitter);
      const y = cy + Math.sin(t) * (rRadius + jitter);
      nodes.push({
        id: id++,
        x,
        y,
        infected: false,
        isolated: false,
        patched: 0,
        honeypot: false,
        security: 0.3 + rand() * 0.55,
        critical: false,
        name: genName(rand),
        cleanProg: 0,
        lastInfectAt: -1e9,
      });
    }
  }

  // Tag critical nodes
  for (let i = 0; i < CRITICAL_COUNT; i++) {
    const idx = Math.floor(rand() * nodes.length);
    nodes[idx].critical = true;
    nodes[idx].name = CRIT_NAMES[i % CRIT_NAMES.length];
    nodes[idx].security = Math.min(1, nodes[idx].security + 0.15);
  }

  // Connect graph: each node to k nearest + a few random long links
  const k = 3;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const dists = nodes
      .map((b) => ({ b: b.id, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
      .filter((o) => o.b !== a.id)
      .sort((u, v) => u.d - v.d)
      .slice(0, k + 1 + Math.floor(rand() * 2));
    for (const n of dists) {
      const b = n.b;
      if (!edges.find((e) => (e.a === a.id && e.b === b) || (e.a === b && e.b === a.id))) {
        edges.push({ a: a.id, b, w: 0.5 + rand() * 0.9 });
      }
    }
  }
  // sprinkle a few cross links
  for (let i = 0; i < Math.floor(NODES * 0.4); i++) {
    const a = Math.floor(rand() * nodes.length);
    const b = Math.floor(rand() * nodes.length);
    if (a !== b && !edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) {
      edges.push({ a, b, w: 0.4 + rand() * 0.8 });
    }
  }

  // seed initial infection
  for (let i = 0; i < 2; i++) {
    const n = nodes[Math.floor(rand() * nodes.length)];
    n.infected = true;
    n.lastInfectAt = 0;
  }

  return { nodes, edges };
}

// ------------------------- Rendering -------------------------
function useCanvas(size) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = size;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    c.style.width = w + "px";
    c.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [size[0], size[1]]);
  return canvasRef;
}

function toRgba(color, alpha) {
  if (typeof color === "string") {
    if (color.startsWith("rgb")) {
      const i1 = color.indexOf("(");
      const i2 = color.indexOf(")");
      if (i1 !== -1 && i2 !== -1) {
        const parts = color
          .slice(i1 + 1, i2)
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .slice(0, 3);
        if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
          const [r, g, b] = parts;
          return `rgba(${r},${g},${b},${alpha})`;
        }
      }
    }
    if (color[0] === "#") {
      let c = color.slice(1);
      if (c.length === 3) c = c.split("").map((ch) => ch + ch).join("");
      const r = parseInt(c.slice(0, 2), 16);
      const g = parseInt(c.slice(2, 4), 16);
      const b = parseInt(c.slice(4, 6), 16);
      if ([r, g, b].every((n) => !Number.isNaN(n))) {
        return `rgba(${r},${g},${b},${alpha})`;
      }
    }
  }
  return color;
}

function drawGlowCircle(ctx, x, y, r, color, alpha = 0.9) {
  ctx.save();
  const grad = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.6);
  grad.addColorStop(0, toRgba(color, alpha));
  grad.addColorStop(1, toRgba(color, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderNetwork(ctx, width, height, nodes, edges, opts) {
  // background gradient
  ctx.save();
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, COLORS.bg1);
  grad.addColorStop(1, COLORS.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // subtle grid lines
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // edges
  ctx.lineWidth = 1.5;
  for (const e of edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    const disabled = a.isolated || b.isolated;
    ctx.strokeStyle = disabled ? "#22262f" : COLORS.edge;
    ctx.globalAlpha = disabled ? 0.3 : 0.9 * (0.6 + e.w * 0.4);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // nodes
  for (const n of nodes) {
    const r = n.critical ? 11 : 8;

    // glow layers depending on state
    if (n.honeypot) drawGlowCircle(ctx, n.x, n.y, r + 10, "rgb(250,204,21)", 0.18);
    if (n.infected) drawGlowCircle(ctx, n.x, n.y, r + 14, COLORS.infected, 0.12);

    // base circle
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = n.infected
      ? COLORS.infected
      : n.isolated
      ? COLORS.isolated
      : n.patched > 0
      ? COLORS.patched
      : COLORS.safe;
    ctx.fill();

    // ring for critical
    if (n.critical) {
      ctx.strokeStyle = COLORS.critical;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // small notch for patched progress
    if (n.patched > 0) {
      ctx.strokeStyle = COLORS.patched;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const prog = Math.max(0, Math.min(1, n.cleanProg / CLEAN_TIME));
      ctx.arc(n.x, n.y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
      ctx.stroke();
    }

    if (opts?.selected === n.id) {
      ctx.strokeStyle = "#ffffff";
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
}

// ------------------------- Game Component -------------------------
export default function App() {
  const containerRef = useRef(null);
  const [size, setSize] = useState([900, 560]);
  const canvasRef = useCanvas(size);

  const [seed] = useState(() => Math.floor(Math.random() * 1e9));
  const [{ nodes, edges }, setGraph] = useState(() => ({ nodes: [], edges: [] }));

  const [selected, setSelected] = useState(null);
  const [energy, setEnergy] = useState(70);
  const [timer, setTimer] = useState(START_TIME);
  const [risk, setRisk] = useState(0);
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [victory, setVictory] = useState(false);
  const [events, setEvents] = useState([]); // banners
  const [log, setLog] = useState([]);

  // action state
  const [cooldowns, setCooldowns] = useState({ isolate: -1e9, patch: -1e9, honeypot: -1e9, sweep: -1e9 });
  const [sweepActiveUntil, setSweepActiveUntil] = useState(-1);

  // initialize layout based on container size
  useEffect(() => {
    const resize = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setSize([Math.max(640, Math.floor(rect.width)), Math.max(460, Math.floor(rect.height - 160))]);
    };
    resize();
    const obs = new ResizeObserver(resize);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // set up game graph
  useEffect(() => {
    const { nodes, edges } = generateNetwork(size[0], size[1], seed);
    setGraph({ nodes, edges });
  }, [seed, size[0], size[1]]);

  // click -> select node
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onClick = (e) => {
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let closest = null;
      let cd = 9999;
      for (const n of nodes) {
        const d = (n.x - x) ** 2 + (n.y - y) ** 2;
        if (d < cd && d < 16 ** 2) {
          cd = d; closest = n.id;
        }
      }
      if (closest != null) setSelected(closest);
    };
    c.addEventListener("click", onClick);
    return () => c.removeEventListener("click", onClick);
  }, [nodes, canvasRef]);

  // hotkeys
  useEffect(() => {
    const onKey = (e) => {
      if (!running || paused || gameOver) return;
      const k = e.key.toLowerCase();
      if (k === ACTIONS.isolate.key) actIsolate();
      if (k === ACTIONS.patch.key) actPatch();
      if (k === ACTIONS.honeypot.key) actHoneypot();
      if (k === ACTIONS.sweep.key) actSweep();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, paused, gameOver, selected, energy, cooldowns, nodes]);

  // logging helper
  const pushLog = (msg) => setLog((l) => (l.length > 140 ? [...l.slice(-110), msg] : [...l, msg]));

  // gameplay helpers
  const canUse = (name) => {
    const a = ACTIONS[name];
    const cdLeft = now() - cooldowns[name];
    return energy >= a.cost && cdLeft >= a.cooldown;
  };

  const spend = (name) => {
    setEnergy((e) => Math.max(0, Math.min(ENERGY_MAX, e - ACTIONS[name].cost)));
    setCooldowns((c) => ({ ...c, [name]: now() }));
  };

  // actions
  const actIsolate = () => {
    if (selected == null) return pushLog("Select a node first.");
    if (!canUse("isolate")) return pushLog("Isolate not ready.");
    setGraph((g) => {
      const n = { ...g.nodes[selected] };
      n.isolated = !n.isolated;
      const nodes = g.nodes.slice();
      nodes[selected] = n;
      return { ...g, nodes };
    });
    spend("isolate");
    pushLog(`Node #${selected} toggled isolation.`);
  };

  const actPatch = () => {
    if (selected == null) return pushLog("Select a node first.");
    if (!canUse("patch")) return pushLog("Patch not ready.");
    setGraph((g) => {
      const n = { ...g.nodes[selected] };
      n.patched = Math.max(0, Math.min(1, n.patched + 0.6));
      const nodes = g.nodes.slice();
      nodes[selected] = n;
      return { ...g, nodes };
    });
    spend("patch");
    pushLog(`Patching ${nodes[selected].name}… hardening applied.`);
  };

  const actHoneypot = () => {
    if (selected == null) return pushLog("Select a node first.");
    if (!canUse("honeypot")) return pushLog("Honeypot not ready.");
    setGraph((g) => {
      const n = { ...g.nodes[selected] };
      n.honeypot = !n.honeypot;
      const nodes = g.nodes.slice();
      nodes[selected] = n;
      return { ...g, nodes };
    });
    spend("honeypot");
    pushLog(`${nodes[selected].name} honeypot toggled.`);
  };

  const actSweep = () => {
    if (!canUse("sweep")) return pushLog("Sweep not ready.");
    spend("sweep");
    const until = now() + 8000;
    setSweepActiveUntil(until);
    pushLog("IDS sweep engaged — spread rate massively reduced for 8s.");
  };

  // main loop
  useEffect(() => {
    if (!running || paused || gameOver) return;
    let raf = 0;
    let last = now();

    const loop = () => {
      const t = now();
      const dt = Math.min(0.06, (t - last) / 1000); // clamp big frames
      last = t;

      // regen energy
      setEnergy((e) => Math.max(0, Math.min(ENERGY_MAX, e + 7 * dt)));

      // update infection spread
      setGraph((g) => {
        const nodes = g.nodes.slice();
        const edges = g.edges;
        const sweepFactor = t < sweepActiveUntil ? 0.35 : 1.0;
        const honeypotCount = nodes.reduce((a, n) => a + (n.honeypot ? 1 : 0), 0);
        const globalSlow = 1 - Math.min(0.25, honeypotCount * 0.03);

        const base = 0.085 * sweepFactor * globalSlow;

        // spreading attempts
        for (const ei of edges) {
          const a = nodes[ei.a];
          const b = nodes[ei.b];
          const trySpread = (src, dst) => {
            if (!src.infected || src.isolated || dst.isolated || dst.infected) return;
            const lure = dst.honeypot ? 1.3 : 1.0;
            const harden = 1 - dst.patched * 0.7;
            const sec = 1 - dst.security * 0.85;
            const lambda = base * ei.w * lure * harden * sec; // per second
            const p = 1 - Math.exp(-lambda * dt);
            if (Math.random() < p) {
              dst.infected = true;
              dst.lastInfectAt = t;
              if (dst.honeypot) setScore((s) => s + 8);
            }
          };
          trySpread(a, b);
          trySpread(b, a);
        }

        // cleaning progression on patched infected nodes
        for (const n of nodes) {
          if (n.infected && n.patched > 0) {
            n.cleanProg += dt * (0.6 + n.patched * 0.8);
            if (n.cleanProg >= CLEAN_TIME) {
              n.infected = false;
              n.cleanProg = 0;
              setScore((s) => s + 25);
              setLog((l) => [...l, `✔ ${n.name} cleaned.`]);
            }
          } else {
            n.cleanProg = Math.max(0, n.cleanProg - dt * 0.4);
          }
        }

        return { nodes, edges };
      });

      // risk & timer
      setTimer((tm) => Math.max(0, Math.min(START_TIME, tm - dt)));
      setRisk(() => {
        // NOTE: using stale nodes state here is OK visually; risk will catch up next frame
        // (avoids extra state reads in tight loop)
        return 0; // placeholder; it will be recalculated below in render pass
      });

      // render
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        // recompute risk from latest nodes snapshot for accurate HUD
        const _nodes = (typeof window !== "undefined" && window.__latestNodes) || [];
        const inf = _nodes.filter((n) => n.infected).length;
        const critInf = _nodes.filter((n) => n.critical && n.infected).length;
        const ratio = inf / Math.max(1, _nodes.length);
        const computedRisk = Math.max(0, Math.min(1, ratio + critInf * 0.22));
        setRisk(computedRisk);
      }

      if (risk >= 1 && !gameOver) {
        setGameOver(true);
        setVictory(false);
        setRunning(false);
        setLog((l) => [...l, "❌ Risk maxed out. Breach containment failed."]);
      } else if (timer <= 0 && !gameOver) {
        setGameOver(true);
        setVictory(true);
        setRunning(false);
        setScore((s) => s + 200);
        setLog((l) => [...l, "🏆 Containment sustained. Threat actor disengaged."]);
      } else {
        raf = requestAnimationFrame(loop);
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, paused, gameOver, risk, timer, canvasRef, events]);

  // draw once when not running + keep a latest snapshot for HUD risk calc
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) renderNetwork(ctx, size[0], size[1], nodes, edges, { selected });
    // store snapshot
    if (typeof window !== "undefined") window.__latestNodes = nodes;
  }, [nodes, edges, size, canvasRef, selected]);

  // start / reset
  const startGame = () => {
    setScore(0);
    setEnergy(70);
    setTimer(START_TIME);
    setRisk(0);
    setCooldowns({ isolate: -1e9, patch: -1e9, honeypot: -1e9, sweep: -1e9 });
    setEvents([]);
    setLog(["▶ Simulation initialized. Survive and contain the breach."]);

    const { nodes, edges } = generateNetwork(size[0], size[1], Math.floor(Math.random() * 1e9));
    setGraph({ nodes, edges });

    setGameOver(false);
    setVictory(false);
    setRunning(true);
    setPaused(false);
  };

  const resetLayout = () => {
    const { nodes, edges } = generateNetwork(size[0], size[1], Math.floor(Math.random() * 1e9));
    setGraph({ nodes, edges });
    setSelected(null);
  };

  // UI helpers
  const cdLeft = (name) => Math.max(0, (ACTIONS[name].cooldown - (now() - cooldowns[name])) / 1000);

  const statChip = (Icon, label, value, alt) => (
    <div className="flex items-center gap-2 bg-zinc-900/60 rounded-xl px-3 py-2 shadow-inner border border-zinc-800">
      <Icon className="w-4 h-4 opacity-80" />
      <div className="text-xs uppercase tracking-widest opacity-60">{label}</div>
      <div className="text-sm font-semibold ml-1">{value}</div>
      {alt && <div className="text-xs opacity-50 ml-1">{alt}</div>}
    </div>
  );

  const ActionButton = ({ name, icon: Icon }) => {
    const a = ACTIONS[name];
    const ready = canUse(name);
    return (
      <button
        onClick={() => {
          if (name === "isolate") actIsolate();
          if (name === "patch") actPatch();
          if (name === "honeypot") actHoneypot();
          if (name === "sweep") actSweep();
        }}
        className={`group relative flex items-center gap-2 rounded-xl px-4 py-3 border transition 
          ${ready ? "bg-zinc-900/70 hover:bg-zinc-800/70 border-zinc-700 hover:border-zinc-600" : "bg-zinc-900/40 border-zinc-800 opacity-60 cursor-not-allowed"}`}
        disabled={!ready}
        title={`${a.label} [${a.key.toUpperCase()}] — ${a.desc}`}
      >
        <Icon className="w-4 h-4" />
        <div className="text-sm font-semibold">{a.label}</div>
        <div className="text-[10px] opacity-60 ml-1">[{a.key.toUpperCase()}]</div>
        <div className="ml-auto text-xs opacity-70">-{a.cost}⚡</div>
        {!ready && (
          <div className="absolute -bottom-1 right-2 text-[10px] text-amber-300/80">
            {cdLeft(name).toFixed(1)}s
          </div>
        )}
      </button>
    );
  };

  return (
    <div ref={containerRef} className="w-full h-full min-h-[720px] text-slate-200 bg-gradient-to-b from-black to-[#0a0f1d]">
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-lg font-bold tracking-wider">CYBERGRID: Breach Containment</div>
          <div className="text-xs opacity-60">single-game cyber defense</div>
        </div>
        <div className="flex items-center gap-3">
          {statChip(Activity, "Risk", `${Math.round(risk * 100)}%`) }
          {statChip(Radar, "Time", `${Math.max(0, Math.floor(timer))}s`) }
          {statChip(Zap, "Energy", `${Math.floor(energy)}`, "/100") }
          {statChip(Bug, "Infected", nodes.filter((n) => n.infected).length) }
          <div className="flex items-center gap-2 bg-zinc-900/60 rounded-xl px-3 py-2 shadow-inner border border-zinc-800">
            <Shield className="w-4 h-4 opacity-80" />
            <div className="text-xs uppercase tracking-widest opacity-60">Score</div>
            <div className="text-sm font-semibold ml-1">{score}</div>
          </div>
        </div>
      </div>

      {/* Main Area */}
      <div className="px-4 grid grid-cols-12 gap-4">
        <div className="col-span-9 relative rounded-2xl overflow-hidden border border-zinc-800 bg-black/40">
          <canvas ref={canvasRef} className="block w-full h-[560px]" />

          {/* selection tooltip */}
          <AnimatePresence>
            {selected != null && nodes[selected] && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="absolute left-3 top-3 bg-zinc-900/90 backdrop-blur rounded-xl border border-zinc-700 px-3 py-2 text-xs">
                <div className="font-semibold text-sm flex items-center gap-2">
                  <Info className="w-4 h-4" /> {nodes[selected].name}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <div>Security: {(nodes[selected].security*100|0)}%</div>
                  <div>State: {nodes[selected].infected ? "INFECTED" : nodes[selected].isolated ? "ISOLATED" : nodes[selected].patched>0?"PATCHED":"OK"}</div>
                  <div>Critical: {nodes[selected].critical ? "Yes" : "No"}</div>
                  <div>Honeypot: {nodes[selected].honeypot ? "Active" : "No"}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* banners */}
          <div className="absolute left-0 right-0 top-2 flex justify-center pointer-events-none">
            <AnimatePresence>
              {events.slice(-1).map((e) => (
                <motion.div key={e.id} initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}
                  className="px-4 py-2 rounded-xl bg-amber-500/10 text-amber-300 border border-amber-500/30 backdrop-blur">
                  {e.txt}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* overlays: start/pause/gameover */}
          <AnimatePresence>
            {!running && !gameOver && (
              <motion.div className="absolute inset-0 bg-black/60 backdrop-blur flex items-center justify-center"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="text-center">
                  <div className="text-2xl font-bold tracking-wider">CONTAIN THE BREACH</div>
                  <div className="opacity-80 mt-2 text-sm max-w-xl mx-auto">
                    A persistent threat actor has penetrated the perimeter. Keep Risk under 100% until the timer ends.
                    Click nodes to select. Use hotkeys Q/W/E/R or the action panel to respond.
                  </div>
                  <div className="mt-6 flex items-center justify-center gap-3">
                    <button onClick={startGame} className="px-5 py-3 rounded-xl bg-emerald-500/90 hover:bg-emerald-400 text-black font-semibold flex items-center gap-2">
                      <Play className="w-4 h-4" /> Start Simulation
                    </button>
                    <button onClick={resetLayout} className="px-5 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 flex items-center gap-2">
                      <RotateCcw className="w-4 h-4" /> New Topology
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {paused && (
              <motion.div className="absolute inset-0 bg-black/50 backdrop-blur flex items-center justify-center"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="text-center">
                  <div className="text-2xl font-bold">Paused</div>
                  <div className="mt-4">
                    <button onClick={() => setPaused(false)} className="px-4 py-2 rounded-xl bg-emerald-500/90 text-black font-semibold flex items-center gap-2">
                      <Play className="w-4 h-4" /> Resume
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {gameOver && (
              <motion.div className="absolute inset-0 bg-black/70 backdrop-blur flex items-center justify-center"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="text-center">
                  <div className={`text-3xl font-black ${victory ? "text-emerald-300" : "text-rose-300"}`}>
                    {victory ? "CONTAINMENT ACHIEVED" : "CONTAINMENT FAILURE"}
                  </div>
                  <div className="mt-2 opacity-80">Final Score: {score}</div>
                  <div className="mt-6 flex items-center justify-center gap-3">
                    <button onClick={startGame} className="px-5 py-3 rounded-xl bg-emerald-500/90 hover:bg-emerald-400 text-black font-semibold flex items-center gap-2">
                      <Play className="w-4 h-4" /> Run Again
                    </button>
                    <button onClick={resetLayout} className="px-5 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 flex items-center gap-2">
                      <RotateCcw className="w-4 h-4" /> New Topology
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Actions + Log */}
        <div className="col-span-3 flex flex-col gap-3">
          <div className="rounded-2xl border border-zinc-800 p-3 bg-zinc-950/60">
            <div className="text-xs uppercase tracking-widest opacity-60 mb-2">Actions</div>
            <div className="grid grid-cols-1 gap-2">
              <ActionButton name="isolate" icon={Shield} />
              <ActionButton name="patch" icon={Activity} />
              <ActionButton name="honeypot" icon={Skull} />
              <ActionButton name="sweep" icon={Radar} />
            </div>
            <div className="mt-3 h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400" style={{ width: `${(energy/100)*100}%` }} />
            </div>
            <div className="text-[11px] opacity-60 mt-1">Energy</div>

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => {
                  if (!running && !gameOver) startGame(); else setPaused((p) => !p);
                }}
                className="flex-1 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 flex items-center justify-center gap-2"
              >
                {running && !paused ? <><Pause className="w-4 h-4" /> Pause</> : <><Play className="w-4 h-4" /> {gameOver?"Play Again":"Start"}</>}
              </button>
              <button onClick={resetLayout} className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 flex items-center gap-2">
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 p-3 bg-zinc-950/60 min-h-[180px] max-h-[220px] overflow-auto">
            <div className="text-xs uppercase tracking-widest opacity-60 mb-2">Event Log</div>
            <div className="space-y-1 text-xs">
              {log.slice(-100).map((l, i) => (
                <div key={i} className="opacity-80">{l}</div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 p-3 bg-zinc-950/60">
            <div className="text-xs uppercase tracking-widest opacity-60 mb-2">How to Play</div>
            <ul className="text-xs opacity-80 list-disc ml-4 space-y-1">
              <li>Click a node to select it. Use Q/W/E to act on it; R for global sweep.</li>
              <li><strong>Isolate</strong> buys time but reduces connectivity. Toggle again to rejoin.</li>
              <li><strong>Patch</strong> hardens a node and will clean infection over time.</li>
              <li><strong>Honeypot</strong> lures attacks and slightly slows global spread.</li>
              <li><strong>IDS Sweep</strong> slashes spread rates for 8 seconds.</li>
              <li>Survive until the timer ends without Risk hitting 100%.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 text-[11px] opacity-60 flex items-center justify-between">
        <div>Built for the browser • Single-game loop • Hotkeys: Q/W/E/R</div>
        <div>© CYBERGRID // Acheron</div>
      </div>
    </div>
  );
}
