/**
 * StreamingPanel
 * --------------
 * Left-sidebar panel for Streaming (live) mode.
 *
 * Shows the live-stream status (collecting data until 10 steps have
 * arrived, then model risk output) and the operator ticket queue.
 * Tickets are created in App.jsx from model risky_nodes (deduped against
 * open tickets); operators mark them solved here.
 */

import { Radio, Play, Pause, RotateCcw, CheckCircle2, AlertTriangle } from 'lucide-react';

const MIN_WINDOW = 10;

function severityClasses(score) {
  if (score >= 0.9) return { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Critical' };
  if (score >= 0.7) return { dot: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400', label: 'High' };
  return { dot: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400', label: 'Elevated' };
}

export default function StreamingPanel({
  streamStep,          // 0-based index of the latest arrived frame
  totalSteps,
  running,
  onToggleRun,
  onRestart,
  speedIdx,
  speeds,              // [{label, ms}]
  onSpeedChange,
  prediction,          // latest /api/stream/predict response (or null)
  inferring,
  error,
  tickets,             // [{id, nodeId, score, predTimeMinutes, createdStep, status, solvedStep}]
  onSolve,
}) {
  const arrived = streamStep + 1;
  const collecting = arrived < MIN_WINDOW;
  const ended = totalSteps > 0 && arrived >= totalSteps;

  const openTickets = tickets.filter((t) => t.status === 'open');
  const solvedTickets = tickets.filter((t) => t.status === 'solved');

  return (
    <div className="space-y-4 text-sm">

      {/* ── Status / controls ─────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-3 transition-colors">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <Radio size={15} className="text-red-500" />
            Live Stream
          </span>
          {ended ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              Ended
            </span>
          ) : (
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              running
                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
            }`}>
              {running ? '● Streaming' : '⏸ Paused'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleRun}
            disabled={ended}
            className="w-8 h-8 flex items-center justify-center rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label={running ? 'Pause stream' : 'Resume stream'}
          >
            {running ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            onClick={onRestart}
            className="w-8 h-8 flex items-center justify-center rounded bg-gray-200 hover:bg-gray-300 text-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-300 transition-colors"
            aria-label="Restart stream"
          >
            <RotateCcw size={14} />
          </button>
          <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
            t = {Math.min(arrived, totalSteps)} / {totalSteps}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {speeds.map((s, i) => (
              <button
                key={s.label}
                onClick={() => onSpeedChange(i)}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  speedIdx === i
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">Inference error: {error}</p>
        )}
      </div>

      {/* ── Model state ───────────────────────────────────────────── */}
      {collecting ? (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/20 p-4 space-y-2 transition-colors">
          <p className="font-semibold text-blue-700 dark:text-blue-300 animate-pulse">
            📡 Collecting data… ({arrived}/{MIN_WINDOW} steps)
          </p>
          <div className="h-2 rounded-full bg-blue-100 dark:bg-blue-950 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${(arrived / MIN_WINDOW) * 100}%` }}
            />
          </div>
          <p className="text-xs text-blue-600/80 dark:text-blue-400/80">
            The model needs {MIN_WINDOW} timesteps of telemetry before its first risk assessment.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-1.5 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Model assessment
            </span>
            {inferring && (
              <span className="text-xs text-blue-600 dark:text-blue-400 animate-pulse">analysing…</span>
            )}
          </div>
          {prediction ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold ${
                  prediction.cascade_detected ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                }`}>
                  {(prediction.cascade_probability * 100).toFixed(1)}%
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">cascade risk</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Window: steps 1–{prediction.end_step} · {prediction.risky_nodes.length} node
                {prediction.risky_nodes.length === 1 ? '' : 's'} above threshold
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">Awaiting first assessment…</p>
          )}
        </div>
      )}

      {/* ── Open tickets ──────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
            <AlertTriangle size={14} className="text-amber-500" />
            Open tickets
          </span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            openTickets.length > 0
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              : 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}>
            {openTickets.length}
          </span>
        </div>

        {openTickets.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-500 px-1">
            {collecting ? 'Tickets appear after the first model assessment.' : 'No open tickets — grid looks healthy.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {openTickets.map((t) => {
              const sev = severityClasses(t.score);
              return (
                <li
                  key={t.id}
                  className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900 dark:text-white">
                      ⬢ Node {t.nodeId}
                    </span>
                    <span className={`flex items-center gap-1.5 text-xs font-semibold ${sev.text}`}>
                      <span className={`w-2 h-2 rounded-full ${sev.dot}`} />
                      {sev.label}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                    <p>Failure probability: <span className="font-mono">{(t.score * 100).toFixed(1)}%</span></p>
                    {t.predTimeMinutes != null && (
                      <p>Predicted failure: <span className="font-mono">~{t.predTimeMinutes.toFixed(0)} min</span></p>
                    )}
                    <p>Raised at step {t.createdStep}</p>
                  </div>
                  <button
                    onClick={() => onSolve(t.id)}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-semibold bg-green-600 hover:bg-green-700 text-white transition-colors"
                  >
                    <CheckCircle2 size={13} />
                    Mark solved
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Resolved tickets ──────────────────────────────────────── */}
      {solvedTickets.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-500 dark:text-gray-400 font-semibold select-none">
            Resolved ({solvedTickets.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {solvedTickets.map((t) => (
              <li
                key={t.id}
                className="rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-3 py-2 text-gray-500 dark:text-gray-500 flex items-center justify-between"
              >
                <span>⬢ Node {t.nodeId} · raised step {t.createdStep}</span>
                <span className="text-green-600 dark:text-green-500">✓ step {t.solvedStep}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ── End-of-stream summary ─────────────────────────────────── */}
      {ended && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3 text-xs text-gray-600 dark:text-gray-400 transition-colors">
          <p className="font-semibold text-gray-900 dark:text-white mb-1">Stream ended</p>
          <p>{tickets.length} ticket{tickets.length === 1 ? '' : 's'} raised · {solvedTickets.length} solved · {openTickets.length} still open.</p>
          <p className="mt-1">Press ↺ to replay the scenario.</p>
        </div>
      )}
    </div>
  );
}
