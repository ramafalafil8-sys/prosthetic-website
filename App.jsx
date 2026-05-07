import React, { useMemo, useState } from "react";

const MIN_ANGLE = 0;
const MAX_ANGLE = 180;
const DEFAULT_VOICE_PRESETS = [
  { id: "L", label: "Low", angle: 30, commandId: 10001 },
  { id: "M", label: "Medium", angle: 90, commandId: 10002 },
  { id: "H", label: "High", angle: 150, commandId: 10000 },
];
const DEFAULT_TICKS = [30, 55, 80, 100, 120, 145, 165];

function clamp(v, min = MIN_ANGLE, max = MAX_ANGLE) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function angleToLabel(angle) {
  const a = clamp(angle);
  if (a < 45) return "Very compliant";
  if (a < 85) return "Compliant";
  if (a < 125) return "Balanced";
  if (a < 160) return "Stiff";
  return "Very stiff";
}

function angleToPercent(angle) {
  return Math.round((clamp(angle) / 180) * 100);
}

function generateTicks(count) {
  const n = Math.round(clamp(count, 1, 12));
  if (n === 1) return [90];
  return Array.from({ length: n }, (_, i) => Math.round((i / (n - 1)) * 180));
}

function normalizeVoicePresets(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((p, i) => ({
        id: String(p?.id || `V${i + 1}`).slice(0, 10),
        label: String(p?.label || `Preset ${i + 1}`).slice(0, 24),
        angle: Math.round(clamp(p?.angle ?? 90)),
        commandId: Number.isFinite(Number(p?.commandId)) ? Number(p.commandId) : 10000 + i,
      }))
      .slice(0, 12);
  }

  if (raw && typeof raw === "object") {
    return [
      { id: "L", label: "Low", angle: Math.round(clamp(raw.L ?? 30)), commandId: 10001 },
      { id: "M", label: "Medium", angle: Math.round(clamp(raw.M ?? 90)), commandId: 10002 },
      { id: "H", label: "High", angle: Math.round(clamp(raw.H ?? 150)), commandId: 10000 },
    ];
  }

  return DEFAULT_VOICE_PRESETS;
}

function voiceArrayToLegacyObject(presets) {
  const out = {};
  presets.forEach((p) => {
    out[p.id] = p.angle;
  });
  return out;
}

function getDefaultQuickPreset(voicePresets, id, fallbackAngle) {
  return voicePresets.find((p) => p.id === id)?.angle ?? fallbackAngle;
}

function buildCfgPacket({ tickAngles, activeTick, voicePresets, activeVoice }) {
  const safeTicks = Array.isArray(tickAngles) && tickAngles.length ? tickAngles.map((v) => Math.round(clamp(v))).slice(0, 12) : DEFAULT_TICKS;
  const safeVoice = normalizeVoicePresets(voicePresets);
  const safeActive = safeVoice.some((p) => p.id === activeVoice) ? activeVoice : safeVoice[0]?.id || "M";

  return {
    count: safeTicks.length,
    step: 15,
    imu_selected: Math.round(clamp(activeTick, 0, safeTicks.length - 1)),
    imu_angles: safeTicks,
    voice_presets: safeVoice,
    voice_hml: voiceArrayToLegacyObject(safeVoice),
    voice_selected: safeActive,
  };
}

function runLogicTests() {
  const tests = [
    ["clamp low", clamp(-5) === 0],
    ["clamp high", clamp(999) === 180],
    ["clamp bad input", clamp("bad") === 0],
    ["percent midpoint", angleToPercent(90) === 50],
    ["label compliant", angleToLabel(60) === "Compliant"],
    ["label stiff", angleToLabel(150) === "Stiff"],
    ["one tick centered", JSON.stringify(generateTicks(1)) === JSON.stringify([90])],
    ["five ticks span", JSON.stringify(generateTicks(5)) === JSON.stringify([0, 45, 90, 135, 180])],
    ["legacy voice object converts", normalizeVoicePresets({ L: -1, M: 90, H: 999 })[2].angle === 180],
    ["multi voice cfg stores array", Array.isArray(buildCfgPacket({ tickAngles: [0, 90], activeTick: 1, voicePresets: [{ id: "R", label: "Run", angle: 155, commandId: 10003 }], activeVoice: "R" }).voice_presets)],
  ];

  const failed = tests.filter(([, ok]) => !ok);
  if (failed.length) {
    console.warn("Prosthetic web app logic tests failed:", failed.map(([name]) => name));
  }
}

