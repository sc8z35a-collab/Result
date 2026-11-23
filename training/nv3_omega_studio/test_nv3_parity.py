"""Bit-Exact Parity Test: PyTorch `NV3BrowserCore` vs Browser JS `NV3PolicyNet` (`dist/js/nv3.js`)."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import torch

from .export_nv3 import save_nv3_bundle
from .model_nv3 import NV3BrowserCore
from .spec import EGO_OBS_DIM, ENTITY_DIM, NUM_ENTITIES

REPO_ROOT = Path(__file__).resolve().parents[2]


def run_parity_check(quantize: str, tol: float) -> float:
    torch.manual_seed(1337)
    rng = np.random.default_rng(1337)

    core = NV3BrowserCore()
    core.eval()

    T = 5
    egos = rng.standard_normal((T, EGO_OBS_DIM)).astype(np.float32) * 0.5
    ents = rng.standard_normal((T, NUM_ENTITIES, ENTITY_DIM)).astype(np.float32) * 0.5
    # Realistic fair-play validity masks across steps (including step 3 with ZERO valid entities!)
    for t in range(T):
        ents[t, :, 0] = 0.0
        if t != 3:
            ents[t, 0, 0] = 1.0
            ents[t, 1, 0] = 1.0 if (t % 2 == 0) else 0.0
            ents[t, 4, 0] = 1.0
            ents[t, 7, 0] = 1.0
            ents[t, 10, 0] = 1.0

    # PyTorch reference rollout
    h = torch.zeros((1, core.gru_dim), dtype=torch.float32)
    pt_outs = []
    with torch.no_grad():
        for t in range(T):
            e_t = torch.from_numpy(egos[t : t + 1])
            u_t = torch.from_numpy(ents[t : t + 1])
            h, out = core.step(e_t, u_t, h)
            pt_outs.append({
                "intentLogits": out["intent_logits"][0].numpy().tolist(),
                "socialLogits": out["social_logits"][0].numpy().tolist(),
                "aimLogits": out["aim_logits"][0].numpy().tolist(),
                "moveMean": out["move_mean"][0].numpy().tolist(),
                "aimResMean": out["aim_res_mean"][0].numpy().tolist(),
                "binLogits": out["bin_logits"][0].numpy().tolist(),
                "utilLogits": out["util_logits"][0].numpy().tolist(),
                "emotionPred": out["emotion_pred"][0].numpy().tolist(),
                "auxDanger": out["aux_danger"][0].numpy().tolist(),
                "h": h[0].numpy().tolist(),
            })

    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        w_path = save_nv3_bundle(core, td_p / "nv3-weights.json", quantize=quantize)
        inp_path = td_p / "inputs.json"
        inp_path.write_text(json.dumps({"egos": egos.tolist(), "ents": ents.reshape(T, -1).tolist()}), encoding="utf-8")

        js_runner = f"""
import fs from 'node:fs';
import {{ validateNV3Bundle }} from {(REPO_ROOT / 'dist/js/nv3.js').as_uri()!r};

const bundle = JSON.parse(fs.readFileSync({str(w_path)!r}, 'utf8'));
const res = validateNV3Bundle(bundle);
if (!res.ok) throw new Error('validateNV3Bundle failed: ' + res.error);
const net = res.net;
const inp = JSON.parse(fs.readFileSync({str(inp_path)!r}, 'utf8'));
const h = new Float32Array(net.gruDim);
const outs = [];
for (let t = 0; t < inp.egos.length; t++) {{
  const o = net.forward(Float32Array.from(inp.egos[t]), Float32Array.from(inp.ents[t]), h);
  outs.push({{
    intentLogits: Array.from(o.intentLogits),
    socialLogits: Array.from(o.socialLogits),
    aimLogits: Array.from(o.aimLogits),
    moveMean: Array.from(o.moveMean),
    aimResMean: Array.from(o.aimResMean),
    binLogits: Array.from(o.binLogits),
    utilLogits: Array.from(o.utilLogits),
    emotionPred: Array.from(o.emotionPred),
    auxDanger: Array.from(o.auxDanger),
    h: Array.from(h),
  }});
}}
console.log(JSON.stringify(outs));
"""
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", js_runner],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=True,
        )
        js_outs = json.loads(proc.stdout)

    max_err = 0.0
    worst_key = ""
    for t in range(T):
        for k in pt_outs[t]:
            a = np.array(pt_outs[t][k], dtype=np.float64)
            b = np.array(js_outs[t][k], dtype=np.float64)
            err = float(np.max(np.abs(a - b)))
            if err > max_err:
                max_err = err
                worst_key = f"step{t}.{k}"

    print(f"[NV 3 Parity | {quantize:3s}] max_abs_err = {max_err:.6e} (worst={worst_key}, tol={tol:.1e})")
    if max_err > tol:
        raise AssertionError(f"NV 3 parity error {max_err} > {tol} at {worst_key}")
    return max_err


def main() -> None:
    run_parity_check("f32", 2e-5)
    run_parity_check("q8", 0.045)
    print("NV 3 PyTorch <-> Browser JS Parity PASSED!")


if __name__ == "__main__":
    main()
