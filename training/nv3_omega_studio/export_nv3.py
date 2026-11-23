"""Export distilled NV3BrowserCore to compact Int8/Float32 browser-ready nv3-weights.json."""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np

from .model_nv3 import NV3BrowserCore
from .spec import EGO_OBS_DIM, ENTITY_DIM, NUM_ENTITIES, NV3_SCHEMA, NV3_VERSION


def _enc_f32(arr: np.ndarray) -> Dict[str, Any]:
    a = np.ascontiguousarray(arr, dtype=np.float32)
    return {
        "dtype": "f32",
        "shape": list(a.shape),
        "data": base64.b64encode(a.tobytes()).decode("ascii"),
    }


def _enc_q8(arr: np.ndarray) -> Dict[str, Any]:
    a = np.ascontiguousarray(arr, dtype=np.float32)
    max_abs = np.max(np.abs(a), axis=1)
    scales = np.where(max_abs > 1e-8, max_abs / 127.0, 1.0).astype(np.float32)
    q = np.clip(np.round(a / scales[:, None]), -127, 127).astype(np.int8)
    return {
        "dtype": "q8",
        "shape": list(a.shape),
        "scales": base64.b64encode(scales.tobytes()).decode("ascii"),
        "data": base64.b64encode(q.tobytes()).decode("ascii"),
    }


NV3_MAT_KEYS = (
    "ego_fc.weight", "ent_fc.weight",
    "attn_q.weight", "attn_k.weight", "attn_v.weight", "attn_o.weight",
    "fuse_fc.weight", "gru.weight_ih", "gru.weight_hh",
    "head_intent.weight", "head_social.weight", "head_aim.weight",
    "head_move.weight", "head_aim_res.weight", "head_bin.weight",
    "head_util.weight", "head_emotion.weight", "aux_danger.weight",
)

NV3_VEC_KEYS = (
    "ego_fc.bias", "ego_ln.weight", "ego_ln.bias",
    "ent_fc.bias", "ent_ln.weight", "ent_ln.bias",
    "attn_q.bias", "attn_k.bias", "attn_v.bias", "attn_o.bias",
    "fuse_fc.bias", "fuse_ln.weight", "fuse_ln.bias",
    "gru.bias_ih", "gru.bias_hh",
    "head_intent.bias", "head_social.bias", "head_aim.bias",
    "head_move.bias", "head_aim_res.bias", "head_bin.bias",
    "head_util.bias", "head_emotion.bias", "aux_danger.bias",
)


def browser_core_to_bundle(
    core: NV3BrowserCore,
    quantize: str = "q8",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    use_q8 = quantize == "q8"
    sd = {k: v.detach().cpu().float().numpy() for k, v in core.state_dict().items()}

    tensors: Dict[str, Any] = {}
    for k in NV3_MAT_KEYS:
        tensors[k] = _enc_q8(sd[k]) if use_q8 else _enc_f32(sd[k])
    for k in NV3_VEC_KEYS:
        tensors[k] = _enc_f32(sd[k])

    param_count = int(sum(int(np.prod(t["shape"])) for t in tensors.values()))
    bundle_meta: Dict[str, Any] = {
        "trained": True,
        "origin": "nv3-omega-a100-studio",
        "quantize": "q8" if use_q8 else "f32",
        "paramCount": param_count,
        "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if meta:
        bundle_meta.update(meta)

    return {
        "version": NV3_VERSION,
        "schema": NV3_SCHEMA,
        "egoObsDim": EGO_OBS_DIM,
        "numEntities": NUM_ENTITIES,
        "entityDim": ENTITY_DIM,
        "egoDim": int(core.ego_dim),
        "entDim": int(core.ent_dim),
        "gruDim": int(core.gru_dim),
        "nHeads": int(core.n_heads),
        "meta": bundle_meta,
        "tensors": tensors,
    }


def save_nv3_bundle(
    core: NV3BrowserCore,
    output_path: str | Path,
    quantize: str = "q8",
    meta: Optional[Dict[str, Any]] = None,
) -> Path:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bundle = browser_core_to_bundle(core, quantize=quantize, meta=meta)
    path.write_text(json.dumps(bundle, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return path


def save_nv3_js_module(
    core: NV3BrowserCore,
    output_js_path: str | Path,
    quantize: str = "q8",
    meta: Optional[Dict[str, Any]] = None,
) -> Path:
    path = Path(output_js_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bundle = browser_core_to_bundle(core, quantize=quantize, meta=meta)
    payload = json.dumps(bundle, separators=(",", ":"), ensure_ascii=False)
    content = (
        "// Auto-generated NV 3 Sentient Human Neural Policy Weights (Zero-Dependency ES Module)\n"
        f"export const NV3_BUNDLED_WEIGHTS = {payload};\n"
    )
    path.write_text(content, encoding="utf-8")
    return path