runLogicTests();

function Icon({ children }) {
  return <span className="text-2xl leading-none select-none" aria-hidden="true">{children}</span>;
}

export default function ProstheticWebControlApp() {
  const [role, setRole] = useState(null);
  const [connected, setConnected] = useState(false);
  const [serialStatus, setSerialStatus] = useState("Not connected");
  const [activeVoice, setActiveVoice] = useState("M");
  const [voicePresets, setVoicePresets] = useState(DEFAULT_VOICE_PRESETS);
  const [tickCount, setTickCount] = useState(DEFAULT_TICKS.length);
  const [activeTick, setActiveTick] = useState(3);
  const [tickAngles, setTickAngles] = useState(DEFAULT_TICKS);
  const [currentAngle, setCurrentAngle] = useState(90);

  const currentLabel = useMemo(() => angleToLabel(currentAngle), [currentAngle]);

  async function connectSerial() {
    try {
      if (!("serial" in navigator)) {
        setSerialStatus("Web Serial is not supported. Use Chrome or Edge on desktop.");
        return;
      }

      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      window.prostheticSerialPort = port;
      setConnected(true);
      setSerialStatus("Connected to Arduino @ 115200");
      await sendLine("CFGGET");
      readSerial(port);
    } catch (err) {
      setSerialStatus(`Connection failed: ${err.message}`);
    }
  }

  async function sendLine(line) {
    try {
      const port = window.prostheticSerialPort;
      if (!port || !port.writable) {
        setSerialStatus(`Demo mode: would send ${line}`);
        return;
      }

      const writer = port.writable.getWriter();
      try {
        const data = new TextEncoder().encode(line.trim() + "\n");
        await writer.write(data);
      } finally {
        writer.releaseLock();
      }
      setSerialStatus(`Sent: ${line}`);
    } catch (err) {
      setSerialStatus(`Send failed: ${err.message}`);
    }
  }

  async function readSerial(port) {
    try {
      let buffer = "";
      while (port.readable) {
        const reader = port.readable.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += new TextDecoder().decode(value);
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            lines.forEach(handleArduinoLine);
          }
        } finally {
          reader.releaseLock();
        }
      }
    } catch (err) {
      setSerialStatus(`Read stopped: ${err.message}`);
    }
  }

  function handleArduinoLine(raw) {
    const line = raw.trim();
    if (!line) return;
    setSerialStatus(line);

    if (line.startsWith("CFG,")) {
      try {
        const cfg = JSON.parse(line.slice(4));
        if (cfg.voice_presets) {
          const cleanVoice = normalizeVoicePresets(cfg.voice_presets);
          setVoicePresets(cleanVoice);
          if (cleanVoice.some((p) => p.id === cfg.voice_selected)) setActiveVoice(cfg.voice_selected);
        } else if (cfg.voice_hml) {
          const cleanVoice = normalizeVoicePresets(cfg.voice_hml);
          setVoicePresets(cleanVoice);
          if (["L", "M", "H"].includes(cfg.voice_selected)) setActiveVoice(cfg.voice_selected);
        }

        if (Array.isArray(cfg.imu_angles) && cfg.imu_angles.length) {
          const clean = cfg.imu_angles.map((v) => Math.round(clamp(v))).slice(0, 12);
          setTickAngles(clean);
          setTickCount(clean.length);
          setActiveTick(Math.round(clamp(cfg.imu_selected ?? 0, 0, clean.length - 1)));
        }
      } catch {
        setSerialStatus("Received bad CFG packet");
      }
    }

    if (line.startsWith("ACK,REACHED,")) {
      const angle = Number(line.split(",")[2]);
      if (Number.isFinite(angle)) setCurrentAngle(Math.round(clamp(angle)));
    }
  }

  function saveFullConfig() {
    const packet = buildCfgPacket({ tickAngles, activeTick, voicePresets, activeVoice });
    sendLine(`CFG,${JSON.stringify(packet)}`);
  }

  function updateVoicePreset(id, patch) {
    const next = normalizeVoicePresets(
      voicePresets.map((p) => (p.id === id ? { ...p, ...patch, angle: patch.angle !== undefined ? Math.round(clamp(patch.angle)) : p.angle } : p))
    );
    setVoicePresets(next);

    const edited = next.find((p) => p.id === id);
    if (edited) sendLine(`VPSET,${edited.id},${edited.angle}`);
  }

  function addVoicePreset() {
    const n = voicePresets.length + 1;
    const id = `V${n}`;
    const next = normalizeVoicePresets([...voicePresets, { id, label: `Preset ${n}`, angle: 90, commandId: 10000 + n }]);
    setVoicePresets(next);
    setActiveVoice(id);
    sendLine(`VPSET,${id},90`);
  }

  function removeVoicePreset(id) {
    if (voicePresets.length <= 1) return;
    const next = voicePresets.filter((p) => p.id !== id);
    setVoicePresets(next);
    if (activeVoice === id) setActiveVoice(next[0].id);
    sendLine(`VPDEL,${id}`);
  }

  function activateVoicePreset(id) {
    setActiveVoice(id);
    sendLine(`VPACT,${id}`);
  }

  function testVoicePreset(preset) {
    sendLine(`VOICE ${preset.commandId}`);
    setCurrentAngle(preset.angle);
  }

  function setPatientStiffness(angle) {
    const clean = Math.round(clamp(angle));
    setCurrentAngle(clean);
    sendLine(`GOTO ${clean}`);
  }

  function autoGenerateTicks(count) {
    const values = generateTicks(count);
    setTickCount(values.length);
    setTickAngles(values);
    setActiveTick((old) => Math.min(old, values.length - 1));
  }

  if (!role) return <RoleSelect onSelect={setRole} />;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <BackgroundGlow />
      <div className="relative z-10 max-w-7xl mx-auto p-6 space-y-6">
        <Header role={role} connected={connected} serialStatus={serialStatus} onConnect={connectSerial} onSwitchRole={() => setRole(null)} />
        {role === "prescriber" ? (
          <PrescriberDashboard currentAngle={currentAngle} setCurrentAngle={setPatientStiffness} voicePresets={voicePresets} activeVoice={activeVoice} activateVoicePreset={activateVoicePreset} updateVoicePreset={updateVoicePreset} addVoicePreset={addVoicePreset} removeVoicePreset={removeVoicePreset} testVoicePreset={testVoicePreset} tickAngles={tickAngles} setTickAngles={setTickAngles} tickCount={tickCount} autoGenerateTicks={autoGenerateTicks} activeTick={activeTick} setActiveTick={setActiveTick} saveFullConfig={saveFullConfig} sendLine={sendLine} />
        ) : (
          <PatientDashboard currentAngle={currentAngle} currentLabel={currentLabel} setPatientStiffness={setPatientStiffness} voicePresets={voicePresets} sendLine={sendLine} />
        )}
      </div>
    </div>
  );
}

