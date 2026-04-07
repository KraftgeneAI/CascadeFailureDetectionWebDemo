"""
Power Grid Digital Twin — FastAPI Backend
==========================================
Adds CascadeFailureDetection/ to sys.path so the cascade_prediction package
is importable without installing it or modifying the library.

Routes
------
  GET  /api/scenarios            List all test scenarios (lightweight summary)
  GET  /api/scenario/{id}        Full scenario detail (topology + t=0 grid state)
  POST /api/predict              GNN inference on a scenario
  POST /api/cascade              Physics-based cascade from a manually failed node
"""

import sys
import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Make cascade_prediction importable from the sibling library folder.
# This runs before any cascade_prediction imports below.
# ---------------------------------------------------------------------------
CASCADE_LIB = Path(__file__).parent.parent / "CascadeFailureDetection"
sys.path.insert(0, str(CASCADE_LIB))

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.topology import TopologyService
from services.scenarios import ScenarioService
from services.cascade import CascadeService
from services.compare import CompareService

# ---------------------------------------------------------------------------
# Paths (relative to the library root, resolved at startup)
# ---------------------------------------------------------------------------
DATA_DIR      = CASCADE_LIB / "data" / "test"
TOPOLOGY_PATH = CASCADE_LIB / "data" / "grid_topology.pkl"
MODEL_PATH    = CASCADE_LIB / "checkpoints" / "best_model.pth"

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Power Grid Digital Twin",
    description="REST API for cascade failure prediction and simulation.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Numpy-aware JSON serialisation helper
# ---------------------------------------------------------------------------
class _NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
        return super().default(obj)


def _jsonable(obj):
    """Round-trip through JSON to strip any numpy types from nested dicts."""
    return json.loads(json.dumps(obj, cls=_NumpyEncoder))


# ---------------------------------------------------------------------------
# Service singletons — initialised once at startup
# ---------------------------------------------------------------------------
topo_service: TopologyService = None
scenario_service: ScenarioService = None
cascade_service: CascadeService = None
compare_service: CompareService = None


@app.on_event("startup")
async def _startup():
    global topo_service, scenario_service, cascade_service, compare_service

    topo_service = TopologyService(str(TOPOLOGY_PATH))
    scenario_service = ScenarioService(str(DATA_DIR), topo_service)

    cascade_service = CascadeService(
        topology_path=str(TOPOLOGY_PATH),
        model_path=str(MODEL_PATH),
        data_path=str(DATA_DIR),
    )
    # Give cascade_service a reference to scenario_service so the cascade
    # route can load raw scenarios without duplicating file-loading logic.
    cascade_service.set_scenario_service(scenario_service)

    compare_service = CompareService(
        predictor=cascade_service.predictor,
        topo_service=topo_service,
        scenario_service=scenario_service,
    )


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------
class PredictRequest(BaseModel):
    scenario_id: int


class CascadeRequest(BaseModel):
    scenario_id: int
    node_id: int
    timestep: int = 0   # which timestep's grid state to use as starting conditions


class CompareRequest(BaseModel):
    scenario_id: int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/scenarios", summary="List all scenarios")
def list_scenarios():
    """
    Return a lightweight summary for every test scenario.

    Each entry contains:
    - id: integer index used in all other routes
    - is_cascade: whether a cascade actually occurs in ground truth
    - stress_level: normalised load stress (0–1)
    - num_failed_nodes: ground-truth failure count
    - cascade_start_time: timestep when the cascade begins (-1 if no cascade)
    """
    return scenario_service.list_scenarios()


@app.get("/api/scenario/{scenario_id}", summary="Get scenario detail")
def get_scenario(scenario_id: int):
    """
    Return full scenario detail for the given id.

    Response includes:
    - metadata (is_cascade, stress_level, etc.)
    - ground_truth_cascade_path: ordered list of actual failures
    - grid_state:
        - nodes: id, x, y position + t=0 power_injection, reactive_injection, is_failed
        - edges: id, source, target + t=0 active_flow_mw, thermal_limit_mw
    """
    try:
        return _jsonable(scenario_service.get_scenario(scenario_id))
    except IndexError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/api/predict", summary="GNN cascade prediction")
def predict(req: PredictRequest):
    """
    Run the trained GNN on the full 30-timestep scenario sequence.

    Returns cascade_detected, cascade_probability, ordered cascade_path,
    per-node risk breakdown (7 dimensions), and system-level physics state.
    """
    try:
        result = cascade_service.predict_scenario(req.scenario_id)
        return _jsonable(result)
    except IndexError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/cascade", summary="Physics-based cascade simulation")
def simulate_cascade(req: CascadeRequest):
    """
    Simulate cascade propagation using physics-based BFS with AC power-flow
    recomputation (propagate_cascade_physics).

    The specified node is forcibly failed at t=0 using the grid state from
    the scenario's first timestep.  The simulator then propagates failures to
    neighbours based on real voltage, loading, and thermal conditions.

    Returns an ordered cascade_path with failure times (minutes) and reasons
    (overload, voltage_collapse, overheating, underfrequency).
    """
    try:
        if req.node_id < 0 or req.node_id >= topo_service.num_nodes:
            raise HTTPException(
                status_code=422,
                detail=f"node_id must be 0–{topo_service.num_nodes - 1}",
            )
        result = cascade_service.simulate_cascade(req.scenario_id, req.node_id, req.timestep)
        return _jsonable(result)
    except HTTPException:
        raise
    except IndexError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/compare", summary="Model prediction vs ground truth comparison")
def compare(req: CompareRequest):
    """
    Truncate the scenario using CascadeDataset's sliding-window logic (seed=42
    for reproducibility), run the GNN on the truncated pre-cascade window, and
    return:

    - All timestep grid states for the frontend animation player
    - start_idx / end_idx: the window the model actually saw
    - cascade_probability and predicted_cascade_path from the GNN
    - ground_truth_cascade_path from scenario metadata
    - Per-node comparison metrics (TP, FP, FN, precision, recall, F1)
    """
    try:
        result = compare_service.compare(req.scenario_id)
        return _jsonable(result)
    except IndexError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
