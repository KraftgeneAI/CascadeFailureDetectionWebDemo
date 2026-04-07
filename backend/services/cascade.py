"""
Cascade Service
===============
Wraps two distinct capabilities:

1. GNN-based prediction  (POST /api/predict)
   Uses CascadePredictor to run the trained Graph Neural Network on a full
   30-timestep scenario and return failure probabilities, cascade path, and
   7-D risk scores.

2. Physics-based cascade simulation  (POST /api/cascade)
   Uses CascadeSimulator.propagate_cascade_physics() — a BFS with AC power-flow
   recomputation after every failure — to answer the question:
     "If node X fails at t=0, what cascade follows?"

   PhysicsBasedGridSimulator is initialised at startup with the same topology
   file and seed (42) used to generate the dataset, so failure thresholds are
   deterministic and consistent with the training data.
"""

import numpy as np
import torch
from typing import Dict, List, Tuple

from cascade_prediction.inference import CascadePredictor
from cascade_prediction.data.generator.simulator import PhysicsBasedGridSimulator
from cascade_prediction.data.generator.config import Settings


class CascadeService:
    def __init__(
        self,
        topology_path: str,
        model_path: str,
        data_path: str,
    ):
        self.data_path = data_path
        device = torch.device("cpu")

        # ---- GNN predictor (for /api/predict) ----------------------------
        print("Loading CascadePredictor (GNN model)...")
        self.predictor = CascadePredictor(
            model_path=model_path,
            topology_path=topology_path,
            device=device,
        )

        # ---- Physics simulator (for /api/cascade) ------------------------
        # Reinitialising PhysicsBasedGridSimulator with the same seed used
        # during data generation reproduces the identical failure thresholds,
        # thermal limits, and adjacency weights deterministically.
        print("Initialising PhysicsBasedGridSimulator (seed=42)...")
        self.grid_sim = PhysicsBasedGridSimulator(
            num_nodes=Settings.Topology.DEFAULT_NUM_NODES,
            seed=Settings.Scenario.DEFAULT_SEED,
            topology_file=topology_path,
        )
        print("CascadeService ready.")

        # Scenario service reference — set by main.py after both services
        # are constructed (avoids circular dependency).
        self._scenario_service = None

    def set_scenario_service(self, scenario_service) -> None:
        self._scenario_service = scenario_service

    # ------------------------------------------------------------------
    # /api/predict  — GNN inference
    # ------------------------------------------------------------------

    def predict_scenario(self, scenario_id: int) -> Dict:
        """
        Run the trained GNN on the full scenario sequence.

        Args:
            scenario_id: Index into the sorted scenario file list.

        Returns:
            Dict with cascade_detected, cascade_probability, cascade_path,
            top_nodes (with 7-D risk breakdown), and system_state.
        """
        return self.predictor.predict_scenario(
            data_path=self.data_path,
            scenario_idx=scenario_id,
        )

    # ------------------------------------------------------------------
    # /api/cascade  — physics-based cascade simulation
    # ------------------------------------------------------------------

    def simulate_cascade(
        self,
        scenario_id: int,
        node_id: int,
        timestep: int = 0,
    ) -> Dict:
        """
        Simulate cascade propagation starting from a manually failed node.

        Steps:
          1. Load the scenario and read physics state from sequence[timestep].
          2. Split power_injection into generation / load vectors.
          3. Call propagate_cascade_physics() — BFS with per-step AC power flow.
          4. Return the ordered failure sequence.

        Args:
            scenario_id: Scenario to use as initial grid state.
            node_id:     Node to forcibly fail.
            timestep:    Which timestep's grid state to use as the starting
                         conditions (0-based, defaults to 0).

        Returns:
            Dict with trigger_node, timestep, cascade_path (ordered list of
            failures), and total_failures count.
        """
        scenario = self._scenario_service.load_raw_scenario(scenario_id)
        sequence = scenario["sequence"]

        # Clamp timestep to valid range
        timestep = max(0, min(timestep, len(sequence) - 1))
        ts0 = sequence[timestep]

        # ---- extract physics state from the chosen timestep -------------
        # power_injection is net injection (positive = generation surplus,
        # negative = load surplus).  Split into separate arrays for PyPSA.
        power_injection: np.ndarray = np.array(ts0["power_injection"], dtype=float)
        generation: np.ndarray = np.maximum(power_injection, 0.0)
        load: np.ndarray = np.maximum(-power_injection, 0.0)

        # Use scenario's stored thermal limits (same values as grid_sim but
        # taken directly from the data for consistency).
        thermal_limits: np.ndarray = np.array(ts0["thermal_limits"], dtype=float)

        # edge_index: load_raw_scenario() guarantees this is a numpy ndarray.
        edge_index: np.ndarray = scenario["edge_index"]

        # Default temperature and frequency (no per-node scalars in sequence).
        temperature: np.ndarray = np.full(
            self.grid_sim.num_nodes,
            Settings.Thermal.AMBIENT_TEMP_C,
            dtype=float,
        )
        frequency: float = float(Settings.PowerSystem.BASE_FREQUENCY)

        # Allow cascade to propagate to at most all nodes in the grid.
        target_failures: int = self.grid_sim.num_nodes

        # ---- physics-based BFS cascade -----------------------------------
        failure_sequence: List[Tuple[int, float, str]] = (
            self.grid_sim.cascade_sim.propagate_cascade_physics(
                initial_failed_nodes=[(node_id, "manual_trigger")],
                generation=generation,
                load=load,
                current_temperature=temperature,
                current_frequency=frequency,
                target_num_failures=target_failures,
                power_flow_simulator=self.grid_sim.power_flow_sim,
                edge_index=edge_index,
                thermal_limits=thermal_limits,
            )
        )

        # ---- format result -----------------------------------------------
        # propagate_cascade_physics() already places the trigger node first
        # in failure_sequence with time=0.0.
        cascade_path = [
            {
                "order": i + 1,
                "node_id": int(nid),
                "failure_time_minutes": round(float(ftime), 3),
                "reason": str(reason),
                "is_trigger": int(nid) == node_id,
            }
            for i, (nid, ftime, reason) in enumerate(failure_sequence)
        ]

        return {
            "scenario_id": scenario_id,
            "trigger_node": node_id,
            "timestep": timestep,
            "total_failures": len(cascade_path),
            "cascade_path": cascade_path,
        }
