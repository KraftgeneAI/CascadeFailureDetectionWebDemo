"""
Streaming Service
=================
Stateless windowed GNN inference for the webapp's Streaming (live) mode.

The frontend replays a scenario's timesteps on a timer. Once >= 10 steps
have "arrived", it calls predict_window(scenario_id, end_step) on every
new step. The model batch is built deterministically from the growing
window sequence[0:end_step] — no random truncation, no server-side
session state. Tickets and dedup live in the frontend.
"""

from functools import lru_cache
from typing import Any, Dict

MIN_WINDOW = 10  # model's minimum input length (truncation.minimum_model_length)


class StreamingService:
    def __init__(self, predictor, scenario_service):
        """
        Args:
            predictor:        Initialised CascadePredictor instance.
            scenario_service: ScenarioService (for raw pkl loading / validation).
        """
        self.predictor = predictor
        self.scenarios = scenario_service

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict_window(self, scenario_id: int, end_step: int) -> Dict[str, Any]:
        """
        Run the GNN on sequence[0:end_step] of the given scenario.

        Raises:
            IndexError: unknown scenario_id.
            ValueError: end_step out of range [MIN_WINDOW, total_timesteps].

        Returns:
            {
              scenario_id, end_step, total_timesteps,
              cascade_detected: bool,
              cascade_probability: float,
              risky_nodes: [ {node_id, score, pred_time_minutes} ],
            }
        """
        total_timesteps = self._total_timesteps(scenario_id)

        if end_step < MIN_WINDOW:
            raise ValueError(
                f"end_step must be >= {MIN_WINDOW} (model minimum window), got {end_step}"
            )
        if end_step > total_timesteps:
            raise ValueError(
                f"end_step must be <= total_timesteps ({total_timesteps}), got {end_step}"
            )

        pred = self.predictor.predict_window(
            data_path=str(self.scenarios.data_dir),
            scenario_idx=scenario_id,
            end_step=end_step,
        )

        return {
            "scenario_id": int(scenario_id),
            "end_step": int(end_step),
            "total_timesteps": int(total_timesteps),
            "cascade_detected": bool(pred["cascade_detected"]),
            "cascade_probability": float(pred["cascade_probability"]),
            "risky_nodes": pred["risky_nodes"],
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @lru_cache(maxsize=64)
    def _total_timesteps(self, scenario_id: int) -> int:
        raw = self.scenarios.load_raw_scenario(scenario_id)  # raises IndexError
        return len(raw["sequence"])
