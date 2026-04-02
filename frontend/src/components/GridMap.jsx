import { useMemo, useState, useRef, useCallback } from 'react';

// ─── Colour helpers ───────────────────────────────────────────────────────────

/** Colour a node by its state at t = 0. */
function nodeColour(node) {
  if (node.is_failed) return '#ef4444';          // red-500   — failed
  if (node.power_injection_mw > 0) return '#22c55e'; // green-500 — generator
  return '#3b82f6';                               // blue-500  — load
}

/**
 * Colour an edge by its loading ratio (|flow| / thermal_limit).
 * green → yellow → orange → red
 */
function edgeColour(ratio) {
  if (ratio < 0.5)  return '#22c55e'; // green
  if (ratio < 0.75) return '#eab308'; // yellow
  if (ratio < 1.0)  return '#f97316'; // orange
  return '#ef4444';                   // red — overloaded
}

function edgeOpacity(ratio) {
  // Lightly loaded edges are dimmer so the high-risk ones pop out.
  return Math.max(0.15, Math.min(0.9, 0.2 + ratio * 0.7));
}

/**
 * Colour a cascade node by its failure order.
 * Trigger (order=1) = bright red, later failures fade to yellow.
 */
function cascadeNodeColour(order, totalFailures) {
  if (order === 1) return '#ff2222'; // trigger — vivid red
  const t = totalFailures <= 1 ? 1 : (order - 1) / (totalFailures - 1);
  // Interpolate red → orange → yellow
  const r = 255;
  const g = Math.round(t * 200);
  const b = 0;
  return `rgb(${r},${g},${b})`;
}

// ─── Coordinate normalisation ─────────────────────────────────────────────────

const PAD = 40; // SVG padding in px