function BackgroundGlow() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl" />
      <div className="absolute top-40 right-0 w-96 h-96 bg-fuchsia-500/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-1/3 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
    </div>
  );
}

function RoleSelect({ onSelect }) {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <BackgroundGlow />
      <div className="relative z-10 w-full max-w-5xl animate-[fadeIn_0.35s_ease-out]">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/10 mb-5">
            <Icon>⚡</Icon>
            <span className="text-sm text-slate-300">Adaptive Prosthetic Stiffness Control</span>
          </div>
          <h1 className="text-5xl font-bold tracking-tight">Choose your dashboard</h1>
          <p className="text-slate-400 mt-4 text-lg">Prescriber gets exact clinical control. Patient gets simple daily stiffness control.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <RoleCard icon="🩺" title="Prescriber" subtitle="Clinical configuration" points={["Exact stiffness degrees", "Expandable voice presets", "IMU gesture tick setup", "Compact diagnostics"]} onClick={() => onSelect("prescriber")} />
          <RoleCard icon="👤" title="Patient" subtitle="Simple daily control" points={["Compliant to stiff slider", "Quick comfort presets", "No confusing degree values", "Clean safe controls"]} onClick={() => onSelect("patient")} />
        </div>
      </div>
    </div>
  );
}

function RoleCard({ icon, title, subtitle, points, onClick }) {
  return (
    <button onClick={onClick} className="group text-left rounded-3xl p-8 bg-white/10 border border-white/10 hover:bg-white/15 hover:border-cyan-300/50 transition shadow-2xl">
      <div className="w-16 h-16 rounded-2xl bg-cyan-400/15 flex items-center justify-center mb-6 group-hover:scale-105 transition text-3xl">{icon}</div>
      <h2 className="text-3xl font-bold">{title}</h2>
      <p className="text-cyan-200 mt-1">{subtitle}</p>
      <div className="mt-6 space-y-3">
        {points.map((p) => <div key={p} className="flex items-center gap-3 text-slate-300"><div className="w-2 h-2 rounded-full bg-cyan-300" />{p}</div>)}
      </div>
    </button>
  );
}

