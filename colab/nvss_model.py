"""NV Super Soldier (NVSS) — PyTorch Universal Entity-Set Transformer Policy Network.

Architecture matches dist/js/nvss.js (NVSSPolicyNet) and dist/js/nvss-weights.js 1:1 so
weights trained on Google Colab Pro GPUs export cleanly into the browser game with zero
external runtime dependencies.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Dict, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

NVSS_WEIGHTS_VERSION = "NVSS-1.0-COLAB-RL"


@dataclass(frozen=True)
class NVSSArch:
    self_dim: int = 24
    entity_dim: int = 16
    cap_dim: int = 8
    d_model: int = 32
    n_heads: int = 4
    d_head: int = 8
    d_ffn: int = 64
    n_tactics: int = 10
    n_motor: int = 6


ARCH = NVSSArch()

NVSS_TACTIC_NAMES = [
    "AGGRO_ENTRY",
    "OFF_ANGLE_HOLD",
    "CREATIVE_FLANK",
    "FAKE_RETREAT_BAIT",
    "GAS_PIPE_TRAP",
    "ANTI_AIR_FOCUS",
    "DRONE_OVERWHELM",
    "RESOURCE_TEMPO",
    "WEATHER_STEALTH",
    "CLUTCH_ISOLATE",
]


def _layer_norm_no_affine(x: torch.Tensor, eps: float = 1e-5) -> torch.Tensor:
    mean = x.mean(dim=-1, keepdim=True)
    var = (x - mean).pow(2).mean(dim=-1, keepdim=True)
    return (x - mean) * torch.rsqrt(var + eps)


class NVSSPolicyNetTorch(nn.Module):
    """Universal Entity-Set Transformer + SwiGLU FFN + Bilinear Future-Feature Capability Head.

    Because all linear weights are stored with exact (in_dim, out_dim) layout matching
    dist/js/nvss.js, exporting a trained Colab Pro GPU checkpoint to nvss-weights.json
    or dist/js/nvss-weights.js is a direct zero-loss tensor copy.
    """

    def __init__(self, arch: NVSSArch = ARCH):
        super().__init__()
        self.arch = arch
        D = arch.d_model

        self.wSelf = nn.Parameter(torch.empty(arch.self_dim, D))
        self.bSelf = nn.Parameter(torch.zeros(D))
        self.wEnt = nn.Parameter(torch.empty(arch.entity_dim, D))
        self.bEnt = nn.Parameter(torch.zeros(D))

        self.wQ = nn.Parameter(torch.empty(D, D))
        self.wK = nn.Parameter(torch.empty(D, D))
        self.wV = nn.Parameter(torch.empty(D, D))
        self.wO = nn.Parameter(torch.empty(D, D))

        self.wGate = nn.Parameter(torch.empty(D, arch.d_ffn))
        self.wUp = nn.Parameter(torch.empty(D, arch.d_ffn))
        self.wDown = nn.Parameter(torch.empty(arch.d_ffn, D))

        self.wTactic = nn.Parameter(torch.empty(D, arch.n_tactics))
        self.bTactic = nn.Parameter(torch.zeros(arch.n_tactics))

        self.wMotor = nn.Parameter(torch.empty(D, arch.n_motor))
        self.bMotor = nn.Parameter(torch.zeros(arch.n_motor))

        self.wCap = nn.Parameter(torch.empty(D, arch.cap_dim))
        self.bCap = nn.Parameter(torch.zeros(arch.cap_dim))

        self.wVal = nn.Parameter(torch.empty(D, 1))
        self.bVal = nn.Parameter(torch.zeros(1))

        # Learnable log-std for continuous biomechanical motor style exploration during PPO
        self.motor_log_std = nn.Parameter(torch.full((arch.n_motor,), -0.65))
        self._init_parameters()

    def _init_parameters(self) -> None:
        for name, p in self.named_parameters():
            if name.startswith("w") and p.ndim == 2:
                nn.init.xavier_uniform_(p, gain=0.75)

    def forward(
        self,
        self_vec: torch.Tensor,
        ent_tokens: torch.Tensor,
        ent_mask: torch.Tensor | None = None,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Forward pass.

        Args:
            self_vec: (B, 24)
            ent_tokens: (B, N, 16)
            ent_mask: optional (B, N) boolean mask where True = valid entity token.

        Returns:
            tactic_logits: (B, 10)
            motor_mean: (B, 6) in (0, 1) via sigmoid
            cap_query: (B, 8) semantic query scored against any capability descriptor
            value: (B,) critic state value estimate
        """
        A = self.arch
        B, N, _ = ent_tokens.shape
        D = A.d_model

        h_self = F.silu(self_vec @ self.wSelf + self.bSelf)  # (B, D)
        h_ent = F.silu(ent_tokens @ self.wEnt + self.bEnt)   # (B, N, D)

        # Concatenate token 0 = self, tokens 1..N = entities -> (B, N+1, D)
        kv_in = torch.cat([h_self.unsqueeze(1), h_ent], dim=1)

        q = (h_self @ self.wQ).view(B, A.n_heads, 1, A.d_head)          # (B, H, 1, Dh)
        k = (kv_in @ self.wK).view(B, N + 1, A.n_heads, A.d_head).transpose(1, 2)
        v = (kv_in @ self.wV).view(B, N + 1, A.n_heads, A.d_head).transpose(1, 2)

        scores = torch.matmul(q, k.transpose(-2, -1)) * (1.0 / math.sqrt(A.d_head))  # (B, H, 1, N+1)
        if ent_mask is not None:
            self_valid = torch.ones((B, 1), dtype=torch.bool, device=ent_mask.device)
            full_mask = torch.cat([self_valid, ent_mask], dim=1).view(B, 1, 1, N + 1)
            scores = scores.masked_fill(~full_mask, -1e4)

        attn_w = F.softmax(scores, dim=-1)
        attn_out = torch.matmul(attn_w, v).squeeze(2).reshape(B, D)  # (B, D)

        ctx = _layer_norm_no_affine(attn_out @ self.wO + h_self)
        ffn = (F.silu(ctx @ self.wGate) * (ctx @ self.wUp)) @ self.wDown
        final_h = _layer_norm_no_affine(ctx + ffn)

        tactic_logits = final_h @ self.wTactic + self.bTactic
        motor_mean = torch.sigmoid(final_h @ self.wMotor + self.bMotor)
        cap_query = final_h @ self.wCap + self.bCap
        value = (final_h @ self.wVal + self.bVal).squeeze(-1)
        return tactic_logits, motor_mean, cap_query, value

    def score_capabilities(self, cap_query: torch.Tensor, cap_descs: torch.Tensor) -> torch.Tensor:
        """Bilinear semantic scoring against variable candidate capability descriptors.

        Args:
            cap_query: (B, 8)
            cap_descs: (B, C, 8)
        Returns:
            logits: (B, C)
        """
        return torch.einsum("bd,bcd->bc", cap_query, cap_descs)

    def export_weights_dict(
        self,
        trained_steps: int,
        trained_matches: int,
        source: str = "colab-pro-gpu",
    ) -> Dict[str, object]:
        """Exports exact JSON-serializable payload compatible with dist/js/nvss-weights.js."""
        keys = [
            "wSelf", "bSelf", "wEnt", "bEnt",
            "wQ", "wK", "wV", "wO",
            "wGate", "wUp", "wDown",
            "wTactic", "bTactic",
            "wMotor", "bMotor",
            "wCap", "bCap",
            "wVal", "bVal",
        ]
        weights_out = {}
        with torch.no_grad():
            for k in keys:
                t = getattr(self, k).detach().float().cpu().contiguous().view(-1)
                weights_out[k] = [round(float(x), 5) for x in t.tolist()]

        return {
            "version": NVSS_WEIGHTS_VERSION,
            "trainedSteps": int(trained_steps),
            "trainedMatches": int(trained_matches),
            "source": source,
            "arch": {
                "selfDim": self.arch.self_dim,
                "entityDim": self.arch.entity_dim,
                "capDim": self.arch.cap_dim,
                "dModel": self.arch.d_model,
                "nHeads": self.arch.n_heads,
                "dHead": self.arch.d_head,
                "dFfn": self.arch.d_ffn,
                "nTactics": self.arch.n_tactics,
                "nMotor": self.arch.n_motor,
            },
            "weights": weights_out,
        }

    def save_browser_files(
        self,
        json_path: str,
        js_path: str | None,
        trained_steps: int,
        trained_matches: int,
        source: str = "colab-pro-gpu",
    ) -> Dict[str, object]:
        payload = self.export_weights_dict(trained_steps, trained_matches, source=source)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"))
        if js_path:
            # Also generate a drop-in JS snippet that auto-loads this trained checkpoint
            with open(js_path, "w", encoding="utf-8") as f:
                f.write("// Auto-generated by Google Colab Pro GPU RL (colab/train_nvss.py)\n")
                f.write("import {loadNVSSWeights} from './nvss-weights.js';\n")
                f.write("export const NVSS_COLAB_CHECKPOINT = ")
                json.dump(payload, f, separators=(",", ":"))
                f.write(";\nloadNVSSWeights(NVSS_COLAB_CHECKPOINT, false);\n")
        return payload
