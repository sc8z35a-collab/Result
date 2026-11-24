"""NV Gamer — PyTorch Universal Game-Agnostic Foundation Network.

Matches dist/js/nvgamer-core.js (NVGamerFoundationNet) and dist/js/nvgamer-weights.js 1:1.
Combines:
  - 4-Head Cross-Attention Entity-Set Transformer + SwiGLU FFN (handles any number of arbitrary game objects)
  - Recurrent Meta-RL GRU Working Memory (in-context adaptation to unseen physics, controls, and game genres)
  - Self-Supervised Forward Latent World Model (predicts next state for curiosity & instant rule-shift detection)
  - Virtual Human Controller Output Heads (Move axes, Aim axes, 12 Universal Intents, Bilinear Arbitrary Button Query, 8 Human Style Axes, Critic Value)
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Dict, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

NVGAMER_WEIGHTS_VERSION = "NV-GAMER-1.0-UNIVERSAL"


@dataclass(frozen=True)
class NVGamerArch:
    state_dim: int = 24
    token_dim: int = 16
    action_desc_dim: int = 8
    d_model: int = 48
    n_heads: int = 4
    d_head: int = 12
    d_ffn: int = 96
    n_intents: int = 12
    n_style: int = 8


ARCH = NVGamerArch()

TENSOR_KEYS = [
    "wState", "bState",
    "wTok", "bTok",
    "wQ", "wK", "wV", "wO",
    "wGate", "wUp", "wDown",
    "wGruZ", "uGruZ", "bGruZ",
    "wGruR", "uGruR", "bGruR",
    "wGruH", "uGruH", "bGruH",
    "wWorld", "bWorld",
    "wIntent", "bIntent",
    "wMove", "bMove",
    "wAim", "bAim",
    "wBtn", "bBtn",
    "wStyle", "bStyle",
    "wVal", "bVal",
]


def _layer_norm_no_affine(x: torch.Tensor, eps: float = 1e-5) -> torch.Tensor:
    mean = x.mean(dim=-1, keepdim=True)
    var = (x - mean).pow(2).mean(dim=-1, keepdim=True)
    return (x - mean) * torch.rsqrt(var + eps)


class NVGamerNetTorch(nn.Module):
    """Exact 1:1 PyTorch twin of dist/js/nvgamer-core.js (NVGamerFoundationNet)."""

    def __init__(self, arch: NVGamerArch = ARCH):
        super().__init__()
        self.arch = arch
        D = arch.d_model

        self.wState = nn.Parameter(torch.empty(arch.state_dim, D))
        self.bState = nn.Parameter(torch.zeros(D))
        self.wTok = nn.Parameter(torch.empty(arch.token_dim, D))
        self.bTok = nn.Parameter(torch.zeros(D))

        self.wQ = nn.Parameter(torch.empty(D, D))
        self.wK = nn.Parameter(torch.empty(D, D))
        self.wV = nn.Parameter(torch.empty(D, D))
        self.wO = nn.Parameter(torch.empty(D, D))

        self.wGate = nn.Parameter(torch.empty(D, arch.d_ffn))
        self.wUp = nn.Parameter(torch.empty(D, arch.d_ffn))
        self.wDown = nn.Parameter(torch.empty(arch.d_ffn, D))

        # Recurrent Meta-RL GRU Working Memory
        self.wGruZ = nn.Parameter(torch.empty(D, D))
        self.uGruZ = nn.Parameter(torch.empty(D, D))
        self.bGruZ = nn.Parameter(torch.full((D,), -0.35))
        self.wGruR = nn.Parameter(torch.empty(D, D))
        self.uGruR = nn.Parameter(torch.empty(D, D))
        self.bGruR = nn.Parameter(torch.zeros(D))
        self.wGruH = nn.Parameter(torch.empty(D, D))
        self.uGruH = nn.Parameter(torch.empty(D, D))
        self.bGruH = nn.Parameter(torch.zeros(D))

        # Self-supervised Forward World Model head
        self.wWorld = nn.Parameter(torch.empty(D, arch.state_dim))
        self.bWorld = nn.Parameter(torch.zeros(arch.state_dim))

        # Virtual Human Controller & Universal Action Heads
        self.wIntent = nn.Parameter(torch.empty(D, arch.n_intents))
        self.bIntent = nn.Parameter(torch.zeros(arch.n_intents))
        self.wMove = nn.Parameter(torch.empty(D, 2))
        self.bMove = nn.Parameter(torch.zeros(2))
        self.wAim = nn.Parameter(torch.empty(D, 2))
        self.bAim = nn.Parameter(torch.zeros(2))
        self.wBtn = nn.Parameter(torch.empty(D, arch.action_desc_dim))
        self.bBtn = nn.Parameter(torch.zeros(arch.action_desc_dim))
        self.wStyle = nn.Parameter(torch.empty(D, arch.n_style))
        self.bStyle = nn.Parameter(torch.zeros(arch.n_style))
        self.wVal = nn.Parameter(torch.empty(D, 1))
        self.bVal = nn.Parameter(torch.zeros(1))

        # Learnable exploration std for continuous virtual controller axes during PPO
        self.move_log_std = nn.Parameter(torch.full((2,), -0.60))
        self.aim_log_std = nn.Parameter(torch.full((2,), -0.65))
        self._init_parameters()

    def _init_parameters(self) -> None:
        for name, p in self.named_parameters():
            if (name.startswith("w") or name.startswith("u")) and p.ndim == 2:
                nn.init.xavier_uniform_(p, gain=0.72)

    def init_hidden(self, batch_size: int, device: torch.device) -> torch.Tensor:
        return torch.zeros((batch_size, self.arch.d_model), device=device)

    def forward(
        self,
        state_vec: torch.Tensor,
        tokens: torch.Tensor,
        hidden: torch.Tensor,
        token_mask: torch.Tensor | None = None,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Single-step recurrent forward pass.

        Args:
            state_vec: (B, 24)
            tokens: (B, N, 16)
            hidden: (B, 48)
            token_mask: optional (B, N) bool mask (True = valid entity token)

        Returns:
            new_hidden: (B, 48)
            pred_next_state: (B, 24)
            intent_logits: (B, 12)
            move_mean: (B, 2) in (-1, 1)
            aim_mean: (B, 2) in (-1, 1)
            btn_query: (B, 8)
            human_style: (B, 8) in (0, 1)
            value: (B,)
        """
        A = self.arch
        B, N, _ = tokens.shape
        D = A.d_model

        h_state = F.silu(state_vec @ self.wState + self.bState)   # (B, D)
        h_tok = F.silu(tokens @ self.wTok + self.bTok)            # (B, N, D)

        kv_in = torch.cat([h_state.unsqueeze(1), h_tok], dim=1)   # (B, N+1, D)
        q_in = h_state + hidden * 0.5
        q = (q_in @ self.wQ).view(B, A.n_heads, 1, A.d_head)
        k = (kv_in @ self.wK).view(B, N + 1, A.n_heads, A.d_head).transpose(1, 2)
        v = (kv_in @ self.wV).view(B, N + 1, A.n_heads, A.d_head).transpose(1, 2)

        scores = torch.matmul(q, k.transpose(-2, -1)) * (1.0 / math.sqrt(A.d_head))
        if token_mask is not None:
            self_valid = torch.ones((B, 1), dtype=torch.bool, device=token_mask.device)
            full_mask = torch.cat([self_valid, token_mask], dim=1).view(B, 1, 1, N + 1)
            scores = scores.masked_fill(~full_mask, -1e4)

        attn_w = F.softmax(scores, dim=-1)
        attn_out = torch.matmul(attn_w, v).squeeze(2).reshape(B, D)

        ctx = _layer_norm_no_affine(attn_out @ self.wO + h_state)
        ffn = (F.silu(ctx @ self.wGate) * (ctx @ self.wUp)) @ self.wDown
        enc = _layer_norm_no_affine(ctx + ffn)

        # Recurrent Meta-RL GRU Working Memory update
        z_g = torch.sigmoid(enc @ self.wGruZ + hidden @ self.uGruZ + self.bGruZ)
        r_g = torch.sigmoid(enc @ self.wGruR + hidden @ self.uGruR + self.bGruR)
        h_cand = torch.tanh(enc @ self.wGruH + (r_g * hidden) @ self.uGruH + self.bGruH)
        new_hidden = (1.0 - z_g) * hidden + z_g * h_cand

        pred_next_state = new_hidden @ self.wWorld + self.bWorld
        intent_logits = new_hidden @ self.wIntent + self.bIntent
        move_mean = torch.tanh(new_hidden @ self.wMove + self.bMove)
        aim_mean = torch.tanh(new_hidden @ self.wAim + self.bAim)
        btn_query = new_hidden @ self.wBtn + self.bBtn
        human_style = torch.sigmoid(new_hidden @ self.wStyle + self.bStyle)
        value = (new_hidden @ self.wVal + self.bVal).squeeze(-1)

        return new_hidden, pred_next_state, intent_logits, move_mean, aim_mean, btn_query, human_style, value

    def score_buttons(self, btn_query: torch.Tensor, btn_descs: torch.Tensor) -> torch.Tensor:
        """Scores arbitrary candidate game buttons/actions: (B, 8) x (B, C, 8) -> (B, C)."""
        return torch.einsum("bd,bcd->bc", btn_query, btn_descs)

    def export_weights_dict(
        self,
        trained_steps: int,
        trained_episodes: int,
        genres_trained: int = 5,
        source: str = "colab-pro-gpu-nvgamer",
    ) -> Dict[str, object]:
        weights_out = {}
        with torch.no_grad():
            for k in TENSOR_KEYS:
                t = getattr(self, k).detach().float().cpu().contiguous().view(-1)
                weights_out[k] = [round(float(x), 5) for x in t.tolist()]

        return {
            "version": NVGAMER_WEIGHTS_VERSION,
            "trainedSteps": int(trained_steps),
            "trainedEpisodes": int(trained_episodes),
            "genresTrained": int(genres_trained),
            "source": source,
            "arch": {
                "stateDim": self.arch.state_dim,
                "tokenDim": self.arch.token_dim,
                "actionDescDim": self.arch.action_desc_dim,
                "dModel": self.arch.d_model,
                "nHeads": self.arch.n_heads,
                "dHead": self.arch.d_head,
                "dFfn": self.arch.d_ffn,
                "nIntents": self.arch.n_intents,
                "nStyle": self.arch.n_style,
            },
            "weights": weights_out,
        }

    def save_browser_files(
        self,
        json_path: str,
        js_path: str | None,
        trained_steps: int,
        trained_episodes: int,
        genres_trained: int = 5,
        source: str = "colab-pro-gpu-nvgamer",
    ) -> Dict[str, object]:
        payload = self.export_weights_dict(
            trained_steps=trained_steps,
            trained_episodes=trained_episodes,
            genres_trained=genres_trained,
            source=source,
        )
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"))
        if js_path:
            with open(js_path, "w", encoding="utf-8") as f:
                f.write("// Auto-generated by NV Gamer Google Colab Pro Multi-Game GPU Meta-RL\n")
                f.write("import {loadNVGamerWeights} from './nvgamer-weights.js';\n")
                f.write("export const NVGAMER_COLAB_CHECKPOINT = ")
                json.dump(payload, f, separators=(",", ":"))
                f.write(";\nloadNVGamerWeights(NVGAMER_COLAB_CHECKPOINT, false);\n")
        return payload
