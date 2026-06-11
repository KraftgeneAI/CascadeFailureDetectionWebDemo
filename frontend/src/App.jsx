import { useState, useEffect, useRef, useReducer, useMemo } from 'react';
import { Sun, Moon } from 'lucide-react';
import ScenarioSelector from './components/ScenarioSelector';
import GridMap from './components/GridMap';
import NodePanel from './components/NodePanel';
import ComparisonPanel from './components/ComparisonPanel';
import StreamingPanel from './components/StreamingPanel';
import { simulateCascade, compareScenario, streamPredict } from './api';

// ── Streaming mode constants ─────────────────────────────────────────
const STREAM_SPEEDS = [
  { label: '×0.5', ms: 3000 },
  { label: '×1', ms: 1500 },
  { label: '×2', ms: 750 },
];
const MIN_WINDOW = 10; // model's minimum input window (timesteps)

/**
 * Ticket store reducer (in-memory, per streaming run).
 *
 * Dedup rule: a risky node only creates a new ticket if it has no OPEN
 * ticket. Solved tickets don't block — recurrence reopens as a NEW ticket.
 */
function ticketsReducer(state, action) {
  switch (action.type) {
    case 'INGEST': {
      const openNodeIds = new Set(
        state.filter((t) => t.status === 'open').map((t) => t.nodeId),
      );
      const fresh = action.riskyNodes
        .filter((n) => !openNodeIds.has(n.node_id))
        .map((n) => ({
          id: `node-${n.node_id}-step-${action.step}`,
          nodeId: n.node_id,
          score: n.score,
          predTimeMinutes: n.pred_time_minutes,
          createdStep: action.step,
          status: 'open',
          solvedStep: null,
        }));
      return fresh.length ? [...fresh, ...state] : state;
    }
    case 'SOLVE':
      return state.map((t) =>
        t.id === action.id ? { ...t, status: 'solved', solvedStep: action.step } : t,
      );
    case 'RESET':
      return [];
    default:
      return state;
  }
}

