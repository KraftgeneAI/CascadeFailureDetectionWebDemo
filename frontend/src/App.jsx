import { useState } from 'react';
import ScenarioSelector from './components/ScenarioSelector';
import GridMap from './components/GridMap';
import NodePanel from './components/NodePanel';
import { simulateCascade } from './api';

export default function App() {
  // Full scenario detail returned by GET /api/scenario/{id}
  const [scenario, setScenario] = useState(null);
  // Node clicked in the GridMap
  const [selectedNode, setSelectedNode] = useState(null);
  // Cascade simulation result
  const [cascadeResult, setCascadeResult] = useState(null);
  const [cascadeLoading, setCascadeLoading] = useState(false);
  const [cascadeError, setCascadeError] = useState(null);

  function handleScenarioLoad(detail) {
    setScenario(detail);
    setSelectedNode(null);
    setCascadeResult(null);
    setCascadeError(null);
  }

  async function handleNodeClick(node) {
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

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-4 px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <span className="text-lg font-semibold tracking-wide text-white">
          ⚡ Power Grid Digital Twin
        </span>
        <span className="text-xs text-gray-500">IEEE 118-Bus</span>
        {cascadeLoading && (
          <span className="text-xs text-orange-400 animate-pulse ml-auto">
            Simulating cascade…
          </span>
        )}
        {cascadeError && (
          <span className="text-xs text-red-400 ml-auto">
            Cascade error: {cascadeError}
          </span>
        )}
      </header>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar ─────────────────────────────────────────── */}
        <aside className="flex flex-col w-96 shrink-0 border-r border-gray-800 bg-gray-900 overflow-y-auto">
          <div className="p-4 border-b border-gray-800">
            <ScenarioSelector onScenarioLoad={handleScenarioLoad} />
          </div>
          <div className="flex-1 p-4">
            <NodePanel
              node={selectedNode}
              scenario={scenario}
              cascadeResult={cascadeResult}
              cascadeLoading={cascadeLoading}
            />
          </div>
        </aside>

        {/* ── Main grid area ───────────────────────────────────────── */}
        <main className="flex-1 overflow-hidden relative">
          {scenario ? (
            <GridMap
              scenario={scenario}
              selectedNodeId={selectedNode?.id}
              onNodeClick={handleNodeClick}
              cascadeResult={cascadeResult}
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