function Header({ role, connected, serialStatus, onConnect, onSwitchRole }) {
  return (
    <div className="rounded-3xl bg-white/10 border border-white/10 p-5 shadow-2xl backdrop-blur flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-cyan-400/15 flex items-center justify-center text-2xl">{role === "prescriber" ? "🩺" : "👤"}</div>
        <div><h1 className="text-2xl font-bold">Prosthetic Stiffness Control</h1><p className="text-slate-400 capitalize">{role} dashboard</p></div>
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <div className="px-4 py-3 rounded-2xl bg-slate-900/70 border border-white/10 text-sm text-slate-300"><span className={connected ? "text-emerald-300" : "text-yellow-300"}>{connected ? "Connected" : "Demo / disconnected"}</span><span className="mx-2 text-slate-600">|</span>{serialStatus}</div>
        <button onClick={onConnect} className="px-5 py-3 rounded-2xl bg-cyan-400 text-slate-950 font-bold hover:bg-cyan-300 transition flex items-center gap-2"><span>🔌</span> Connect Arduino</button>
        <button onClick={onSwitchRole} className="px-5 py-3 rounded-2xl bg-white/10 border border-white/10 hover:bg-white/15 transition">Switch role</button>
      </div>
    </div>
  );
}

function PatientDashboard({ currentAngle, currentLabel, setPatientStiffness, voicePresets, sendLine }) {
  const compliant = getDefaultQuickPreset(voicePresets, "L", 30);
  const balanced = getDefaultQuickPreset(voicePresets, "M", 90);
  const stiff = getDefaultQuickPreset(voicePresets, "H", 150);
  return (
    <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
      <GlassCard><div className="flex items-start justify-between gap-4"><div><p className="text-cyan-300 font-semibold">Daily stiffness</p><h2 className="text-4xl font-bold mt-2">{currentLabel}</h2><p className="text-slate-400 mt-2">Move toward compliant for comfort. Move toward stiff for support.</p></div><div className="w-16 h-16 rounded-2xl bg-emerald-400/15 text-3xl flex items-center justify-center">🎚️</div></div><div className="my-10"><BigStiffnessVisual angle={currentAngle} /></div><div className="space-y-4"><div className="flex justify-between text-sm text-slate-400"><span>Compliant</span><span>Stiff</span></div><input type="range" min="0" max="180" value={currentAngle} onChange={(e) => setPatientStiffness(Number(e.target.value))} className="w-full accent-cyan-300" /></div></GlassCard>
      <div className="space-y-6"><GlassCard><h3 className="text-xl font-bold mb-4 flex items-center gap-2"><span>⚙️</span> Quick modes</h3><div className="grid gap-3"><QuickButton label="Compliant" sub="Comfort / softer response" onClick={() => setPatientStiffness(compliant)} /><QuickButton label="Balanced" sub="Normal walking" onClick={() => setPatientStiffness(balanced)} /><QuickButton label="Stiff" sub="More support" onClick={() => setPatientStiffness(stiff)} /></div></GlassCard><GlassCard><h3 className="text-xl font-bold mb-4 flex items-center gap-2"><span>🔒</span> Safe controls</h3><div className="grid grid-cols-2 gap-3"><button onClick={() => sendLine("HOME")} className="rounded-2xl p-4 bg-white/10 hover:bg-white/15 border border-white/10">Home</button><button onClick={() => sendLine("STATUS")} className="rounded-2xl p-4 bg-white/10 hover:bg-white/15 border border-white/10">Status</button></div></GlassCard></div>
    </div>
  );
}

