/**
 * NodePanel
 * ---------
 * Displays details for the node selected in the GridMap.
 * Shows static properties from the scenario's first timestep,
 * plus cascade simulation results when available.
 *
 * Props:
 *   node          — node object from grid_state.nodes (or null)
 *   scenario      — full scenario detail (used to find connected edges)
 *   cascadeResult — result from POST /api/cascade (or null)
 *   cascadeLoading — true while cascade simulation is in flight
 */
export default function NodePanel({ node, scenario, cascadeResult, cascadeLoading }) {
  if (!node) {
    return (
      <div className="text-xs text-gray-600 pt-2">
        Click a node on the grid to inspect it.
      </div>
    );
  }

  // Find edges that connect to this node, deduplicating bidirectional pairs
  const edges = scenario?.grid_state?.edges ?? [];
  const seen = new Set();
  const connectedEdges = edges.filter((e) => {
    if (e.source !== node.id && e.target !== node.id) return false;
    const key = [Math.min(e.source, e.target), Math.max(e.source, e.target)].join('-');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const stateLabel = node.is_failed
    ? { text: 'FAILED', cls: 'text-red-400 bg-red-950' }
    : node.power_injection_mw > 0
    ? { text: 'Generator', cls: 'text-green-400 bg-green-950' }
    : { text: 'Load', cls: 'text-blue-400 bg-blue-950' };

  return (
    <div className="space-y-4 text-xs">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">
        Node Detail
      </h2>

      {/* Identity */}
      <div className="bg-gray-800 rounded p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Node ID</span>
          <span className="font-mono font-semibold text-white">{node.id}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Status</span>
          <span className={`px-2 py-0.5 rounded font-semibold ${stateLabel.cls}`}>
            {stateLabel.text}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Position (km)</span>
          <span className="font-mono text-gray-300">
            ({node.x.toFixed(1)}, {node.y.toFixed(1)})
          </span>
        </div>
      </div>

      {/* Power at t = 0 */}
      <div className="bg-gray-800 rounded p-3 space-y-2">
        <p className="text-gray-500 font-semibold">Power at t = 0</p>
        <Row
          label="Active injection"
          value={`${node.power_injection_mw.toFixed(2)} MW`}
          colour={node.power_injection_mw >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <Row
          label="Reactive injection"
          value={`${node.reactive_injection_mvar.toFixed(2)} MVAr`}
          colour="text-blue-400"
        />
      </div>

      {/* Grid measurements */}
      {node.voltage_pu !== undefined && (
        <div className="bg-gray-800 rounded p-3 space-y-2">
          <p className="text-gray-500 font-semibold">Grid Measurements</p>
          <Row
            label="Voltage"
            value={`${node.voltage_pu.toFixed(4)} pu`}
            colour={voltageColour(node.voltage_pu)}
          />
          <Row
            label="Voltage angle"
            value={`${(node.voltage_angle_rad * 180 / Math.PI).toFixed(2)}°`}
            colour="text-gray-300"
          />
          <Row
            label="Frequency"
            value={`${node.frequency_hz.toFixed(3)} Hz`}
            colour={frequencyColour(node.frequency_hz)}
          />
          <Row
            label="Equip. temp."
            value={`${node.equipment_temp_c.toFixed(1)} °C`}
            colour={tempColour(node.equipment_temp_c)}
          />
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Equip. condition</span>
            <ConditionBar value={node.equipment_condition} />
          </div>
        </div>
      )}

      {/* Connected lines */}
      <div className="bg-gray-800 rounded p-3 space-y-2">
        <p className="text-gray-500 font-semibold">
          Connected lines ({connectedEdges.length})
        </p>
        <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
          {connectedEdges.map((e) => {
            const ratio =
              e.thermal_limit_mw > 0
                ? Math.abs(e.active_flow_mw) / e.thermal_limit_mw
                : 0;
            const pct = (ratio * 100).toFixed(0);
            const colourCls =
              ratio < 0.5
                ? 'text-green-400'
                : ratio < 0.75
                ? 'text-yellow-400'
                : ratio < 1.0
                ? 'text-orange-400'
                : 'text-red-400';
            const other = e.source === node.id ? e.target : e.source;
            return (
              <div
                key={e.id}
                className="flex items-center justify-between text-gray-400"
              >
                <span>→ Node {other}</span>
                <span className={`font-mono font-semibold ${colourCls}`}>
                  {pct}% loaded
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Cascade simulation results ─────────────────────────────── */}
      <CascadeSection
        node={node}
        cascadeResult={cascadeResult}
        cascadeLoading={cascadeLoading}
      />
    </div>
  );
}

/** Cascade path section — shown below node detail after simulation */
function CascadeSection({ node, cascadeResult, cascadeLoading }) {
  if (cascadeLoading) {
    return (
      <div className="bg-gray-800 rounded p-3">
        <p className="text-orange-400 animate-pulse font-semibold">
          Simulating cascade from node {node.id}…
        </p>
      </div>
    );
  }

  if (!cascadeResult) return null;

  const path = [...(cascadeResult.cascade_path ?? [])].sort((a, b) => a.order - b.order);

  return (
    <div className="bg-gray-800 rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-orange-400 font-semibold">Cascade Path</p>
        <span className="text-gray-500">
          {cascadeResult.total_failures} failure{cascadeResult.total_failures !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
        {path.map((step) => (
          <div
            key={step.order}
            className={`flex items-start gap-2 rounded px-2 py-1 ${
              step.is_trigger ? 'bg-red-950' : 'bg-gray-700'
            }`}
          >
            {/* Order badge */}
            <span
              className={`shrink-0 font-mono font-bold text-xs w-5 text-center ${
                step.is_trigger ? 'text-red-400' : 'text-orange-400'
              }`}
            >
              #{step.order}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">Node {step.node_id}</span>
                <span className="text-gray-400 font-mono text-xs">
                  {step.failure_time_minutes.toFixed(2)} min
                </span>
              </div>
              <p className="text-gray-400 truncate">{step.reason}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, colour }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={`font-mono font-semibold ${colour}`}>{value}</span>
    </div>
  );
}

/** Voltage: normal 0.95–1.05 pu, warning 0.90–0.95 / 1.05–1.10, critical outside */
function voltageColour(pu) {
  if (pu < 0.90 || pu > 1.10) return 'text-red-400';
  if (pu < 0.95 || pu > 1.05) return 'text-yellow-400';
  return 'text-green-400';
}

/** Frequency: normal 59.5–60.5 Hz, warning 59.0–59.5 / 60.5–61.0, critical outside */
function frequencyColour(hz) {
  if (hz < 59.0 || hz > 61.0) return 'text-red-400';
  if (hz < 59.5 || hz > 60.5) return 'text-yellow-400';
  return 'text-green-400';
}

/** Equipment temperature: normal <70 °C, warning 70–85 °C, critical >85 °C */
function tempColour(c) {
  if (c > 85) return 'text-red-400';
  if (c > 70) return 'text-yellow-400';
  return 'text-green-400';
}

/** Horizontal bar showing equipment condition (0–1). */
function ConditionBar({ value }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const colour =
    pct < 40 ? '#ef4444' : pct < 70 ? '#eab308' : '#22c55e';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-gray-700 rounded overflow-hidden">
        <div
          className="h-full rounded"
          style={{ width: `${pct.toFixed(1)}%`, background: colour }}
        />
      </div>
      <span className="font-mono font-semibold text-gray-300">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
