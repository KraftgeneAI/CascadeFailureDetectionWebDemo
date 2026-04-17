import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';
import ScenarioSelector from './components/ScenarioSelector';
import GridMap from './components/GridMap';
import NodePanel from './components/NodePanel';
import ComparisonPanel from './components/ComparisonPanel';
import { simulateCascade, compareScenario } from './api';

export default function App() {
  const [scenario, setScenario] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

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
  // normalFrame tracks which timestep is shown when scrubbing in normal mode.
  const [normalFrame, setNormalFrame] = useState(0);

  // ── Compare mode (model prediction vs ground truth animation) ───────
  const [compareMode, setCompareMode] = useState(false);
  const [compareData, setCompareData] = useState(null);   // full API response
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState(null);

  // current animated frame index (controlled by GridMap's player)
  const [currentFrame, setCurrentFrame] = useState(0);

  // ── Handlers ─────────────────────────────────────────────────────────

  function handleScenarioLoad(detail) {
    setScenario(detail);
    setSelectedNode(null);
    setCascadeResult(null);
    setCascadeError(null);
    setNormalFrame(0);
    // Exit compare mode when scenario changes
    setCompareMode(false);
    setCompareData(null);
    setCompareError(null);
    setCurrentFrame(0);
  }

  async function handleNodeClick(node) {
    // Ignore clicks during compare animation
    if (compareMode) return;
    setSelectedNode(node);
    if (!scenario) return;

    setCascadeLoading(true);
    setCascadeResult(null);
    setCascadeError(null);
    try {
      // Pass the current normal-mode frame so cascade starts from that
      // timestep's physics state, not always t=0.
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
      // Turn off — go back to normal view
      setCompareMode(false);
      setCompareData(null);
      setCompareError(null);
      setCurrentFrame(0);
      return;
    }

    // Turn on — fetch compare data
    setCompareLoading(true);
    setCompareError(null);
    try {
      const data = await compareScenario(scenario.id);
      setCompareData(data);
      setCompareMode(true);
      setCurrentFrame(data.start_idx);   // start playback from first model frame
    } catch (e) {
      setCompareError(e.message);
    } finally {
      setCompareLoading(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────

  // Which grid state to display:
  //   compare mode  → compare animation frame
  //   normal mode   → scrubbed normalFrame from all_timesteps (falls back to grid_state)
  const activeGridState = compareMode && compareData
    ? compareData.timesteps[currentFrame]
    : (scenario?.all_timesteps?.[normalFrame] ?? scenario?.grid_state ?? null);

  const totalNormalFrames = scenario?.total_timesteps ?? 0;

  const isCompareAvailable = scenario?.metadata?.is_cascade === true;

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors duration-300">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="flex items-center gap-4 px-6 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shrink-0 transition-colors duration-300">
        <span className="text-lg font-semibold tracking-wide text-gray-900 dark:text-white">
          ⚡ Power Grid Digital Twin
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">IEEE 118-Bus</span>

        <div className="ml-auto flex items-center gap-3">
          {/* Status messages */}
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

          {/* Theme Toggle */}
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
            aria-label="Toggle Dark Mode"
          >
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {isCompareAvailable && <div className="h-5 w-px bg-gray-300 dark:bg-gray-700 mx-1"></div>}

          {/* Compare toggle — only shown for cascade scenarios */}
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
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar ─────────────────────────────────────────── */}
        <aside className="flex flex-col w-96 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 overflow-y-auto transition-colors duration-300">
          <div className="p-4 border-b border-gray-200 dark:border-gray-800">
            <ScenarioSelector onScenarioLoad={handleScenarioLoad} />
          </div>
          <div className="flex-1 p-4">
            {compareMode && compareData ? (
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

        {/* ── Main grid area ───────────────────────────────────────── */}
        <main className="flex-1 overflow-hidden relative bg-white dark:bg-gray-950 transition-colors duration-300">
          {activeGridState ? (
            <GridMap
              scenario={{ ...scenario, grid_state: activeGridState }}
              selectedNodeId={selectedNode?.id}
              onNodeClick={handleNodeClick}
              cascadeResult={compareMode ? null : cascadeResult}
              // Normal-mode timeline
              normalFrame={normalFrame}
              onNormalFrameChange={setNormalFrame}
              totalNormalFrames={totalNormalFrames}
              // Compare-mode props
              compareMode={compareMode}
              compareData={compareData}
              currentFrame={currentFrame}
              onFrameChange={setCurrentFrame}
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