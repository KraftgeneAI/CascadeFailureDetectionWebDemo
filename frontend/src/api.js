/**
 * API helpers
 * -----------
 * All requests go to the FastAPI backend at /api/* (proxied via package.json
 * "proxy": "http://localhost:8000" in development).
 */

const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

/** GET /api/scenarios — lightweight list of all test scenarios */
export function fetchScenarios() {
  return request('/scenarios');
}

/** GET /api/scenario/{id} — full detail: topology + t=0 grid state + metadata */
export function fetchScenario(id) {
  return request(`/scenario/${id}`);
}

/** POST /api/predict — run GNN inference on a scenario */
export function predict(scenarioId) {
  return request('/predict', {
    method: 'POST',
    body: JSON.stringify({ scenario_id: scenarioId }),
  });
}

/** POST /api/cascade — physics-based cascade simulation from a trigger node */
export function simulateCascade(scenarioId, nodeId) {
  return request('/cascade', {
    method: 'POST',
    body: JSON.stringify({ scenario_id: scenarioId, node_id: nodeId }),
  });
}

/**
 * POST /api/compare — model prediction vs ground truth comparison.
 * Returns all timestep grid states for animation, the truncation window
 * (start_idx / end_idx), GNN prediction, ground truth, and accuracy metrics.
 */
export function compareScenario(scenarioId) {
  return request('/compare', {
    method: 'POST',
    body: JSON.stringify({ scenario_id: scenarioId }),
  });
}