function PrescriberDashboard({ currentAngle, setCurrentAngle, voicePresets, activeVoice, activateVoicePreset, updateVoicePreset, addVoicePreset, removeVoicePreset, testVoicePreset, tickAngles, setTickAngles, tickCount, autoGenerateTicks, activeTick, setActiveTick, saveFullConfig, sendLine }) {
  return (
    <div className="grid xl:grid-cols-[1fr_1fr] gap-6">
      <GlassCard><div className="flex items-start justify-between"><div><p className="text-cyan-300 font-semibold">Live actuator command</p><h2 className="text-4xl font-bold mt-2">{currentAngle}°</h2><p className="text-slate-400 mt-2">Exact stiffness angle from 0° to 180°.</p></div><div className="text-4xl">📈</div></div><div className="my-8"><BigStiffnessVisual angle={currentAngle} showDegrees /></div><input type="range" min="0" max="180" value={currentAngle} onChange={(e) => setCurrentAngle(Number(e.target.value))} className="w-full accent-cyan-300" /><div className="grid grid-cols-4 gap-3 mt-5">{[0, 60, 90, 180].map((a) => <button key={a} onClick={() => setCurrentAngle(a)} className="rounded-2xl p-3 bg-white/10 border border-white/10 hover:bg-white/15">{a}°</button>)}</div></GlassCard>
      <GlassCard><div className="flex items-start justify-between gap-4 mb-4"><div><h3 className="text-2xl font-bold flex items-center gap-2"><span>🎙️</span> Voice presets</h3><p className="text-slate-400 mt-2">Add custom spoken commands and assign each one an exact stiffness angle.</p></div><button onClick={addVoicePreset} className="shrink-0 px-4 py-3 rounded-xl bg-cyan-400 text-slate-950 font-bold hover:bg-cyan-300">+ Add</button></div><div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">{voicePresets.map((preset) => <div key={preset.id} className={`rounded-2xl border p-4 ${activeVoice === preset.id ? "bg-cyan-400/15 border-cyan-300" : "bg-slate-900/60 border-white/10"}`}><div className="grid md:grid-cols-[1fr_0.8fr_auto] gap-3 items-center mb-3"><label className="space-y-1"><span className="text-xs text-slate-400">Voice label</span><input value={preset.label} onChange={(e) => updateVoicePreset(preset.id, { label: e.target.value })} className="w-full rounded-xl bg-slate-950/70 border border-white/10 px-3 py-2 text-sm" /></label><label className="space-y-1"><span className="text-xs text-slate-400">Command ID</span><input type="number" value={preset.commandId} onChange={(e) => updateVoicePreset(preset.id, { commandId: Number(e.target.value) })} className="w-full rounded-xl bg-slate-950/70 border border-white/10 px-3 py-2 text-sm" /></label><span className="text-2xl font-black text-right">{preset.angle}°</span></div><input type="range" min="0" max="180" value={preset.angle} onChange={(e) => updateVoicePreset(preset.id, { angle: Number(e.target.value) })} className="w-full accent-cyan-300" /><div className="flex flex-wrap gap-2 mt-3"><button onClick={() => activateVoicePreset(preset.id)} className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 text-sm">Set active</button><button onClick={() => testVoicePreset(preset)} className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 text-sm">Test voice</button><button onClick={() => sendLine(`GOTO ${preset.angle}`)} className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 text-sm">Go angle</button><button onClick={() => removeVoicePreset(preset.id)} className="px-3 py-2 rounded-xl bg-rose-500/15 border border-rose-300/20 hover:bg-rose-500/25 text-sm text-rose-100">Remove</button></div></div>)}</div></GlassCard>
      <GlassCard><h3 className="text-2xl font-bold flex items-center gap-2"><span>⚡</span> IMU gesture ticks</h3><p className="text-slate-400 mt-2 mb-5">These are the step positions the patient cycles through with gestures.</p><div className="flex gap-3 mb-5"><label className="flex-1"><span className="text-sm text-slate-400">Tick count</span><input type="number" min="1" max="12" value={tickCount} onChange={(e) => autoGenerateTicks(Number(e.target.value))} className="mt-1 w-full rounded-xl bg-slate-900 border border-white/10 p-3" /></label><button onClick={saveFullConfig} className="self-end px-5 py-3 rounded-xl bg-cyan-400 text-slate-950 font-bold hover:bg-cyan-300">Save config</button></div><div className="grid sm:grid-cols-2 gap-3">{tickAngles.map((angle, i) => <div key={i} className={`rounded-2xl p-4 border ${activeTick === i ? "bg-cyan-400/15 border-cyan-300" : "bg-slate-900/60 border-white/10"}`}><div className="flex items-center justify-between mb-2"><button onClick={() => { setActiveTick(i); sendLine(`IACT,${i}`); }} className="font-bold">Tick {i + 1}</button><span>{angle}°</span></div><input type="range" min="0" max="180" value={angle} onChange={(e) => { const next = [...tickAngles]; next[i] = Math.round(clamp(e.target.value)); setTickAngles(next); sendLine(`ISET,${i},${next[i]}`); }} className="w-full accent-cyan-300" /></div>)}</div></GlassCard>
      <CompactDiagnostics saveFullConfig={saveFullConfig} sendLine={sendLine} voicePresets={voicePresets} />
    </div>
  );
}

