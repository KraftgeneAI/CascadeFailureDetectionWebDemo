export default function ComparisonPanel({ compareData, currentFrame }) {
  if (!compareData) return null;

  const {
    end_idx,
    cascade_start_time,
    cascade_probability,
    cascade_detected,
    metrics,
    predicted_cascade_path,
    ground_truth_cascade_path,
  } = compareData;

  const pct        = Math.round(cascade_probability * 100);
  const stepsAhead = cascade_start_time >= 0 ? cascade_start_time - end_idx : null;

  const revealedGtIds = new Set(
    ground_truth_cascade_path
      .filter((s) => s.failure_timestep <= currentFrame)
      .map((s) => s.node_id),
  );

  const predictedIds = new Set(predicted_cascade_path.map((s) => s.node_id));

  const confirmedCorrect = [...predictedIds].filter((id) => revealedGtIds.has(id)).length;
  const confirmedMissed  = [...revealedGtIds].filter((id) => !predictedIds.has(id)).length;
  const falseAlarmCount  = metrics.false_positives.length;

  return (
    <div className="space-y-4 text-xs">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">
        AI Prediction Results
      </h2>

      {/* ── Cascade alert ─────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-transparent shadow-sm dark:shadow-none rounded p-3 space-y-2 transition-colors">
        <p className="text-gray-700 dark:text-gray-400 font-semibold">Cascade Alert</p>
        <div className="flex items-center justify-between">
          <span className="text-gray-500 dark:text-gray-400">Detected</span>
          <span className={cascade_detected ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-green-600 dark:text-green-400 font-semibold'}>
            {cascade_detected ? '⚠ Yes' : '✓ No'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500 dark:text-gray-400">Confidence</span>
          <span className={`font-mono font-bold ${
            pct >= 70 ? 'text-red-600 dark:text-red-400' : pct >= 40 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'
          }`}>
            {pct}%
          </span>
        </div>
        <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
          <div
            className="h-full rounded transition-all"
            style={{
              width: `${pct}%`,
              background: pct >= 70 ? '#ef4444' : pct >= 40 ? '#eab308' : '#22c55e',
            }}
          />
        </div>
        {cascade_detected && stepsAhead > 0 && (
          <p className="text-cyan-600 dark:text-cyan-300 font-semibold pt-1">
            ⚡ Warning issued {stepsAhead} step{stepsAhead !== 1 ? 's' : ''} before cascade began
          </p>
        )}
      </div>

      {/* ── Node Prediction Accuracy ───────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-transparent shadow-sm dark:shadow-none rounded p-3 space-y-2 transition-colors">
          <p className="text-gray-700 dark:text-gray-400 font-semibold">Node Prediction Accuracy</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <ScoreCard
              label="Correct"
              count={confirmedCorrect}
              colour="text-cyan-700 dark:text-cyan-400"
              bg="bg-cyan-50 dark:bg-cyan-950"
            />
            <ScoreCard
              label="Missed"
              count={confirmedMissed}
              colour="text-orange-700 dark:text-orange-400"
              bg="bg-orange-50 dark:bg-orange-950"
            />
            {currentFrame >= (compareData.total_timesteps - 1) && (
              <ScoreCard
                label="False alarm"
                count={falseAlarmCount}
                colour="text-gray-600 dark:text-gray-400"
                bg="bg-gray-100 dark:bg-gray-700"
              />
            )}
          </div>

          {currentFrame >= (compareData.total_timesteps - 1) && (
            <div className="pt-2 space-y-1 border-t border-gray-200 dark:border-gray-700 mt-2">
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
          )}
      </div>

      {/* ── Predicted Failures ───────────────────────────────────────── */}
      {predicted_cascade_path.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-transparent shadow-sm dark:shadow-none rounded p-3 space-y-2 transition-colors">
          <p className="text-gray-700 dark:text-gray-400 font-semibold">
            Predicted Failures&nbsp;
            {currentFrame >= end_idx && (
              <span className="text-gray-500 dark:text-gray-600 font-normal">
                ({confirmedCorrect} / {predicted_cascade_path.length} confirmed)
              </span>
            )}
          </p>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {predicted_cascade_path
              .filter((step) => revealedGtIds.has(step.node_id))
              .map((step) => (
                <div
                  key={step.node_id}
                  className="flex items-center justify-between rounded px-2 py-1 bg-cyan-50 dark:bg-cyan-950 transition-colors"
                >
                  <span className="text-gray-900 dark:text-white">Node {step.node_id}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400 font-mono">
                      {step.pred_time_minutes.toFixed(1)} min
                    </span>
                    <span className="text-cyan-700 dark:text-cyan-400 font-semibold">✓ Confirmed</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── What Actually Happened ─────────────────────────────────────── */}
      {ground_truth_cascade_path.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-transparent shadow-sm dark:shadow-none rounded p-3 space-y-2 transition-colors">
          <p className="text-gray-700 dark:text-gray-400 font-semibold">What Actually Happened</p>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {ground_truth_cascade_path
              .filter((step) => step.failure_timestep <= currentFrame)
              .map((step) => {
                const isTP = metrics.true_positives.includes(step.node_id);
                const isFN = metrics.false_negatives.includes(step.node_id);
                return (
                  <div
                    key={step.node_id}
                    className={`flex items-center justify-between rounded px-2 py-1 transition-colors ${
                      isTP ? 'bg-cyan-50 dark:bg-cyan-950' : isFN ? 'bg-red-50 dark:bg-red-950' : 'bg-gray-100 dark:bg-gray-700'
                    }`}
                  >
                    <span className="text-gray-900 dark:text-white">Node {step.node_id}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 dark:text-gray-400 font-mono">
                        {step.time_minutes.toFixed(1)} min
                      </span>
                      {isTP && <span className="text-cyan-700 dark:text-cyan-400">✓ Predicted</span>}
                      {isFN && <span className="text-orange-700 dark:text-orange-400">⚠ Missed</span>}
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

function Row({ label, value, colour = 'text-gray-600 dark:text-gray-300' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`font-mono font-semibold ${colour}`}>{value}</span>
    </div>
  );
}

function ScoreCard({ label, count, colour, bg }) {
  return (
    <div className={`${bg} rounded p-2 transition-colors`}>
      <p className={`text-lg font-bold ${colour}`}>{count}</p>
      <p className="text-gray-500">{label}</p>
    </div>
  );
}

function metricColour(v) {
  if (v >= 0.7) return 'text-green-600 dark:text-green-400';
  if (v >= 0.4) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}