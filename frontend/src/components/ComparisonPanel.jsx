/**
 * ComparisonPanel
 * ---------------
 * Shown in the sidebar when Compare Mode is active.
 * Displays:
 *   - Model input window info (which timesteps the model saw)
 *   - Cascade probability gauge
 *   - Node-level prediction scorecard (TP / FP / FN)
 *   - Accuracy metrics (precision, recall, F1)
 *
 * Props:
 *   compareData  — full response from POST /api/compare
 *   currentFrame — currently displayed timestep index (from animation)
 */
export default function ComparisonPanel({ compareData, currentFrame }) {
  if (!compareData) return null;

  const {
    start_idx,
    end_idx,
    total_timesteps,
    cascade_start_time,
    cascade_probability,
    cascade_detected,
    metrics,
    predicted_cascade_path,
    ground_truth_cascade_path,
  } = compareData;

  const windowLength = end_idx - start_idx;
  const pct = Math.round(cascade_probability * 100);

  // Determine current animation zone
  const zone =
    currentFrame < start_idx ? 'before' :
    currentFrame < end_idx   ? 'model'  :
                               'truth';

  const zoneLabel = {
    before: { text: 'Before model window', cls: 'text-gray-400' },
    model:  { text: 'Model input window',  cls: 'text-blue-400' },
    truth:  { text: 'Ground truth unfolds', cls: 'text-orange-400' },
  }[zone];

  return (
    <div className="space-y-4 text-xs">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">
        Model vs Reality
      </h2>

      {/* Current animation position */}
      <div className="bg-gray-800 rounded p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Frame</span>
          <span className="font-mono text-white">
            {currentFrame + 1} / {total_timesteps}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Zone</span>
          <span className={`font-semibold ${zoneLabel.cls}`}>
            {zoneLabel.text}
          </span>
        </div>
      </div>

      {/* Model input window */}
      <div className="bg-gray-800 rounded p-3 space-y-2">
        <p className="text-gray-500 font-semibold">Model Input Window</p>
        <Row label="Steps seen" value={`${start_idx} → ${end_idx - 1}`} />
        <Row label="Window length" value={`${windowLength} steps`} />
        <Row
          label="Cascade starts"
          value={cascade_start_time >= 0 ? `step ${cascade_start_time}` : '—'}
          colour="text-orange-400"
        />
        <p className="text-gray-600 pt-1">
          Model sees {windowLength} steps, ending {cascade_start_time - end_idx} steps
          before cascade begins.
        </p>
      </div>

      {/* Cascade probability */}
      <div className="bg-gray-800 rounded p-3 space-y-2">
        <p className="text-gray-500 font-semibold">Cascade Prediction</p>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Detected</span>
          <span className={cascade_detected ? 'text-red-400 font-semibold' : 'text-green-400 font-semibold'}>
            {cascade_detected ? '⚠ Yes' : '✓ No'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Confidence</span>
          <span className={`font-mono font-bold ${
            pct >= 70 ? 'text-red-400' : pct >= 40 ? 'text-yellow-400' : 'text-green-400'
          }`}>
            {pct}%
          </span>
        </div>
        {/* Probability bar */}
        <div className="w-full h-2 bg-gray-700 rounded overflow-hidden">
          <div
            className="h-full rounded transition-all"
            style={{
              width: `${pct}%`,
              background: pct >= 70 ? '#ef4444' : pct >= 40 ? '#eab308' : '#22c55e',
            }}
          />
        </div>
      </div>

      {/* Node scorecard */}
      <div className="bg-gray-800 rounded p-3 space-y-2">
        <p className="text-gray-500 font-semibold">Node Prediction</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <ScoreCard
            label="Correct"
            count={metrics.true_positives.length}
            colour="text-cyan-400"
            bg="bg-cyan-950"
          />
          <ScoreCard
            label="Missed"
            count={metrics.false_negatives.length}
            colour="text-orange-400"
            bg="bg-orange-950"
          />
          <ScoreCard
            label="False alarm"
            count={metrics.false_positives.length}
            colour="text-gray-400"
            bg="bg-gray-700"
          />
        </div>

        {/* Accuracy metrics */}
        <div className="pt-2 space-y-1 border-t border-gray-700 mt-2">
          <Row
            label="Precision"
            value={`${(metrics.precision * 100).toFixed(1)}%`}
            colour={metricColour(metrics.precision)}
          />
          <Row
            label="Recall"
            value={`${(metrics.recall * 100).toFixed(1)}%`}
            colour={metricColour(metrics.recall)}
          />
          <Row
            label="F1"
            value={`${(metrics.f1 * 100).toFixed(1)}%`}
            colour={metricColour(metrics.f1)}
          />
        </div>
      </div>

      {/* Predicted cascade path */}
      {predicted_cascade_path.length > 0 && (
        <div className="bg-gray-800 rounded p-3 space-y-2">
          <p className="text-gray-500 font-semibold">
            Predicted Path ({predicted_cascade_path.length} nodes)
          </p>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {predicted_cascade_path.map((step) => {
              const isTP = metrics.true_positives.includes(step.node_id);
              const isFP = metrics.false_positives.includes(step.node_id);
              return (
                <div
                  key={step.node_id}
                  className={`flex items-center justify-between rounded px-2 py-1 ${
                    isTP ? 'bg-cyan-950' : isFP ? 'bg-gray-700' : 'bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-purple-400 font-mono font-bold w-5 text-center">
                      #{step.order}
                    </span>
                    <span className="text-white">Node {step.node_id}</span>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <span className="text-gray-400 font-mono">
                      {step.pred_time_minutes.toFixed(1)} min
                    </span>
                    {isTP && <span className="text-cyan-400">✓</span>}
                    {isFP && <span className="text-gray-500">✗</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ground truth path */}
      {ground_truth_cascade_path.length > 0 && (
        <div className="bg-gray-800 rounded p-3 space-y-2">
          <p className="text-gray-500 font-semibold">
            Ground Truth ({ground_truth_cascade_path.length} nodes)
          </p>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {ground_truth_cascade_path.map((step, i) => {
              const isTP = metrics.true_positives.includes(step.node_id);
              const isFN = metrics.false_negatives.includes(step.node_id);
              // Highlight if current frame has reached this failure
              const revealed = currentFrame * 2 >= step.time_minutes; // 2 min/step
              return (
                <div
                  key={step.node_id}
                  className={`flex items-center justify-between rounded px-2 py-1 ${
                    isTP ? 'bg-cyan-950' : isFN ? 'bg-red-950' : 'bg-gray-700'
                  } ${!revealed ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-orange-400 font-mono font-bold w-5 text-center">
                      {i + 1}
                    </span>
                    <span className="text-white">Node {step.node_id}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 font-mono">
                      {step.time_minutes.toFixed(1)} min
                    </span>
                    {isTP && <span className="text-cyan-400">✓</span>}
                    {isFN && <span className="text-red-400">✗</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({ label, value, colour = 'text-gray-300' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={`font-mono font-semibold ${colour}`}>{value}</span>
    </div>
  );
}

function ScoreCard({ label, count, colour, bg }) {
  return (
    <div className={`${bg} rounded p-2`}>
      <p className={`text-lg font-bold ${colour}`}>{count}</p>
      <p className="text-gray-500">{label}</p>
    </div>
  );
}

function metricColour(v) {
  if (v >= 0.7) return 'text-green-400';
  if (v >= 0.4) return 'text-yellow-400';
  return 'text-red-400';
}
