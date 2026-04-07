"""
Scenario Service
================
Lists and loads scenario batch files from the test data directory.
Merges static topology (node positions) with dynamic first-timestep grid state
so callers get a single self-contained response.
"""

import glob
import pickle
import numpy as np
from pathlib import Path
from typing import Dict, List

from .topology import TopologyService


class ScenarioService:
    """
    Provides scenario listing and detail loading.

    Scenario files are expected at:
        <data_dir>/scenarios_batch_*.pkl  (one scenario per file)

    The scenario `id` used by the API is the index into the sorted file list.
    """

    def __init__(self, data_dir: str, topo_service: TopologyService):
        self.data_dir = data_dir
        self.topo = topo_service

        # Build sorted file index once
        self._files: List[str] = sorted(
            glob.glob(f"{data_dir}/scenarios_batch_*.pkl")
        )
        if not self._files:
            self._files = sorted(glob.glob(f"{data_dir}/scenario_*.pkl"))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_scenarios(self) -> List[Dict]:
        """Return a lightweight summary for every scenario."""
        results = []
        for i, filepath in enumerate(self._files):
            scenario = self._load_file(filepath)
            meta = scenario.get("metadata", {})
            results.append(
                {
                    "id": i,
                    "filename": Path(filepath).name,
                    "is_cascade": bool(meta.get("is_cascade", False)),
                    "stress_level": float(meta.get("stress_level", 0.0)),
                    "num_failed_nodes": len(meta.get("failed_nodes", [])),
                    "cascade_start_time": int(meta.get("cascade_start_time", -1)),
                }
            )
        return results

    def get_scenario(self, scenario_id: int) -> Dict:
        """
        Return full scenario detail: topology + all timestep grid states + metadata.

        Args:
            scenario_id: Index into the sorted scenario file list.

        Returns:
            Dict with keys: id, metadata, ground_truth_cascade_path,
            grid_state (t=0, kept for backwards compat), all_timesteps (all T
            frames for the normal-mode timeline scrubber), total_timesteps.
        """
        scenario = self._load_by_id(scenario_id)
        meta = scenario.get("metadata", {})
        sequence = scenario["sequence"]
        thermal_limits: np.ndarray = sequence[0]["thermal_limits"]

        # ---- all timesteps (normal-mode timeline) -------------------------
        all_timesteps = [
            self._build_grid_state(ts, thermal_limits)
            for ts in sequence
        ]

        # ---- ground truth cascade path ------------------------------------
        failed_nodes = meta.get("failed_nodes", [])
        failure_times = meta.get("failure_times", [])
        failure_reasons = meta.get("failure_reasons", [])

        ground_truth_path = sorted(
            [
                {
                    "node_id": int(n),
                    "failure_time": float(t),
                    "reason": str(r),
                }
                for n, t, r in zip(failed_nodes, failure_times, failure_reasons)
            ],
            key=lambda x: x["failure_time"],
        )

        return {
            "id": scenario_id,
            "metadata": {
                "is_cascade": bool(meta.get("is_cascade", False)),
                "stress_level": float(meta.get("stress_level", 0.0)),
                "cascade_start_time": int(meta.get("cascade_start_time", -1)),
                "num_nodes": int(meta.get("num_nodes", self.topo.num_nodes)),
                "num_edges": int(meta.get("num_edges", self.topo.num_edges)),
                "base_mva": float(meta.get("base_mva", 1000.0)),
            },
            "ground_truth_cascade_path": ground_truth_path,
            # t=0 state kept for backwards compatibility
            "grid_state": all_timesteps[0],
            # full timeline for the normal-mode scrubber
            "all_timesteps": all_timesteps,
            "total_timesteps": len(all_timesteps),
        }

    def _build_grid_state(
        self,
        ts: Dict,
        thermal_limits: np.ndarray,
    ) -> Dict:
        """
        Convert one raw timestep dict into a frontend-ready {nodes, edges} dict.
        Used by get_scenario for all_timesteps and by CompareService.
        """
        power_injection: np.ndarray = ts.get(
            "power_injection", np.zeros(len(self.topo.nodes))
        )
        reactive_injection: np.ndarray = ts.get(
            "reactive_injection", np.zeros(len(self.topo.nodes))
        )
        node_labels: np.ndarray = ts.get(
            "node_labels", np.zeros(len(self.topo.nodes))
        )
        scada: np.ndarray = ts.get(
            "scada_data",
            np.zeros((len(self.topo.nodes), 18), dtype=np.float32),
        )
        edge_attr: np.ndarray = ts.get(
            "edge_attr",
            np.zeros((len(self.topo.edges), 7), dtype=np.float32),
        )

        nodes = []
        for i, base in enumerate(self.topo.nodes):
            nodes.append({
                **base,
                "power_injection_mw":      float(power_injection[i]),
                "reactive_injection_mvar": float(reactive_injection[i]),
                "is_failed":               bool(node_labels[i] > 0.5),
                "voltage_pu":              float(scada[i, 0]) if scada.shape[1] > 0 else 1.0,
                "voltage_angle_rad":       float(scada[i, 1]) if scada.shape[1] > 1 else 0.0,
                "equipment_temp_c":        float(scada[i, 5]) if scada.shape[1] > 5 else 25.0,
                "frequency_hz":            float(scada[i, 6]) if scada.shape[1] > 6 else 60.0,
                "equipment_condition":     float(scada[i, 8]) if scada.shape[1] > 8 else 1.0,
            })

        edges = []
        for i, base in enumerate(self.topo.edges):
            edges.append({
                **base,
                "active_flow_mw":     float(edge_attr[i, 5]) if edge_attr.shape[1] > 5 else 0.0,
                "reactive_flow_mvar": float(edge_attr[i, 6]) if edge_attr.shape[1] > 6 else 0.0,
                "thermal_limit_mw":   float(thermal_limits[i]),
            })

        return {"nodes": nodes, "edges": edges}

    def load_raw_scenario(self, scenario_id: int) -> Dict:
        """
        Load and return the raw scenario dict (for cascade service use).
        Attaches edge_index from the topology file if not already present.
        """
        scenario = self._load_by_id(scenario_id)
        # Ensure edge_index is a numpy array (topology pkl stores it as ndarray)
        if not isinstance(scenario.get("edge_index"), np.ndarray):
            scenario["edge_index"] = self.topo.edge_index
        return scenario

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_file(self, filepath: str) -> Dict:
        with open(filepath, "rb") as f:
            data = pickle.load(f)
        return data[0] if isinstance(data, list) else data

    def _load_by_id(self, scenario_id: int) -> Dict:
        if scenario_id < 0 or scenario_id >= len(self._files):
            raise IndexError(
                f"scenario_id {scenario_id} out of range "
                f"(0 – {len(self._files) - 1})"
            )
        return self._load_file(self._files[scenario_id])
