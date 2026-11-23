"""Export trained RNV1Actor weights to compact browser-ready JSON (Int8 or Float32)."""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import torch

from .model import RNV1Actor
from .spec import RNV1_SCHEMA, RNV1_VERSION


def _encode_f32(arr: np.ndarray) -> Dict[str, Any]:
    a = np.ascontiguousarray(arr, dtype=np.float32)
    return {
        "dtype": "f32",
        "shape": list(a.shape),
        "data": base64.b64encode(a.tobytes()).decode("ascii"),
    }


def _encode_q8_rowwise(arr: np.ndarray) -> Dict[str, Any]:
    """Symmetric per-row Int8 quantization for 2D weight matrices (~4x smaller, <0.003 MAE)."""
    a = np.ascontiguousarray(arr, dtype=np.float32)
    assert a.ndim == 2, f"Expected 2D matrix for q8 quantization, got shape {a.shape}"
    max_abs = np.max(np.abs(a), axis=1)
    scales = np.where(max_abs > 1e-8, max_abs / 127.0, 1.0).astype(np.float32)
    q = np.clip(np.round(a / scales[:, None]), -127, 127).astype(np.int8)
    return {
        "dtype": "q8",
        "shape": list(a.shape),
        "scales": base64.b64encode(scales.tobytes()).decode("ascii"),
        "data": base64.b64encode(q.tobytes()).decode("ascii"),
    }


def actor_to_bundle(
    actor: RNV1Actor,
    quantize: str = "q8",
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Serialize RNV1Actor state_dict into canonical browser-loadable RNV1 JSON bundle."""
    use_q8 = quantize == "q8"
    sd = {k: v.detach().cpu().float().numpy() for k, v in actor.state_dict().items()}

    def pack_mat(name: str) -> Dict[str, Any]:
        return _encode_q8_rowwise(sd[name]) if use_q8 else _encode_f32(sd[name])

    def pack_vec(name: str) -> Dict[str, Any]:
        return _encode_f32(sd[name])

    tensors = {
        "enc_fc.weight": pack_mat("enc_fc.weight"),
        "enc_fc.bias": pack_vec("enc_fc.bias"),
        "enc_ln.weight": pack_vec("enc_ln.weight"),
        "enc_ln.bias": pack_vec("enc_ln.bias"),
        "res_fc.weight": pack_mat("res_fc.weight"),
        "res_fc.bias": pack_vec("res_fc.bias"),
        "res_ln.weight": pack_vec("res_ln.weight"),
        "res_ln.bias": pack_vec("res_ln.bias"),
        "gru.weight_ih": pack_mat("gru.weight_ih"),
        "gru.weight_hh": pack_mat("gru.weight_hh"),
        "gru.bias_ih": pack_vec("gru.bias_ih"),
        "gru.bias_hh": pack_vec("gru.bias_hh"),
        "head_cont.weight": pack_mat("head_cont.weight"),
        "head_cont.bias": pack_vec("head_cont.bias"),
        "head_aim.weight": pack_mat("head_aim.weight"),
        "head_aim.bias": pack_vec("head_aim.bias"),
        "head_bin.weight": pack_mat("head_bin.weight"),
        "head_bin.bias": pack_vec("head_bin.bias"),
        "head_util.weight": pack_mat("head_util.weight"),
        "head_util.bias": pack_vec("head_util.bias"),
    }

    param_count = int(sum(int(np.prod(t["shape"])) for t in tensors.values()))
    bundle_meta: Dict[str, Any] = {
        "trained": True,
        "origin": "colab-a100-studio",
        "quantize": "q8" if use_q8 else "f32",
        "paramCount": param_count,
        "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if meta:
        bundle_meta.update(meta)

    return {
        "version": RNV1_VERSION,
        "schema": RNV1_SCHEMA,
        "obsDim": int(actor.obs_dim),
        "hiddenDim": int(actor.hidden_dim),
        "meta": bundle_meta,
        "tensors": tensors,
    }


def save_actor_bundle(
    actor: RNV1Actor,
    output_path: str | Path,
    quantize: str = "q8",
    meta: Optional[Dict[str, Any]] = None,
) -> Path:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bundle = actor_to_bundle(actor, quantize=quantize, meta=meta)
    path.write_text(json.dumps(bundle, separators=(",", ":")), encoding="utf-8")
    return path


def save_actor_js_module(
    actor: RNV1Actor,
    output_js_path: str | Path,
    quantize: str = "q8",
    meta: Optional[Dict[str, Any]] = None,
) -> Path:
    """Export as an ES module (`export const RNV1_BUNDLED_WEIGHTS = ...`) for zero-fetch loading."""
    path = Path(output_js_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bundle = actor_to_bundle(actor, quantize=quantize, meta=meta)
    payload = json.dumps(bundle, separators=(",", ":"))
    content = (
        "// Auto-generated RNV1 Neural Policy Weights Bundle (Zero-Dependency ES Module)\n"
        f"export const RNV1_BUNDLED_WEIGHTS = {payload};\n"
    )
    path.write_text(content, encoding="utf-8")
    return path
