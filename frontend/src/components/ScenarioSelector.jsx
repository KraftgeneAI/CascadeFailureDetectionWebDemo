import { useEffect, useState } from 'react';
import { fetchScenarios, fetchScenario } from '../api';

/**
 * ScenarioSelector
 * ----------------
 * Fetches the list of scenarios on mount, renders a dropdown, and calls
 * onScenarioLoad(scenarioDetail) when the user picks one.
 */
export default function ScenarioSelector({ onScenarioLoad }) {
  const [scenarios, setScenarios] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch scenario list once on mount
  useEffect(() => {
    fetchScenarios()
      .then(setScenarios)
      .catch((e) => setError(e.message));
  }, []);

  async function handleChange(e) {
    const id = Number(e.target.value);
    setSelectedId(id);
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchScenario(id);
      onScenarioLoad(detail);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const selected = scenarios.find((s) => s.id === selectedId);

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">
        Scenario
      </h2>

      <select
        className="w-full bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
        value={selectedId}
        onChange={handleChange}
      >
        <option value="">— select a scenario —</option>
        {scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            #{s.id} &nbsp;
            {s.is_cascade ? '🔴 Cascade' : '🟢 Normal'} &nbsp;
            stress {(s.stress_level * 100).toFixed(0)}%
          </option>
        ))}
      </select>

      {loading && (
        <p className="text-xs text-blue-400 animate-pulse">Loading scenario…</p>
      )}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {/* Metadata badge strip */}
      {selected && !loading && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <MetaBadge
            label="Type"
            value={selected.is_cascade ? 'Cascade' : 'Normal'}
            colour={selected.is_cascade ? 'text-red-400' : 'text-green-400'}
          />
          <MetaBadge
            label="Stress"
            value={`${(selected.stress_level * 100).toFixed(1)}%`}
            colour="text-yellow-400"
          />
        </div>
      )}
    </div>
  );
}

function MetaBadge({ label, value, colour }) {
  return (
    <div className="bg-gray-800 rounded px-2 py-1">
      <p className="text-gray-500 text-xs">{label}</p>
      <p className={`font-semibold ${colour}`}>{value}</p>
    </div>
  );
}
