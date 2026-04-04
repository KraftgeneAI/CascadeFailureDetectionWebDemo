import { useState } from 'react';
import ScenarioSelector from './components/ScenarioSelector';
import GridMap from './components/GridMap';
import NodePanel from './components/NodePanel';
import ComparisonPanel from './components/ComparisonPanel';
import { simulateCascade, compareScenario } from './api';

export default function App() {
  const [scenario, setScenario] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  // ── Cascade simulation (click-to-fail) ──────────────────────────────
  const [cascadeResult, setCascadeResult] = useState(null);
  const [cascadeLoading, setCascadeLoading] = useState(false);
  const [cascadeError, setCascadeError] = useState(null);

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
      const result = await simulateCascade(scenario.id, node.id);
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

  // Which grid state to display: animated frame in compare mode, else t=0
  const activeGridState = compareMode && compareData
    ? compareData.timesteps[currentFrame]
    : scenario?.grid_state ?? null;

  const isCompareAvailable = scenario?.metadata?.is_cascade === true;

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="flex items-center gap-4 px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <span className="text-lg font-semibold tracking-wide text-white">
          ⚡ Power Grid Digital Twin
        </span>
        <span className="text-xs text-gray-500">IEEE 118-Bus</span>

        <div className="ml-auto flex items-center gap-3">
          {/* Status messages */}
          {cascadeLoading && !compareMode && (
            <span className="text-xs text-orange-400 animate-pulse">
              Simulating cascade…
            </span>
          )}
          {cascadeError && !compareMode && (
            <span className="text-xs text-red-400">
              Cascade error: {cascadeError}
            </span>
          )}
          {compareLoading && (
            <span className="text-xs text-blue-400 animate-pulse">
              Running model prediction…
            </span>
          )}
          {compareError && (
            <span className="text-xs text-red-400">
              Compare error: {compareError}
            </span>
          )}

          {/* Compare toggle — only shown for cascade scenarios */}
          {isCompareAvailable && (
            <button
              onClick={handleToggleCompare}
              disabled={compareLoading}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                compareMode
                  ? 'bg-purple-700 text-white hover:bg-purple-600'
                  : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
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
        <aside className="flex flex-col w-96 shrink-0 border-r border-gray-800 bg-gray-900 overflow-y-auto">
          <div className="p-4 border-b border-gray-800">
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
        <main className="flex-1 overflow-hidden relative">
          {activeGridState ? (
            <GridMap
              scenario={{ ...scenario, grid_state: activeGridState }}
              selectedNodeId={selectedNode?.id}
              onNodeClick={handleNodeClick}
              cascadeResult={compareMode ? null : cascadeResult}
              // Compare-mode props
              compareMode={compareMode}
              compareData={compareData}
              currentFrame={currentFrame}
              onFrameChange={setCurrentFrame}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              Select a scenario to visualise the grid
            </div>
          )}
        </main>

      </div>
    </div>
  );
}
