import { useState, useEffect, useRef } from 'react';
import { Sun, Moon } from 'lucide-react';
import ScenarioSelector from './components/ScenarioSelector';
import GridMap from './components/GridMap';
import NodePanel from './components/NodePanel';
import ComparisonPanel from './components/ComparisonPanel';
import { simulateCascade, compareScenario } from './api';

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
  }

  async function handleNodeClick(node) {
    if (compareMode) return;
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

          {isCompareAvailable && <div className="h-5 w-px bg-gray-300 dark:bg-gray-700 mx-1"></div>}

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
              cascadeResult={compareMode ? null : cascadeResult}
              normalFrame={normalFrame}
              onNormalFrameChange={setNormalFrame}
              totalNormalFrames={totalNormalFrames}
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