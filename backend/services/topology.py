"""
Topology Service
================
Loads grid_topology.pkl once and exposes node positions and edge connectivity
in a JSON-friendly format for use by both the scenario service and API routes.
"""

import pickle
import numpy as np
from typing import Dict, List


class TopologyService:
    """
    Loads and caches the static grid topology (positions + edges).

    All scenarios share the same IEEE 118-bus topology, so this is loaded
    once at startup and referenced everywhere.
    """

    def __init__(self, topology_path: str):
        with open(topology_path, "rb") as f:
            topo = pickle.load(f)

        positions: np.ndarray = topo["positions"]   # (118, 2)
        edge_index: np.ndarray = topo["edge_index"] # (2, 686)

        self.num_nodes: int = positions.shape[0]
        self.num_edges: int = edge_index.shape[1]

        # Node list: id + geographic position
        self.nodes: List[Dict] = [
            {"id": i, "x": float(positions[i, 0]), "y": float(positions[i, 1])}
            for i in range(self.num_nodes)
        ]

        # Edge list: id + source/target node ids
        src, dst = edge_index
        self.edges: List[Dict] = [
            {"id": i, "source": int(src[i]), "target": int(dst[i])}
            for i in range(self.num_edges)
        ]

        # Keep raw arrays for other services
        self.edge_index: np.ndarray = edge_index
        self.positions: np.ndarray = positions

    def get_topology(self) -> Dict:
        """Return the static topology (nodes + edges) as a plain dict."""
        return {"nodes": self.nodes, "edges": self.edges}