export default function App() {
  const [scenario, setScenario] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  // ── Sidebar Resize Logic ─────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(384); // Default (matches w-96)
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e) => {
      // Clamp width between 280px and 600px
      const newWidth = Math.max(280, Math.min(e.clientX, 600));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    // Set global cursor while dragging so it doesn't flicker
    document.body.style.cursor = 'col-resize';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };
  }, [isResizing]);

  // ── Dark Mode State ──────────────────────────────────────────────────
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // ── Cascade simulation (click-to-fail) ──────────────────────────────
  const [cascadeResult, setCascadeResult] = useState(null);
  const [cascadeLoading, setCascadeLoading] = useState(false);
  const [cascadeError, setCascadeError] = useState(null);

  // ── Normal mode timeline ─────────────────────────────────────────────
  const [normalFrame, setNormalFrame] = useState(0);

  // ── Compare mode (model prediction vs ground truth animation) ───────
  const [compareMode, setCompareMode] = useState(false);
  const [compareData, setCompareData] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(0);

  // ── Streaming mode (live telemetry replay + risk tickets) ───────────
  const [streamingMode, setStreamingMode] = useState(false);
  const [streamRunning, setStreamRunning] = useState(false);
  const [streamStep, setStreamStep] = useState(0);          // 0-based frame index
  const [streamSpeedIdx, setStreamSpeedIdx] = useState(1);
  const [streamPrediction, setStreamPrediction] = useState(null);
  const [streamInferring, setStreamInferring] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [tickets, dispatchTickets] = useReducer(ticketsReducer, []);
  const streamInFlight = useRef(false);     // skip ticks while a request is pending
  const lastIngestedStep = useRef(0);       // drop stale responses

  const totalStreamSteps = scenario?.total_timesteps ?? 0;

  function resetStreamRun() {
    setStreamStep(0);
    setStreamPrediction(null);
    setStreamError(null);
    setStreamInferring(false);
    dispatchTickets({ type: 'RESET' });
    streamInFlight.current = false;
    lastIngestedStep.current = 0;
  }

  function exitStreaming() {
    setStreamingMode(false);
    setStreamRunning(false);
    resetStreamRun();
  }

  function handleToggleStreaming() {
    if (!scenario) return;
    if (streamingMode) {
      exitStreaming();
      return;
    }
    // Streaming is exclusive with compare mode
    setCompareMode(false);
    setCompareData(null);
    setCompareError(null);
    setSelectedNode(null);
    setCascadeResult(null);
    resetStreamRun();
    setStreamingMode(true);
    setStreamRunning(true);
  }

  function handleStreamRestart() {
    resetStreamRun();
    setStreamRunning(true);
  }

  // Timer: advance one timestep per tick while running
  useEffect(() => {
    if (!streamingMode || !streamRunning || totalStreamSteps === 0) return;
    const id = setInterval(() => {
      setStreamStep((s) => Math.min(s + 1, totalStreamSteps - 1));
    }, STREAM_SPEEDS[streamSpeedIdx].ms);
    return () => clearInterval(id);
  }, [streamingMode, streamRunning, streamSpeedIdx, totalStreamSteps]);

  // Auto-stop at end of sequence
  useEffect(() => {
    if (streamingMode && totalStreamSteps > 0 && streamStep >= totalStreamSteps - 1) {
      setStreamRunning(false);
    }
  }, [streamingMode, streamStep, totalStreamSteps]);

  // Windowed inference: once >= MIN_WINDOW steps have arrived, run the model
  // on the growing window [0..arrived) after every new step.
  useEffect(() => {
    if (!streamingMode || !scenario) return;
    const arrived = streamStep + 1;
    if (arrived < MIN_WINDOW) return;
    if (streamInFlight.current) return;   // coalesce: next tick covers a larger window

    streamInFlight.current = true;
    setStreamInferring(true);
    streamPredict(scenario.id, arrived)
      .then((res) => {
        if (res.end_step > lastIngestedStep.current) {
          lastIngestedStep.current = res.end_step;
          setStreamPrediction(res);
          setStreamError(null);
          dispatchTickets({ type: 'INGEST', riskyNodes: res.risky_nodes, step: res.end_step });
        }
      })
      .catch((e) => setStreamError(e.message))
      .finally(() => {
        streamInFlight.current = false;
        setStreamInferring(false);
      });
  }, [streamingMode, scenario, streamStep]);

  const openTicketNodeIds = useMemo(
    () => new Set(tickets.filter((t) => t.status === 'open').map((t) => t.nodeId)),
    [tickets],
  );

  // ── Handlers ─────────────────────────────────────────────────────────

  function handleScenarioLoad(detail) {
    setScenario(detail);
    setSelectedNode(null);
    setCascadeResult(null);
    setCascadeError(null);
    setNormalFrame(0);
    setCompareMode(false);
    setCompareData(null);
    setCompareError(null);
    setCurrentFrame(0);
    exitStreaming();
  }

  async function handleNodeClick(node) {
    if (compareMode || streamingMode) return;
    setSelectedNode(node);
    if (!scenario) return;

    setCascadeLoading(true);
    setCascadeResult(null);
    setCascadeError(null);
    try {
      const result = await simulateCascade(scenario.id, node.id, normalFrame);
      setCascadeResult(result);
    } catch (e) {
      setCascadeError(e.message);
    } finally {
      setCascadeLoading(false);
    }
  }

  async function handleToggleCompare() {
    if (!scenario) return;
    if (compareMode) {
      setCompareMode(false);
      setCompareData(null);
      setCompareError(null);
      setCurrentFrame(0);
      return;
    }
    exitStreaming();   // compare is exclusive with streaming
    setCompareLoading(true);
    setCompareError(null);
    try {
      const data = await compareScenario(scenario.id);
      setCompareData(data);
      setCompareMode(true);
      setCurrentFrame(data.start_idx);
    } catch (e) {
      setCompareError(e.message);
    } finally {
      setCompareLoading(false);
    }
  }

  const activeGridState = compareMode && compareData
    ? compareData.timesteps[currentFrame]
    : streamingMode
      ? (scenario?.all_timesteps?.[streamStep] ?? scenario?.grid_state ?? null)
      : (scenario?.all_timesteps?.[normalFrame] ?? scenario?.grid_state ?? null);

  const totalNormalFrames = scenario?.total_timesteps ?? 0;
  const isCompareAvailable = scenario?.metadata?.is_cascade === true;

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors duration-300">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="flex items-center gap-4 px-6 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shrink-0 z-10 transition-colors duration-300">
        <span className="text-lg font-semibold tracking-wide text-gray-900 dark:text-white">
          ⚡ Power Grid Digital Twin
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">IEEE 118-Bus</span>

        <div className="ml-auto flex items-center gap-3">
          {cascadeLoading && !compareMode && (
            <span className="text-xs text-orange-500 dark:text-orange-400 animate-pulse">
              Simulating cascade…
            </span>
          )}
          {cascadeError && !compareMode && (
            <span className="text-xs text-red-600 dark:text-red-400">
              Cascade error: {cascadeError}
            </span>
          )}
          {compareLoading && (
            <span className="text-xs text-blue-600 dark:text-blue-400 animate-pulse">
              Running model prediction…
            </span>
          )}
          {compareError && (
            <span className="text-xs text-red-600 dark:text-red-400">
              Compare error: {compareError}
            </span>
          )}

          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
            aria-label="Toggle Dark Mode"
          >
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {scenario && <div className="h-5 w-px bg-gray-300 dark:bg-gray-700 mx-1"></div>}

          {scenario && (
            <button
              onClick={handleToggleStreaming}
              className={`relative px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                streamingMode
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {streamingMode ? '✕ Exit Stream' : '▶ Live Stream'}
              {streamingMode && openTicketNodeIds.size > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {openTicketNodeIds.size}
                </span>
              )}
            </button>
          )}

          {isCompareAvailable && (
            <button
              onClick={handleToggleCompare}
              disabled={compareLoading}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                compareMode
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {compareMode ? '✕ Exit Compare' : '⬡ Model vs Reality'}
            </button>
          )}
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* ── PANEL B: LEFT SIDEBAR ── */}
        <aside 
          style={{ width: `${sidebarWidth}px` }}
          className="flex flex-col shrink-0 bg-gray-50 dark:bg-gray-900 overflow-y-auto transition-colors duration-300"
        >
          <div className="p-4 border-b border-gray-200 dark:border-gray-800">
            <ScenarioSelector onScenarioLoad={handleScenarioLoad} />
          </div>
          <div className="flex-1 p-4">
            {streamingMode ? (
              <StreamingPanel
                streamStep={streamStep}
                totalSteps={totalStreamSteps}
                running={streamRunning}
                onToggleRun={() => setStreamRunning((r) => !r)}
                onRestart={handleStreamRestart}
                speedIdx={streamSpeedIdx}
                speeds={STREAM_SPEEDS}
                onSpeedChange={setStreamSpeedIdx}
                prediction={streamPrediction}
                inferring={streamInferring}
                error={streamError}
                tickets={tickets}
                onSolve={(id) => dispatchTickets({ type: 'SOLVE', id, step: streamStep + 1 })}
              />
            ) : compareMode && compareData ? (
              <ComparisonPanel
                compareData={compareData}
                currentFrame={currentFrame}
              />
            ) : (
              <NodePanel
                node={selectedNode}
                scenario={scenario}
                cascadeResult={cascadeResult}
                cascadeLoading={cascadeLoading}
              />
            )}
          </div>
        </aside>

        {/* ── DRAGGABLE SEPARATOR ── */}
        <div
          onMouseDown={() => setIsResizing(true)}
          className={`w-1.5 cursor-col-resize shrink-0 z-20 flex items-center justify-center group transition-colors ${
            isResizing ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-800 hover:bg-blue-400 dark:hover:bg-blue-600'
          }`}
        >
           {/* Visual handle icon (3 small dots) */}
           <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
             <div className="w-1 h-1 rounded-full bg-white"></div>
             <div className="w-1 h-1 rounded-full bg-white"></div>
             <div className="w-1 h-1 rounded-full bg-white"></div>
           </div>
        </div>

        {/* ── PANEL A: MAIN GRID AREA ── */}
        <main className="flex-1 overflow-hidden relative bg-white dark:bg-gray-950 transition-colors duration-300">
          {activeGridState ? (
            <GridMap
              scenario={{ ...scenario, grid_state: activeGridState }}
              selectedNodeId={selectedNode?.id}
              onNodeClick={handleNodeClick}
              normalFrame={streamingMode ? streamStep : normalFrame}
              onNormalFrameChange={setNormalFrame}
              totalNormalFrames={totalNormalFrames}
              compareMode={compareMode}
              compareData={compareData}
              currentFrame={currentFrame}
              onFrameChange={setCurrentFrame}
              streamingMode={streamingMode}
              ticketNodeIds={openTicketNodeIds}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-600 text-sm">
              Select a scenario to visualise the grid
            </div>
          )}
        </main>

      </div>
    </div>
  );
}