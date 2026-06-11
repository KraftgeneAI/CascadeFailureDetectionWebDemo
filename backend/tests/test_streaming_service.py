"""
Unit tests for StreamingService (streaming-mode windowed inference).

Uses a mock predictor + scenario service so no torch / model checkpoint
is required. Verifies window validation, payload shape, and that the
predictor receives the exact growing window (0..end_step).
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.streaming import StreamingService, MIN_WINDOW


TOTAL_TIMESTEPS = 30


class MockPredictor:
    def __init__(self):
        self.calls = []

    def predict_window(self, data_path, scenario_idx, end_step, start_step=0):
        self.calls.append({
            "data_path": data_path,
            "scenario_idx": scenario_idx,
            "start_step": start_step,
            "end_step": end_step,
        })
        return {
            "cascade_detected": True,
            "cascade_probability": 0.93,
            "risky_nodes": [
                {"node_id": 17, "score": 0.93, "pred_time_minutes": 42.0},
                {"node_id": 5, "score": 0.71, "pred_time_minutes": 55.0},
            ],
        }


class MockScenarioService:
    data_dir = "/tmp/fake_data"

    def load_raw_scenario(self, scenario_id):
        if scenario_id != 0:
            raise IndexError(f"scenario_id {scenario_id} out of range")
        return {"sequence": [{} for _ in range(TOTAL_TIMESTEPS)], "metadata": {}}


@pytest.fixture
def service():
    return StreamingService(predictor=MockPredictor(), scenario_service=MockScenarioService())


def test_valid_window_returns_payload(service):
    result = service.predict_window(0, 10)
    assert result["scenario_id"] == 0
    assert result["end_step"] == 10
    assert result["total_timesteps"] == TOTAL_TIMESTEPS
    assert result["cascade_detected"] is True
    assert result["cascade_probability"] == pytest.approx(0.93)
    assert [n["node_id"] for n in result["risky_nodes"]] == [17, 5]


def test_predictor_receives_growing_window(service):
    service.predict_window(0, 12)
    call = service.predictor.calls[-1]
    assert call["scenario_idx"] == 0
    assert call["end_step"] == 12
    assert call["data_path"] == "/tmp/fake_data"


def test_end_step_below_minimum_rejected(service):
    with pytest.raises(ValueError):
        service.predict_window(0, MIN_WINDOW - 1)


def test_end_step_beyond_sequence_rejected(service):
    with pytest.raises(ValueError):
        service.predict_window(0, TOTAL_TIMESTEPS + 1)


def test_end_step_at_total_accepted(service):
    result = service.predict_window(0, TOTAL_TIMESTEPS)
    assert result["end_step"] == TOTAL_TIMESTEPS


def test_unknown_scenario_raises_index_error(service):
    with pytest.raises(IndexError):
        service.predict_window(99, 10)
