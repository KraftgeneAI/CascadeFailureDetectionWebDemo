"""
Compare Service
===============
Runs the GNN model on a truncated pre-cascade window of a scenario and
returns everything the frontend needs to animate the full timeline and
overlay predicted vs actual cascade failures.

Flow
----
1. Load raw scenario pkl → extract ALL timestep grid states for animation.
2. Use a fixed seed (42) with calculate_truncation_window() to get a
   reproducible (start_idx, end_idx) window — the slice the model sees.
3. Re-seed (42) and call CascadePredictor.predict_scenario() so the
   CascadeDataset inside uses the identical truncation.
4. Compute per-node comparison metrics (TP / FP / FN).
5. Return timesteps[], window indices, model prediction, ground truth.
"""

import numpy as np
import pickle
from typing import Dict, List, Any

from cascade_prediction.data.preprocessing.truncation import calculate_truncation_window
from cascade_prediction.data.generator.config import Settings


class CompareService:
    """
    Wraps CascadePredictor + raw scenario loading to produce all data
    needed for the investor comparison animation.
    """

    def __init__(self, predictor, topo_service, scenario_service):
        """
        Args:
            predictor:        Initialised CascadePredictor instance.
            topo_service:     TopologyService (for node positions).
            scenario_service: ScenarioService (for raw pkl loading).
        """
        self.predictor = predictor
        self.topo = topo_service
        self.scenarios = scenario_service

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def compare(self, scenario_id: int) -> Dict[str, Any]:
        """
        Build the full compare payload for a given scenario.

        Returns
        -------
        {
          start_idx: int,          # first timestep the model sees
          end_idx:   int,          # one-past the last model input timestep
          total_timesteps: int,    # length of the full un-truncated sequence
          cascade_start_time: int, # ground-truth cascade start (timestep index)
          timesteps: [             # ALL timesteps for animation
            {
              nodes: [ {id, power_injection_mw, reactive_injection_mvar,
                        is_failed, voltage_pu, voltage_angle_rad,
                        equipment_temp_c, frequency_hz, equipment_condition} ],
              edges: [ {id, source, target, active_flow_mw,
                        reactive_flow_mvar, thermal_limit_mw} ],
            }
          ],
          cascade_probability: float,
          predicted_cascade_path: [
            {order, node_id, ranking_score, pred_time_minutes}
          ],
          ground_truth_cascade_path: [
            {node_id, time_minutes, failure_timestep}
          ],
          metrics: {
            true_positives:  [node_id, …],
            false_positives: [node_id, …],
            false_negatives: [node_id, …],
            precision: float,
            recall:    float,
            f1:        float,
          }
        }
        """
        raw = self.scenarios.load_raw_scenario(scenario_id)
        sequence = raw['sequence']
        metadata = raw.get('metadata', {})
        edge_index = raw['edge_index']          # (2, E)
        thermal_limits: np.ndarray = sequence[0]['thermal_limits']  # (E,)

        total_timesteps = len(sequence)
        cascade_start_time = int(metadata.get('cascade_start_time', -1))
        is_cascade = bool(metadata.get('is_cascade', False))

        # ── 1. Reproducible truncation window ─────────────────────────
        np.random.seed(42)
        start_idx, end_idx = calculate_truncation_window(
            total_timesteps,
            cascade_start_time,
            is_cascade,
        )

        # ── 2. All-timestep grid states (for animation) ────────────────
        timesteps = self._extract_all_timesteps(
            sequence, edge_index, thermal_limits
        )

        # ── 3. Model prediction (re-seed so dataset uses same window) ──
        np.random.seed(42)
        pred = self.predictor.predict_scenario(
            data_path=str(self.scenarios.data_dir),
            scenario_idx=scenario_id,
        )

        predicted_path = pred.get('cascade_path', [])
        predicted_node_ids = {int(s['node_id']) for s in predicted_path}

        # ── 4. Ground-truth path ───────────────────────────────────────
        gt_nodes: List[int] = [int(n) for n in metadata.get('failed_nodes', [])]
        gt_times: List[float] = list(metadata.get('failure_times', []))
        gt_reasons: List[str] = [str(r) for r in metadata.get('failure_reasons', [])]
        DT = Settings.Thermal.DT_MINUTES

        gt_path = sorted([
            {
                'node_id': n,
                'failure_timestep': int(t),
                'time_minutes': float(t) * DT,
                'reason': r,
            }
            for n, t, r in zip(gt_nodes, gt_times, gt_reasons)
        ], key=lambda x: x['time_minutes'])

        gt_node_ids = set(gt_nodes)

        # ── 5. Metrics ─────────────────────────────────────────────────
        tp = sorted(predicted_node_ids & gt_node_ids)
        fp = sorted(predicted_node_ids - gt_node_ids)
        fn = sorted(gt_node_ids - predicted_node_ids)

        precision = len(tp) / max(1, len(tp) + len(fp))
        recall    = len(tp) / max(1, len(tp) + len(fn))
        f1        = (2 * precision * recall / max(1e-9, precision + recall))

        return {
            'start_idx': int(start_idx),
            'end_idx': int(end_idx),
            'total_timesteps': int(total_timesteps),
            'cascade_start_time': cascade_start_time,
            'is_cascade': is_cascade,
            'timesteps': timesteps,
            'cascade_probability': float(pred.get('cascade_probability', 0.0)),
            'cascade_detected': bool(pred.get('cascade_detected', False)),
            'predicted_cascade_path': predicted_path,
            'ground_truth_cascade_path': gt_path,
            'metrics': {
                'true_positives':  tp,
                'false_positives': fp,
                'false_negatives': fn,
                'precision': round(precision, 4),
                'recall':    round(recall, 4),
                'f1':        round(f1, 4),
            },
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _extract_all_timesteps(
        self,
        sequence: List[Dict],
        edge_index: np.ndarray,
        thermal_limits: np.ndarray,
    ) -> List[Dict]:
        """
        Convert every raw timestep dict into a frontend-ready grid state.
        Mirrors the logic in ScenarioService.get_scenario but for all T steps.
        """
        topo_nodes = self.topo.nodes    # list of {id, x, y}
        topo_edges = self.topo.edges    # list of {id, source, target}

        result = []
        for ts in sequence:
            power_injection   = ts.get('power_injection',   np.zeros(len(topo_nodes)))
            reactive_injection = ts.get('reactive_injection', np.zeros(len(topo_nodes)))
            node_labels       = ts.get('node_labels',       np.zeros(len(topo_nodes)))
            scada             = ts.get('scada_data',        np.zeros((len(topo_nodes), 18), dtype=np.float32))
            edge_attr         = ts.get('edge_attr',         np.zeros((len(topo_edges), 7), dtype=np.float32))

            nodes = []
            for i, base in enumerate(topo_nodes):
                nodes.append({
                    **base,
                    'power_injection_mw':      float(power_injection[i]),
                    'reactive_injection_mvar': float(reactive_injection[i]),
                    'is_failed':               bool(node_labels[i] > 0.5),
                    'voltage_pu':              float(scada[i, 0]) if scada.shape[1] > 0 else 1.0,
                    'voltage_angle_rad':       float(scada[i, 1]) if scada.shape[1] > 1 else 0.0,
                    'equipment_temp_c':        float(scada[i, 5]) if scada.shape[1] > 5 else 25.0,
                    'frequency_hz':            float(scada[i, 6]) if scada.shape[1] > 6 else 60.0,
                    'equipment_condition':     float(scada[i, 8]) if scada.shape[1] > 8 else 1.0,
                })

            edges = []
            for i, base in enumerate(topo_edges):
                edges.append({
                    **base,
                    'active_flow_mw':    float(edge_attr[i, 5]) if edge_attr.shape[1] > 5 else 0.0,
                    'reactive_flow_mvar': float(edge_attr[i, 6]) if edge_attr.shape[1] > 6 else 0.0,
                    'thermal_limit_mw':  float(thermal_limits[i]),
                })

            result.append({'nodes': nodes, 'edges': edges})

        return result
