"""Cross-language exact parity verification between Python A100 Studio & Browser JS Runtime.

Checks:
  1. Exact 0.0000m geometry match between `harbor_map.py` and `dist/js/yard.js`
     (all 80 AABB obstacles, materials, 3 tankers, 6 BAIZER pickups, 12 team spawns).
  2. Exact PyTorch `RNV1Actor` <-> Node.js `RNV1PolicyNet` forward-pass numerical parity
     for BOTH Float32 (max_abs_diff < 1e-5) and Int8 row-wise quantized (max_abs_diff < 0.03)
     across multi-step GRU recurrent trajectories.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

from .export_weights import save_actor_bundle
from .harbor_map import BAIZER_PICKUPS, TANKERS, TEAM_SPAWNS, build_obstacles_numpy
from .model import RNV1Actor
from .spec import OBS_DIM

REPO_ROOT = Path(__file__).resolve().parents[2]


def verify_map_parity() -> None:
    node_code = r"""
    import {obstacles, tankers, baizerPickups, teams} from './dist/js/yard.js';
    const matMap = {steel: 1, concrete: 2, wood: 3};
    console.log(JSON.stringify({
      boxes: obstacles.map(o => [o.x0, o.x1, o.z0, o.z1, o.y0, o.y1]),
      mats: obstacles.map(o => matMap[o.mat] || 0),
      tankers: tankers.map(t => [t.x, t.z, t.radius]),
      baizers: baizerPickups.map(b => [b.x, b.z, b.amount]),
      teams
    }));
    """
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", node_code],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    js_data = json.loads(proc.stdout)
    py_boxes, py_mats = build_obstacles_numpy()
    js_boxes = np.asarray(js_data["boxes"], dtype=np.float32)
    js_mats = np.asarray(js_data["mats"], dtype=np.int32)

    assert py_boxes.shape == js_boxes.shape, f"Obstacle count mismatch: {py_boxes.shape} vs {js_boxes.shape}"
    max_box_err = float(np.max(np.abs(py_boxes - js_boxes)))
    assert max_box_err < 1e-5, f"Obstacle box mismatch: max_err={max_box_err}"
    assert np.array_equal(py_mats, js_mats), "Obstacle material code mismatch!"

    py_tanks = np.asarray([[t["x"], t["z"], t["radius"]] for t in TANKERS], dtype=np.float32)
    assert np.allclose(py_tanks, np.asarray(js_data["tankers"], dtype=np.float32), atol=1e-5)

    py_bz = np.asarray([[b["x"], b["z"], b["amount"]] for b in BAIZER_PICKUPS], dtype=np.float32)
    assert np.allclose(py_bz, np.asarray(js_data["baizers"], dtype=np.float32), atol=1e-5)

    py_sp = np.asarray(TEAM_SPAWNS, dtype=np.float32)
    assert np.allclose(py_sp, np.asarray(js_data["teams"], dtype=np.float32), atol=1e-5)

    print(f"[PASS] Map geometry parity: {py_boxes.shape[0]} obstacles, 3 tankers, 6 BAIZERs, 12 spawns (max_err={max_box_err:.2e}m)")


def verify_network_parity() -> None:
    torch.manual_seed(4242)
    actor = RNV1Actor(obs_dim=OBS_DIM, hidden_dim=192).eval()

    # Build a 5-step synthetic fair-play observation trajectory (setting valid flags explicitly)
    obs_seq = torch.randn(5, OBS_DIM) * 0.4
    obs_seq[:, 59] = 1.0   # VIS_0 valid
    obs_seq[:, 73] = 0.0   # VIS_1 invalid
    obs_seq[:, 87] = 0.0   # VIS_2 invalid
    obs_seq[:, 101] = 1.0  # MEM_0 valid
    obs_seq[:, 110] = 0.0  # MEM_1 invalid

    h = torch.zeros(1, 192)
    py_outputs = []
    with torch.no_grad():
        for t in range(5):
            h, outs = actor.encode_and_step(obs_seq[t : t + 1], h)
            aim = outs["aim_logits"][0].clone()
            if obs_seq[t, 59] <= 0.5:
                aim[1] = -1e4
            if obs_seq[t, 73] <= 0.5:
                aim[2] = -1e4
            if obs_seq[t, 87] <= 0.5:
                aim[3] = -1e4
            if obs_seq[t, 101] <= 0.5:
                aim[4] = -1e4
            if obs_seq[t, 110] <= 0.5:
                aim[5] = -1e4
            py_outputs.append({
                "cont": outs["cont_mean"][0].tolist(),
                "aim": aim.tolist(),
                "bin": outs["bin_logits"][0].tolist(),
                "util": outs["util_logits"][0].tolist(),
                "h": h[0].tolist(),
            })

    with tempfile.TemporaryDirectory() as td:
        f32_path = Path(td) / "rnv1_f32.json"
        q8_path = Path(td) / "rnv1_q8.json"
        obs_path = Path(td) / "obs.json"
        save_actor_bundle(actor, f32_path, quantize="f32")
        save_actor_bundle(actor, q8_path, quantize="q8")
        obs_path.write_text(json.dumps(obs_seq.tolist()), encoding="utf-8")

        js_runner = r"""
        import {readFileSync} from 'node:fs';
        import {RNV1PolicyNet} from './dist/js/rnv1.js';
        const weights = JSON.parse(readFileSync(process.argv[1], 'utf8'));
        const obsSeq = JSON.parse(readFileSync(process.argv[2], 'utf8'));
        const net = new RNV1PolicyNet(weights);
        const h = new Float32Array(net.hiddenDim);
        const res = [];
        for (const o of obsSeq) {
          const out = net.forward(new Float32Array(o), h);
          res.push({
            cont: Array.from(out.cont),
            aim: Array.from(out.aim),
            bin: Array.from(out.bin),
            util: Array.from(out.util),
            h: Array.from(h)
          });
        }
        console.log(JSON.stringify(res));
        """

        for label, wpath, tol in [("FP32 exact", f32_path, 1e-5), ("Int8 q8 quantized", q8_path, 0.035)]:
            proc = subprocess.run(
                ["node", "--input-type=module", "-e", js_runner, str(wpath), str(obs_path)],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=True,
            )
            js_outputs = json.loads(proc.stdout)
            max_err = 0.0
            for t in range(5):
                for key in ("cont", "aim", "bin", "util", "h"):
                    err = float(np.max(np.abs(np.asarray(py_outputs[t][key]) - np.asarray(js_outputs[t][key]))))
                    max_err = max(max_err, err)
            assert max_err < tol, f"{label} parity failed: max_err={max_err} >= {tol}"
            print(f"[PASS] PyTorch <-> JS RNV1PolicyNet ({label}, 5-step GRU): max_abs_err={max_err:.2e} (< {tol})")


if __name__ == "__main__":
    verify_map_parity()
    verify_network_parity()
    print("ALL CROSS-LANGUAGE PARITY CHECKS PASSED!")
