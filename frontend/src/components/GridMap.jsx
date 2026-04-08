import { useMemo, useState, useRef, useCallback, useEffect } from 'react';

// ─── Colour helpers ───────────────────────────────────────────────────────────

/**
 * Load stress colour — blue gradient from pale (low) to deep navy (high).
 * stress: 0 → #dbeafe (blue-100)
 * stress: 1 → #1e3a8a (blue-900)
 */
function loadColour(stress) {
  const t = Math.max(0, Math.min(1, stress));
  const r = Math.round(219 - t * (219 - 30));
  const g = Math.round(234 - t * (234 - 58));
  const b = Math.round(254 - t * (254 - 138));
  return `rgb(${r},${g},${b})`;
}

function nodeColour(node, loadStress = 0) {
  if (node.is_failed) return '#ef4444';
  if (node.power_injection_mw > 0) return '#22c55e';
  return loadColour(loadStress);
}

function edgeColour(ratio) {
  if (ratio < 0.5)  return '#22c55e';
  if (ratio < 0.75) return '#eab308';
  if (ratio < 1.0)  return '#f97316';
  return '#ef4444';
}

function edgeOpacity(ratio) {
  return Math.max(0.15, Math.min(0.9, 0.2 + ratio * 0.7));
}

function cascadeNodeColour(order, totalFailures) {
  if (order === 1) return '#ff2222';
  const t = totalFailures <= 1 ? 1 : (order - 1) / (totalFailures - 1);
  return `rgb(255,${Math.round(t * 200)},0)`;
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

const PAD = 40;

function buildScales(nodes, width, height) {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  return {
    sx: (x) => PAD + ((x - minX) / rangeX) * (width - 2 * PAD),
    sy: (y) => height - PAD - ((y - minY) / rangeY) * (height - 2 * PAD),
  };
}

// ─── Animation speed options (ms per frame) ───────────────────────────────────
const SPEEDS = [
  { label: '0.5×', ms: 1200 },
  { label: '1×',   ms: 600  },
  { label: '2×',   ms: 300  },
  { label: '4×',   ms: 150  },
];

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * GridMap
 *
 * Normal mode props:
 *   scenario, selectedNodeId, onNodeClick, cascadeResult
 *
 * Compare mode extra props:
 *   compareMode   — boolean
 *   compareData   — full /api/compare response
 *   currentFrame  — controlled frame index (from App)
 *   onFrameChange — (idx) => void
 */
export default function GridMap({
  scenario,
  selectedNodeId,
  onNodeClick,
  cascadeResult,
  // Normal-mode timeline
  normalFrame = 0,
  onNormalFrameChange,
  totalNormalFrames = 0,
  // Compare-mode props
  compareMode = false,
  compareData = null,
  currentFrame = 0,
  onFrameChange,
}) {
  const containerRef = useRef(null);

  // ── Pan + zoom ─────────────────────────────────────────────────────
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const dragging = useRef(null);
  // Mirror transform in a ref so onMouseMove can read k without re-creating.
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  useEffect(() => { transformRef.current = transform; }, [transform]);

  // ── Node drag ──────────────────────────────────────────────────────
  // nodeOffsets: {[nodeId]: {dx, dy}} — accumulated drag in SVG coordinates.
  const [nodeOffsets, setNodeOffsets] = useState({});
  const draggingNode  = useRef(null);  // {nodeId, startX, startY, origDx, origDy}
  const nodeDragMoved = useRef(false); // true once pointer moves > 2px — suppresses click

  // Reset offsets whenever the scenario changes.
  useEffect(() => { setNodeOffsets({}); }, [scenario?.id]);

  // ── Tooltip ────────────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState(null);

  // ── Animation state ────────────────────────────────────────────────
  const [playing, setPlaying]     = useState(false);
  const [speedIdx, setSpeedIdx]   = useState(1);   // index into SPEEDS
  const intervalRef               = useRef(null);

  const W = 900, H = 700;

  // ── Nodes / edges from the current frame ──────────────────────────
  const nodes = scenario?.grid_state?.nodes ?? [];
  const edges = scenario?.grid_state?.edges ?? [];

  // Scale positions — recomputed only when base topology changes.
  // We derive positions from t=0 nodes which always have x,y.
  const baseNodes = useMemo(() => {
    // In compare mode, base topology is always compareData.timesteps[0].nodes
    // In normal mode it's scenario.grid_state.nodes
    return compareMode && compareData
      ? compareData.timesteps[0].nodes
      : nodes;
  }, [compareMode, compareData, nodes]);

  const { sx, sy } = useMemo(() => buildScales(baseNodes, W, H), [baseNodes]);

  const nodePos = useMemo(
    () => nodes.map((n) => ({ ...n, px: sx(n.x), py: sy(n.y) })),
    [nodes, sx, sy],
  );

  const posById = useMemo(() => {
    const m = {};
    nodePos.forEach((n) => {
      const off = nodeOffsets[n.id] ?? { dx: 0, dy: 0 };
      m[n.id] = { px: n.px + off.dx, py: n.py + off.dy };
    });
    return m;
  }, [nodePos, nodeOffsets]);

  // ── Load stress map: nodeId → stress ratio (0–1) ──────────────────
  // Only load nodes (power_injection_mw ≤ 0) get a stress value.
  // Normalised by the maximum absolute load seen across all load nodes
  // in the current frame so the colour scale is always relative.
  const loadStressMap = useMemo(() => {
    const loads = nodes.filter((n) => n.power_injection_mw <= 0);
    const maxLoad = loads.reduce((mx, n) => Math.max(mx, Math.abs(n.power_injection_mw)), 1e-6);
    const m = {};
    loads.forEach((n) => { m[n.id] = Math.abs(n.power_injection_mw) / maxLoad; });
    return m;
  }, [nodes]);

  // ── Cascade (click-to-fail) overlay ───────────────────────────────
  const cascadeMap = useMemo(() => {
    if (!cascadeResult?.cascade_path) return {};
    const m = {};
    cascadeResult.cascade_path.forEach((s) => { m[s.node_id] = s; });
    return m;
  }, [cascadeResult]);

  const totalCascadeFailures = cascadeResult?.cascade_path?.length ?? 0;

  const cascadeArrows = useMemo(() => {
    if (!cascadeResult?.cascade_path || cascadeResult.cascade_path.length < 2) return [];
    const path = [...cascadeResult.cascade_path].sort((a, b) => a.order - b.order);
    const arrows = [];
    for (let i = 0; i < path.length - 1; i++) {
      const src = posById[path[i].node_id];
      const tgt = posById[path[i + 1].node_id];
      if (src && tgt) arrows.push({ x1: src.px, y1: src.py, x2: tgt.px, y2: tgt.py });
    }
    return arrows;
  }, [cascadeResult, posById]);

  // ── Compare-mode overlay data ─────────────────────────────────────
  // Predicted node ids
  const predictedNodeIds = useMemo(() => {
    if (!compareData) return new Set();
    return new Set(compareData.predicted_cascade_path.map((s) => s.node_id));
  }, [compareData]);

  // Ground truth: set of node ids that have actually failed by currentFrame
  // failure_timestep is in timestep units — compare directly with currentFrame
  const revealedGtNodeIds = useMemo(() => {
    if (!compareData || !compareMode) return new Set();
    return new Set(
      compareData.ground_truth_cascade_path
        .filter((s) => s.failure_timestep <= currentFrame)
        .map((s) => s.node_id),
    );
  }, [compareData, compareMode, currentFrame]);

  const gtNodeIds = useMemo(() => {
    if (!compareData) return new Set();
    return new Set(compareData.ground_truth_cascade_path.map((s) => s.node_id));
  }, [compareData]);

  // ── Failed node set — used to grey out connected edges ────────────
  // Union of: scenario is_failed flags, cascade click-to-fail nodes,
  // and ground-truth failures revealed so far in compare animation.
  const failedNodeIds = useMemo(() => {
    const ids = new Set();
    nodes.forEach((n) => { if (n.is_failed) ids.add(n.id); });
    Object.keys(cascadeMap).forEach((id) => ids.add(Number(id)));
    revealedGtNodeIds.forEach((id) => ids.add(id));
    return ids;
  }, [nodes, cascadeMap, revealedGtNodeIds]);

  // ── Animation controls ────────────────────────────────────────────
  const totalFrames = compareData?.total_timesteps ?? 0;

  const stopAnimation = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setPlaying(false);
  }, []);

  const startAnimation = useCallback(() => {
    if (!compareMode || !compareData) return;
    stopAnimation();
    intervalRef.current = setInterval(() => {
      onFrameChange((prev) => {
        const next = prev + 1;
        if (next >= totalFrames) {
          stopAnimation();
          return totalFrames - 1;
        }
        return next;
      });
    }, SPEEDS[speedIdx].ms);
    setPlaying(true);
  }, [compareMode, compareData, speedIdx, totalFrames, stopAnimation, onFrameChange]);

  function togglePlay() {
    if (playing) stopAnimation();
    else startAnimation();
  }

  function stepFrame(delta) {
    stopAnimation();
    onFrameChange((prev) => Math.max(0, Math.min(totalFrames - 1, prev + delta)));
  }

  // Restart animation when speed changes while playing
  useEffect(() => {
    if (playing) startAnimation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speedIdx]);

  // Stop animation on unmount or mode exit
  useEffect(() => {
    if (!compareMode) stopAnimation();
    return () => stopAnimation();
  }, [compareMode, stopAnimation]);

  // ── Pan handlers ──────────────────────────────────────────────────
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragging.current = { startX: e.clientX, startY: e.clientY, originTx: transform.x, originTy: transform.y };
  }, [transform]);

  const onMouseMove = useCallback((e) => {
    // Node drag takes priority over canvas pan.
    if (draggingNode.current) {
      const { nodeId, startX, startY, origDx, origDy } = draggingNode.current;
      const k = transformRef.current.k;
      const dx = (e.clientX - startX) / k;
      const dy = (e.clientY - startY) / k;
      // Mark as a real drag once the pointer moves more than 2 SVG units.
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) nodeDragMoved.current = true;
      setNodeOffsets((prev) => ({
        ...prev,
        [nodeId]: { dx: origDx + dx, dy: origDy + dy },
      }));
      return;
    }
    if (!dragging.current) return;
    // Capture values immediately — the ref may be nulled by onMouseUp before
    // React's state updater function actually runs (race condition).
    const { originTx, originTy, startX, startY } = dragging.current;
    setTransform((t) => ({
      ...t,
      x: originTx + (e.clientX - startX),
      y: originTy + (e.clientY - startY),
    }));
  }, []);

  const onMouseUp = useCallback(() => {
    draggingNode.current = null;
    dragging.current = null;
  }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setTransform((t) => {
      const newK = Math.max(0.3, Math.min(10, t.k * factor));
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? e.clientX - rect.left : 0;
      const cy = rect ? e.clientY - rect.top : 0;
      return { k: newK, x: cx - (cx - t.x) * (newK / t.k), y: cy - (cy - t.y) * (newK / t.k) };
    });
  }, []);

  const svgRef = useCallback((el) => {
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  function handleNodeMouseDown(e, node) {
    if (e.button !== 0) return;
    e.stopPropagation(); // prevent canvas pan while dragging a node
    nodeDragMoved.current = false;
    const off = nodeOffsets[node.id] ?? { dx: 0, dy: 0 };
    draggingNode.current = {
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      origDx: off.dx,
      origDy: off.dy,
    };
  }

  function handleNodeClick(e, node) {
    e.stopPropagation();
    // Suppress click if the node was dragged rather than tapped.
    if (nodeDragMoved.current) return;
    onNodeClick(node);
  }

  function showTooltip(e, node) {
    const rect = containerRef.current?.getBoundingClientRect();
    setTooltip({
      x: e.clientX - (rect?.left ?? 0) + 12,
      y: e.clientY - (rect?.top ?? 0) - 8,
      node,
      cascadeStep: cascadeMap[node.id] ?? null,
    });
  }

  // ── Node colour in compare mode ───────────────────────────────────
  function compareNodeColour(nodeId) {
    const isRevealed = revealedGtNodeIds.has(nodeId);
    const isPredicted = predictedNodeIds.has(nodeId);
    const isTP = compareData?.metrics?.true_positives?.includes(nodeId);
    const isFP = compareData?.metrics?.false_positives?.includes(nodeId);

    if (isRevealed && currentFrame >= (compareData?.end_idx ?? 0)) {
      // After truncation: ground truth failures are red
      return '#ef4444';
    }
    if (isPredicted && currentFrame >= (compareData?.end_idx ?? 0)) {
      if (isTP)  return '#06b6d4'; // correctly predicted — teal
      if (isFP)  return '#9ca3af'; // false alarm — grey
    }
    return null; // use default colour
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="w-full h-full flex flex-col">

      {/* ── SVG canvas ──────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 relative cursor-grab active:cursor-grabbing select-none overflow-hidden"
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
            <marker id="cascade-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="#ff6600" opacity="0.85" />
            </marker>
          </defs>

          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>

            {/* Edges */}
            {edges.map((edge) => {
              const src = posById[edge.source];
              const tgt = posById[edge.target];
              if (!src || !tgt) return null;

              const isDead = failedNodeIds.has(edge.source) || failedNodeIds.has(edge.target);

              if (isDead) {
                return (
                  <line key={edge.id}
                    x1={src.px} y1={src.py} x2={tgt.px} y2={tgt.py}
                    stroke="#4b5563"
                    strokeWidth={0.7}
                    strokeOpacity={0.5}
                    strokeDasharray="3 3"
                  />
                );
              }

              const ratio = edge.thermal_limit_mw > 0
                ? Math.abs(edge.active_flow_mw) / edge.thermal_limit_mw : 0;
              return (
                <line key={edge.id}
                  x1={src.px} y1={src.py} x2={tgt.px} y2={tgt.py}
                  stroke={edgeColour(ratio)} strokeWidth={0.8 + ratio * 1.2}
                  strokeOpacity={edgeOpacity(ratio)}
                />
              );
            })}

            {/* Cascade click-to-fail arrows */}
            {cascadeArrows.map((a, i) => (
              <line key={`ca-${i}`}
                x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}
                stroke="#ff6600" strokeWidth={1.5} strokeOpacity={0.75}
                strokeDasharray="4 3" markerEnd="url(#cascade-arrow)"
              />
            ))}

            {/* Compare mode: predicted path arrows (before end_idx revealed) */}
            {compareMode && compareData && currentFrame >= (compareData.end_idx ?? 0) &&
              compareData.predicted_cascade_path.length >= 2 &&
              [...compareData.predicted_cascade_path]
                .sort((a, b) => a.order - b.order)
                .slice(0, -1)
                .map((step, i) => {
                  const next = compareData.predicted_cascade_path[i + 1];
                  if (!next) return null;
                  const src = posById[step.node_id];
                  const tgt = posById[next.node_id];
                  if (!src || !tgt) return null;
                  return (
                    <line key={`pa-${i}`}
                      x1={src.px} y1={src.py} x2={tgt.px} y2={tgt.py}
                      stroke="#a855f7" strokeWidth={1.2} strokeOpacity={0.6}
                      strokeDasharray="3 3"
                    />
                  );
                })
            }

            {/* Nodes */}
            {nodePos.map((node) => {
              const isSelected = node.id === selectedNodeId;

              // ── Compare mode colouring ────────────────────────────
              const overrideColour = compareMode ? compareNodeColour(node.id) : null;
              const isPredicted    = compareMode && predictedNodeIds.has(node.id) && currentFrame >= (compareData?.end_idx ?? 0);
              const isRevealed     = compareMode && revealedGtNodeIds.has(node.id);
              const showPurpleRing = isPredicted && !isRevealed;

              // ── Cascade click-to-fail colouring ───────────────────
              const cascadeStep = cascadeMap[node.id];
              const inCascade   = !compareMode && !!cascadeStep;

              const colour = overrideColour ?? (inCascade
                ? cascadeNodeColour(cascadeStep.order, totalCascadeFailures)
                : nodeColour(node, loadStressMap[node.id] ?? 0));

              const off = nodeOffsets[node.id] ?? { dx: 0, dy: 0 };

              return (
                <g key={node.id}
                  transform={`translate(${node.px + off.dx},${node.py + off.dy})`}
                  style={{ cursor: compareMode ? 'default' : 'grab' }}
                  onMouseDown={(e) => !compareMode && handleNodeMouseDown(e, node)}
                  onClick={(e) => !compareMode && handleNodeClick(e, node)}
                  onMouseEnter={(e) => showTooltip(e, node)}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {/* Rings */}
                  {showPurpleRing && (
                    <circle r={11} fill="none" stroke="#a855f7" strokeWidth={2} strokeOpacity={0.8} />
                  )}
                  {inCascade && (
                    <circle r={cascadeStep.is_trigger ? 13 : 10} fill="none"
                      stroke={colour} strokeWidth={cascadeStep.is_trigger ? 2.5 : 1.5} strokeOpacity={0.6} />
                  )}
                  {isSelected && (
                    <circle r={9} fill="none" stroke="#facc15" strokeWidth={2} />
                  )}

                  {/* Node body */}
                  <circle r={inCascade || isPredicted || isRevealed ? 6 : 5}
                    fill={colour}
                    stroke="#111827" strokeWidth={0.8}
                    fillOpacity={node.is_failed ? 0.7 : 1}
                  />

                  {/* Cascade order badge */}
                  {inCascade && (
                    <text dy="-8" textAnchor="middle" fontSize={4} fontWeight="bold"
                      fill={colour} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      #{cascadeStep.order}
                    </text>
                  )}

                  {/* Node id */}
                  <text dy="0.35em" textAnchor="middle" fontSize={3.5} fill="#f9fafb"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {node.id}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div className="absolute z-10 pointer-events-none bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl min-w-[170px]"
            style={{ left: tooltip.x, top: tooltip.y }}>
            <div className="flex items-center justify-between mb-2 pb-1 border-b border-gray-700">
              <span className="font-bold text-white">Node {tooltip.node.id}</span>
              <span className={
                tooltip.node.is_failed ? 'text-red-400' :
                tooltip.node.power_injection_mw > 0 ? 'text-green-400' : 'text-blue-400'
              }>
                {tooltip.node.is_failed ? 'Failed' :
                 tooltip.node.power_injection_mw > 0 ? 'Generator' :
                 `Load ${Math.round((loadStressMap[tooltip.node.id] ?? 0) * 100)}%`}
              </span>
            </div>
            {tooltip.cascadeStep && (
              <div className="mb-2 pb-1 border-b border-gray-700">
                <p className="text-orange-400 font-semibold mb-0.5">
                  {tooltip.cascadeStep.is_trigger ? '💥 Trigger' : `⚡ Failure #${tooltip.cascadeStep.order}`}
                </p>
                <TRow label="Time" value={`${tooltip.cascadeStep.failure_time_minutes.toFixed(2)} min`} />
                <TRow label="Reason" value={tooltip.cascadeStep.reason} />
              </div>
            )}
            {compareMode && compareData && (
              <div className="mb-2 pb-1 border-b border-gray-700 space-y-0.5">
                {predictedNodeIds.has(tooltip.node.id) && (
                  <p className="text-purple-400 font-semibold">⬡ Predicted failure</p>
                )}
                {revealedGtNodeIds.has(tooltip.node.id) && (
                  <p className="text-red-400 font-semibold">⚡ Actual failure</p>
                )}
                {compareData.metrics.true_positives.includes(tooltip.node.id) && (
                  <p className="text-cyan-400">✓ Correct prediction</p>
                )}
                {compareData.metrics.false_positives.includes(tooltip.node.id) && (
                  <p className="text-gray-400">False alarm</p>
                )}
                {compareData.metrics.false_negatives.includes(tooltip.node.id) && (
                  <p className="text-orange-400">⚠ Missed by model</p>
                )}
              </div>
            )}
            <div className="mb-2 space-y-0.5">
              <TRow label="P" value={`${tooltip.node.power_injection_mw.toFixed(1)} MW`}
                colour={tooltip.node.power_injection_mw >= 0 ? 'text-green-400' : 'text-red-400'} />
              <TRow label="Q" value={`${tooltip.node.reactive_injection_mvar.toFixed(1)} MVAr`} colour="text-blue-400" />
            </div>
            {tooltip.node.voltage_pu !== undefined && (
              <div className="space-y-0.5 pt-1 border-t border-gray-700">
                <TRow label="Voltage" value={`${tooltip.node.voltage_pu.toFixed(4)} pu`} colour={tooltipVoltageColour(tooltip.node.voltage_pu)} />
                <TRow label="Angle"   value={`${(tooltip.node.voltage_angle_rad * 180 / Math.PI).toFixed(2)}°`} />
                <TRow label="Freq"    value={`${tooltip.node.frequency_hz.toFixed(3)} Hz`} colour={tooltipFreqColour(tooltip.node.frequency_hz)} />
                <TRow label="Temp"    value={`${tooltip.node.equipment_temp_c.toFixed(1)} °C`} colour={tooltipTempColour(tooltip.node.equipment_temp_c)} />
                <TRow label="Cond"    value={`${(tooltip.node.equipment_condition * 100).toFixed(0)}%`} colour={tooltipCondColour(tooltip.node.equipment_condition)} />
              </div>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 right-4 bg-gray-900 bg-opacity-90 rounded p-3 text-xs space-y-1 border border-gray-700">
          <p className="text-gray-400 font-semibold mb-1">Nodes</p>
          <LegendDot colour="#22c55e" label="Generator" />
          <LegendLoadGradient />
          <LegendDot colour="#ef4444" label="Failed" />
          {compareMode && compareData && (
            <>
              <p className="text-gray-400 font-semibold mt-2 mb-1">Prediction</p>
              <LegendDot colour="#06b6d4" label="Correctly predicted" />
              <LegendDot colour="#ef4444" label="Actual failure" />
              <LegendDot colour="#9ca3af" label="False alarm" />
            </>
          )}
          {!compareMode && totalCascadeFailures > 0 && (
            <>
              <p className="text-gray-400 font-semibold mt-2 mb-1">Cascade</p>
              <LegendDot colour="#ff2222" label="Trigger node" />
              <LegendDot colour="#ff8800" label="Cascade failure" />
            </>
          )}
          <p className="text-gray-400 font-semibold mt-2 mb-1">Line loading</p>
          <LegendLine colour="#22c55e" label="< 50 %" />
          <LegendLine colour="#eab308" label="50 – 75 %" />
          <LegendLine colour="#f97316" label="75 – 100 %" />
          <LegendLine colour="#ef4444" label="> 100 %" />
          <LegendLineDashed colour="#4b5563" label="Disconnected" />
          {!compareMode && <p className="text-gray-600 mt-2">Click node to simulate cascade</p>}
          <p className="text-gray-600">Scroll to zoom · drag to pan</p>
        </div>
      </div>

      {/* ── Normal-mode timeline ────────────────────────────────────── */}
      {!compareMode && totalNormalFrames > 1 && (
        <div className="shrink-0 bg-gray-900 border-t border-gray-800 px-4 py-3 space-y-2">
          {/* Scrubber */}
          <NormalTimelineBar
            total={totalNormalFrames}
            current={normalFrame}
            cascadeStart={scenario?.metadata?.cascade_start_time ?? -1}
            onChange={onNormalFrameChange}
          />
          {/* Step buttons + frame counter + hint */}
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <button
              onClick={() => onNormalFrameChange(Math.max(0, normalFrame - 1))}
              disabled={normalFrame === 0}
              className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous timestep"
            >
              ‹
            </button>
            <button
              onClick={() => onNormalFrameChange(Math.min(totalNormalFrames - 1, normalFrame + 1))}
              disabled={normalFrame === totalNormalFrames - 1}
              className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next timestep"
            >
              ›
            </button>
            <span className="font-mono">t = {normalFrame + 1} / {totalNormalFrames}</span>
            <span className="ml-auto text-gray-600">Click a node to simulate cascade from this timestep</span>
          </div>
        </div>
      )}

      {/* ── Timeline + controls (compare mode only) ─────────────────── */}
      {compareMode && compareData && (
        <div className="shrink-0 bg-gray-900 border-t border-gray-800 px-4 py-3 space-y-2">

          {/* Timeline bar */}
          <TimelineBar
            total={totalFrames}
            current={currentFrame}
            cascadeStart={compareData.cascade_start_time}
            onChange={(f) => { stopAnimation(); onFrameChange(f); }}
          />

          {/* Player controls */}
          <div className="flex items-center gap-3">
            <button onClick={() => stepFrame(-1)}
              className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm">
              ‹
            </button>
            <button onClick={togglePlay}
              className="w-8 h-8 flex items-center justify-center rounded bg-blue-700 hover:bg-blue-600 text-white font-bold">
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => stepFrame(1)}
              className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm">
              ›
            </button>

            {/* Frame counter */}
            <span className="text-xs text-gray-400 font-mono">
              t = {currentFrame + 1} / {totalFrames}
            </span>

            {/* Predicted-ahead badge */}
            {compareData.cascade_detected && compareData.cascade_start_time >= 0 && (() => {
              const stepsAhead = compareData.cascade_start_time - compareData.end_idx;
              if (stepsAhead <= 0) return null;
              return (
                <span className="px-2 py-0.5 rounded bg-cyan-900 text-cyan-300 text-xs font-semibold">
                  ⚡ Predicted {stepsAhead} step{stepsAhead !== 1 ? 's' : ''} in advance
                </span>
              );
            })()}

            {/* Speed selector */}
            <div className="ml-auto flex items-center gap-1">
              {SPEEDS.map((s, i) => (
                <button key={s.label} onClick={() => setSpeedIdx(i)}
                  className={`px-2 py-0.5 rounded text-xs ${
                    speedIdx === i
                      ? 'bg-blue-700 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Timeline bar ─────────────────────────────────────────────────────────────

function TimelineBar({ total, current, cascadeStart, onChange }) {
  const pct = (i) => `${(i / total) * 100}%`;

  function handleClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onChange(Math.round(ratio * (total - 1)));
  }

  return (
    <div className="relative h-5 cursor-pointer" onClick={handleClick}>
      {/* Background track */}
      <div className="absolute inset-y-0 left-0 right-0 rounded bg-gray-700" />

      {/* Cascade start marker — only landmark an investor cares about */}
      {cascadeStart >= 0 && (
        <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-80"
          style={{ left: pct(cascadeStart) }} title={`Cascade begins at t=${cascadeStart + 1}`} />
      )}

      {/* Playhead */}
      <div className="absolute top-0 bottom-0 w-1 bg-white rounded"
        style={{ left: pct(current), transform: 'translateX(-50%)' }} />
    </div>
  );
}

// ─── Normal-mode timeline bar ─────────────────────────────────────────────────

function NormalTimelineBar({ total, current, cascadeStart, onChange }) {
  const pct = (i) => `${(i / total) * 100}%`;

  function handleClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onChange(Math.round(ratio * (total - 1)));
  }

  return (
    <div className="relative h-5 cursor-pointer" onClick={handleClick}>
      {/* Background track */}
      <div className="absolute inset-y-0 left-0 right-0 rounded overflow-hidden bg-gray-700" />

      {/* Cascade start marker */}
      {cascadeStart >= 0 && cascadeStart < total && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-70"
          style={{ left: pct(cascadeStart) }}
          title={`Cascade starts at t=${cascadeStart + 1}`}
        />
      )}

      {/* Playhead */}
      <div
        className="absolute top-0 bottom-0 w-1 bg-blue-400 rounded"
        style={{ left: pct(current), transform: 'translateX(-50%)' }}
      />
    </div>
  );
}

// ─── Legend helpers ───────────────────────────────────────────────────────────

function LegendDot({ colour, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-3 h-3 rounded-full" style={{ background: colour }} />
      <span className="text-gray-300">{label}</span>
    </div>
  );
}

function LegendLine({ colour, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-5 h-0.5 rounded" style={{ background: colour }} />
      <span className="text-gray-300">{label}</span>
    </div>
  );
}

/** Small blue gradient bar showing low → high load stress. */
function LegendLoadGradient() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-12 h-3 rounded"
        style={{ background: 'linear-gradient(to right, #dbeafe, #1e3a8a)' }} />
      <span className="text-gray-300">Load (lo→hi)</span>
    </div>
  );
}

function LegendLineDashed({ colour, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-5 h-0"
        style={{ borderTop: `2px dashed ${colour}`, opacity: 0.8 }} />
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