function buildScales(nodes, width, height) {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  return {
    sx: (x) => PAD + ((x - minX) / rangeX) * (width - 2 * PAD),
    // Flip Y so geographic north is up
    sy: (y) => height - PAD - ((y - minY) / rangeY) * (height - 2 * PAD),
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * GridMap
 * -------
 * Renders the 118-bus power grid as an SVG.
 *
 * Props:
 *   scenario       — full scenario detail from GET /api/scenario/{id}
 *   selectedNodeId — id of the currently selected node (or null)
 *   onNodeClick    — callback(nodeObj) when a node is clicked
 *   cascadeResult  — result from POST /api/cascade (or null)
 */
export default function GridMap({ scenario, selectedNodeId, onNodeClick, cascadeResult }) {
  const containerRef = useRef(null);

  // ── Pan + zoom state ──────────────────────────────────────────────
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const dragging = useRef(null); // { startX, startY, originTx, originTy }

  // ── Tooltip state ─────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState(null); // { x, y, node }

  // ── SVG dimensions — we use a fixed logical canvas ────────────────
  const W = 900;
  const H = 700;

  const nodes = scenario?.grid_state?.nodes ?? [];
  const edges = scenario?.grid_state?.edges ?? [];

  // Pre-compute scaled positions once per scenario
  const { sx, sy } = useMemo(() => buildScales(nodes, W, H), [nodes, W, H]);

  const nodePos = useMemo(
    () => nodes.map((n) => ({ ...n, px: sx(n.x), py: sy(n.y) })),
    [nodes, sx, sy],
  );

  // Quick lookup: nodeId → position
  const posById = useMemo(() => {
    const m = {};
    nodePos.forEach((n) => { m[n.id] = { px: n.px, py: n.py }; });
    return m;
  }, [nodePos]);

  // ── Cascade map: nodeId → cascade step info ───────────────────────
  const cascadeMap = useMemo(() => {
    if (!cascadeResult?.cascade_path) return {};
    const m = {};
    cascadeResult.cascade_path.forEach((step) => {
      m[step.node_id] = step;
    });
    return m;
  }, [cascadeResult]);

  const totalCascadeFailures = cascadeResult?.cascade_path?.length ?? 0;

  // ── Cascade propagation arrows (lines between consecutive failures) ─
  const cascadeArrows = useMemo(() => {
    if (!cascadeResult?.cascade_path || cascadeResult.cascade_path.length < 2) return [];
    const path = [...cascadeResult.cascade_path].sort((a, b) => a.order - b.order);
    const arrows = [];
    for (let i = 0; i < path.length - 1; i++) {
      const src = posById[path[i].node_id];
      const tgt = posById[path[i + 1].node_id];
      if (src && tgt) {
        arrows.push({ x1: src.px, y1: src.py, x2: tgt.px, y2: tgt.py, order: i + 1 });
      }
    }
    return arrows;
  }, [cascadeResult, posById]);

  // ── Pan handlers ──────────────────────────────────────────────────
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragging.current = {
      startX: e.clientX,
      startY: e.clientY,
      originTx: transform.x,
      originTy: transform.y,
    };
  }, [transform]);

  const onMouseMove = useCallback((e) => {
    if (!dragging.current) return;
    setTransform((t) => ({
      ...t,
      x: dragging.current.originTx + (e.clientX - dragging.current.startX),
      y: dragging.current.originTy + (e.clientY - dragging.current.startY),
    }));
  }, []);

  const onMouseUp = useCallback(() => { dragging.current = null; }, []);

  // ── Zoom on scroll ────────────────────────────────────────────────
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setTransform((t) => {
      const newK = Math.max(0.3, Math.min(10, t.k * factor));
      // Zoom towards the cursor position
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? e.clientX - rect.left : 0;
      const cy = rect ? e.clientY - rect.top : 0;
      return {
        k: newK,
        x: cx - (cx - t.x) * (newK / t.k),
        y: cy - (cy - t.y) * (newK / t.k),
      };
    });
  }, []);

  // Attach non-passive wheel listener
  const svgRef = useCallback((el) => {
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ── Node click ────────────────────────────────────────────────────
  function handleNodeClick(e, node) {
    e.stopPropagation();
    onNodeClick(node);
  }

  // ── Tooltip ───────────────────────────────────────────────────────
  function showTooltip(e, node) {
    const rect = containerRef.current?.getBoundingClientRect();
    setTooltip({
      x: e.clientX - (rect?.left ?? 0) + 12,
      y: e.clientY - (rect?.top ?? 0) - 8,
      node,
      cascadeStep: cascadeMap[node.id] ?? null,
    });
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative cursor-grab active:cursor-grabbing select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        <defs>
          {/* Arrowhead marker for cascade propagation lines */}
          <marker
            id="cascade-arrow"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L0,6 L6,3 z" fill="#ff6600" opacity="0.85" />
          </marker>
        </defs>

        {/* Apply pan + zoom transform to the whole graph group */}
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>

          {/* ── Edges ─────────────────────────────────────────────── */}
          {edges.map((edge) => {
            const src = posById[edge.source];
            const tgt = posById[edge.target];
            if (!src || !tgt) return null;
            const ratio =
              edge.thermal_limit_mw > 0
                ? Math.abs(edge.active_flow_mw) / edge.thermal_limit_mw
                : 0;
            return (
              <line
                key={edge.id}
                x1={src.px} y1={src.py}
                x2={tgt.px} y2={tgt.py}
                stroke={edgeColour(ratio)}
                strokeWidth={0.8 + ratio * 1.2}
                strokeOpacity={edgeOpacity(ratio)}
              />
            );
          })}

          {/* ── Cascade propagation arrows ─────────────────────────── */}
          {cascadeArrows.map((arrow, i) => (
            <line
              key={`cascade-arrow-${i}`}
              x1={arrow.x1} y1={arrow.y1}
              x2={arrow.x2} y2={arrow.y2}
              stroke="#ff6600"
              strokeWidth={1.5}
              strokeOpacity={0.75}
              strokeDasharray="4 3"
              markerEnd="url(#cascade-arrow)"
            />
          ))}

          {/* ── Nodes ─────────────────────────────────────────────── */}
          {nodePos.map((node) => {
            const isSelected = node.id === selectedNodeId;
            const cascadeStep = cascadeMap[node.id];
            const inCascade = !!cascadeStep;
            const colour = inCascade
              ? cascadeNodeColour(cascadeStep.order, totalCascadeFailures)
              : nodeColour(node);

            return (
              <g
                key={node.id}
                transform={`translate(${node.px},${node.py})`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => handleNodeClick(e, node)}
                onMouseEnter={(e) => showTooltip(e, node)}
                onMouseLeave={() => setTooltip(null)}
              >
                {/* Cascade glow ring */}
                {inCascade && (
                  <circle
                    r={cascadeStep.is_trigger ? 13 : 10}
                    fill="none"
                    stroke={colour}
                    strokeWidth={cascadeStep.is_trigger ? 2.5 : 1.5}
                    strokeOpacity={0.6}
                  />
                )}
                {/* Selection ring */}
                {isSelected && (
                  <circle r={9} fill="none" stroke="#facc15" strokeWidth={2} />
                )}
                {/* Node circle */}
                <circle
                  r={inCascade ? 6 : 5}
                  fill={colour}
                  stroke={isSelected ? '#facc15' : inCascade ? '#111827' : '#111827'}
                  strokeWidth={isSelected ? 1.5 : inCascade ? 1.0 : 0.8}
                  fillOpacity={node.is_failed ? 0.7 : 1}
                />
                {/* Cascade order badge */}
                {inCascade && (
                  <text
                    dy="-8"
                    textAnchor="middle"
                    fontSize={4}
                    fontWeight="bold"
                    fill={colour}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    #{cascadeStep.order}
                  </text>
                )}
                {/* Node id label (only visible when zoomed in) */}
                <text
                  dy="0.35em"
                  textAnchor="middle"
                  fontSize={3.5}
                  fill="#f9fafb"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {node.id}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* ── Tooltip ─────────────────────────────────────────────────── */}
      {tooltip && (
        <div
          className="absolute z-10 pointer-events-none bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl min-w-[170px]"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2 pb-1 border-b border-gray-700">
            <span className="font-bold text-white">Node {tooltip.node.id}</span>
            <span className={
              tooltip.node.is_failed ? 'text-red-400' :
              tooltip.node.power_injection_mw > 0 ? 'text-green-400' : 'text-blue-400'
            }>
              {tooltip.node.is_failed ? 'Failed' :
               tooltip.node.power_injection_mw > 0 ? 'Generator' : 'Load'}
            </span>
          </div>

          {/* Cascade info (if part of a simulated cascade) */}
          {tooltip.cascadeStep && (
            <div className="mb-2 pb-1 border-b border-gray-700">
              <p className="text-orange-400 font-semibold mb-0.5">
                {tooltip.cascadeStep.is_trigger ? '💥 Trigger' : `⚡ Failure #${tooltip.cascadeStep.order}`}
              </p>
              <TRow label="Time" value={`${tooltip.cascadeStep.failure_time_minutes.toFixed(2)} min`} />
              <TRow label="Reason" value={tooltip.cascadeStep.reason} />
            </div>
          )}

          {/* Power */}
          <div className="mb-2 space-y-0.5">
            <TRow
              label="P"
              value={`${tooltip.node.power_injection_mw.toFixed(1)} MW`}
              colour={tooltip.node.power_injection_mw >= 0 ? 'text-green-400' : 'text-red-400'}
            />
            <TRow
              label="Q"
              value={`${tooltip.node.reactive_injection_mvar.toFixed(1)} MVAr`}
              colour="text-blue-400"
            />
          </div>

          {/* Ground truth measurements */}
          {tooltip.node.voltage_pu !== undefined && (
            <div className="space-y-0.5 pt-1 border-t border-gray-700">
              <TRow
                label="Voltage"
                value={`${tooltip.node.voltage_pu.toFixed(4)} pu`}
                colour={tooltipVoltageColour(tooltip.node.voltage_pu)}
              />
              <TRow
                label="Angle"
                value={`${(tooltip.node.voltage_angle_rad * 180 / Math.PI).toFixed(2)}°`}
              />
              <TRow
                label="Frequency"
                value={`${tooltip.node.frequency_hz.toFixed(3)} Hz`}
                colour={tooltipFreqColour(tooltip.node.frequency_hz)}
              />
              <TRow
                label="Temp"
                value={`${tooltip.node.equipment_temp_c.toFixed(1)} °C`}
                colour={tooltipTempColour(tooltip.node.equipment_temp_c)}
              />
              <TRow
                label="Condition"
                value={`${(tooltip.node.equipment_condition * 100).toFixed(0)}%`}
                colour={tooltipCondColour(tooltip.node.equipment_condition)}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Legend ──────────────────────────────────────────────────── */}
      <div className="absolute bottom-4 right-4 bg-gray-900 bg-opacity-90 rounded p-3 text-xs space-y-1 border border-gray-700">
        <p className="text-gray-400 font-semibold mb-1">Nodes</p>
        <LegendDot colour="#22c55e" label="Generator" />
        <LegendDot colour="#3b82f6" label="Load" />
        <LegendDot colour="#ef4444" label="Failed" />
        {totalCascadeFailures > 0 && (
          <>
            <p className="text-gray-400 font-semibold mt-2 mb-1">Cascade</p>
            <LegendDot colour="#ff2222" label="Trigger node" />
            <LegendDot colour="#ff8800" label="Cascade failure" />
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-5 h-0"
                style={{
                  borderTop: '2px dashed #ff6600',
                  opacity: 0.85,
                }}
              />
              <span className="text-gray-300">Propagation path</span>
            </div>
          </>
        )}
        <p className="text-gray-400 font-semibold mt-2 mb-1">Line loading</p>
        <LegendLine colour="#22c55e" label="< 50 %" />
        <LegendLine colour="#eab308" label="50 – 75 %" />
        <LegendLine colour="#f97316" label="75 – 100 %" />
        <LegendLine colour="#ef4444" label="> 100 % (overload)" />
        <p className="text-gray-600 mt-2">Click node to simulate cascade</p>
        <p className="text-gray-600">Scroll to zoom · drag to pan</p>
      </div>
    </div>
  );
}

function LegendDot({ colour, label }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block w-3 h-3 rounded-full"
        style={{ background: colour }}
      />
      <span className="text-gray-300">{label}</span>
    </div>
  );
}

function LegendLine({ colour, label }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block w-5 h-0.5 rounded"
        style={{ background: colour }}
      />
      <span className="text-gray-300">{label}</span>
    </div>
  );
}

// ─── Tooltip sub-components & colour helpers ──────────────────────────────────

function TRow({ label, value, colour = 'text-gray-300' }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${colour}`}>{value}</span>
    </div>
  );
}

function tooltipVoltageColour(pu) {
  if (pu < 0.90 || pu > 1.10) return 'text-red-400';
  if (pu < 0.95 || pu > 1.05) return 'text-yellow-400';
  return 'text-green-400';
}

function tooltipFreqColour(hz) {
  if (hz < 59.0 || hz > 61.0) return 'text-red-400';
  if (hz < 59.5 || hz > 60.5) return 'text-yellow-400';
  return 'text-green-400';
}

function tooltipTempColour(c) {
  if (c > 85) return 'text-red-400';
  if (c > 70) return 'text-yellow-400';
  return 'text-green-400';
}

function tooltipCondColour(v) {
  if (v < 0.40) return 'text-red-400';
  if (v < 0.70) return 'text-yellow-400';
  return 'text-green-400';
}