function CompactDiagnostics({ saveFullConfig, sendLine, voicePresets }) {
  return <div className="rounded-3xl bg-white/10 border border-white/10 p-4 shadow-2xl backdrop-blur self-start"><div className="flex items-center justify-between gap-3 mb-3"><div><h3 className="text-lg font-bold flex items-center gap-2"><span>🧪</span> Diagnostics</h3><p className="text-slate-400 text-xs mt-1">Quick device checks.</p></div><button onClick={saveFullConfig} className="px-3 py-2 rounded-xl bg-cyan-400 text-slate-950 text-sm font-bold hover:bg-cyan-300">Save all</button></div><div className="grid grid-cols-3 gap-2"><MiniDiagButton label="Home" onClick={() => sendLine("HOME")} /><MiniDiagButton label="Status" onClick={() => sendLine("STATUS")} /><MiniDiagButton label="Load" onClick={() => sendLine("CFGGET")} /><MiniDiagButton label="Go 90°" onClick={() => sendLine("GOTO 90")} />{voicePresets.slice(0, 2).map((p) => <MiniDiagButton key={p.id} label={`Voice ${p.label}`} onClick={() => sendLine(`VOICE ${p.commandId}`)} />)}</div></div>;
}

function BigStiffnessVisual({ angle, showDegrees = false }) {
  const pct = angleToPercent(angle);
  const needleRotation = clamp(angle) - 90;
  return <div className="relative h-72 rounded-3xl bg-slate-900/70 border border-white/10 overflow-hidden flex items-center justify-center"><div className="absolute inset-0 bg-gradient-to-r from-emerald-400/20 via-cyan-400/10 to-rose-500/20" /><div className="absolute left-0 bottom-0 h-2 bg-cyan-300 rounded-r-full transition-all duration-300" style={{ width: `${Math.max(12, pct)}%` }} /><div className="relative text-center"><div className="mx-auto mb-6 w-36 h-36 rounded-full border-[14px] border-white/10 flex items-center justify-center transition-transform duration-300" style={{ transform: `rotate(${needleRotation}deg)` }}><div className="w-3 h-16 rounded-full bg-cyan-300 -translate-y-6" /></div><div className="text-5xl font-black">{showDegrees ? `${Math.round(clamp(angle))}°` : `${pct}%`}</div><div className="text-slate-400 mt-2">{angleToLabel(angle)}</div></div></div>;
}

function GlassCard({ children }) { return <div className="rounded-3xl bg-white/10 border border-white/10 p-6 shadow-2xl backdrop-blur">{children}</div>; }
function QuickButton({ label, sub, onClick }) { return <button onClick={onClick} className="rounded-2xl p-5 bg-slate-900/60 border border-white/10 hover:bg-white/15 transition text-left"><div className="font-bold text-lg">{label}</div><div className="text-slate-400 text-sm mt-1">{sub}</div></button>; }
function MiniDiagButton({ label, onClick }) { return <button onClick={onClick} className="rounded-xl px-3 py-2 bg-slate-900/60 border border-white/10 hover:bg-white/15 transition text-xs truncate">{label}</button>; }
