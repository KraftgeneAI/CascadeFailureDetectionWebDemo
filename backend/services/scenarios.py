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
        Return full scenario detail: topology + first-timestep grid state + metadata.

        Args:
            scenario_id: Index into the sorted scenario file list.

        Returns:
            Dict with keys: id, metadata, ground_truth_cascade_path, grid_state.
            grid_state.nodes includes topology positions and t=0 physics values.
            grid_state.edges includes topology connectivity and t=0 line flows.
        """
        scenario = self._load_by_id(scenario_id)
        meta = scenario.get("metadata", {})
        ts0 = scenario["sequence"][0]

        # ---- per-node state ------------------------------------------------
        power_injection: np.ndarray = ts0["power_injection"]       # (N,) MW
        reactive_injection: np.ndarray = ts0["reactive_injection"]  # (N,) MVAr
        node_labels: np.ndarray = ts0["node_labels"]                # (N,) 0/1

        nodes = []
        for i, base in enumerate(self.topo.nodes):
            nodes.append(
                {
                    **base,
                    "power_injection_mw": float(power_injection[i]),
                    "reactive_injection_mvar": float(reactive_injection[i]),
                    "is_failed": bool(node_labels[i] > 0.5),
                }
            )

        # ---- per-edge state ------------------------------------------------
        edge_attr: np.ndarray = ts0["edge_attr"]         # (E, 7)
        thermal_limits: np.ndarray = ts0["thermal_limits"]  # (E,)

        # edge_attr columns (from data inspection):
        #   col 0 — line reactance
        #   col 1 — thermal limit (MW)  [same values as thermal_limits array]
        #   col 2 — resistance / susceptance
        #   col 5 — active power flow (MW, can be negative for reverse flow)
        #   col 6 — reactive power flow (MVAr)
        edges = []
        for i, base in enumerate(self.topo.edges):
            edges.append(
                {
                    **base,
                    "active_flow_mw": float(edge_attr[i, 5]) if edge_attr.shape[1] > 5 else 0.0,
                    "reactive_flow_mvar": float(edge_attr[i, 6]) if edge_attr.shape[1] > 6 else 0.0,
                    "thermal_limit_mw": float(thermal_limits[i]),
                }
            )

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
            "grid_state": {
                "nodes": nodes,
                "edges": edges,
            },
        }

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
