"""RNV1 Recurrent Residual Actor-Critic Architecture (CTDE MAPPO + Auxiliary Heads).

The Actor (`RNV1Actor`) uses strictly 100% fair-play egocentric observations (144 dims)
and is mirrored bit-for-bit in pure Float32Array JavaScript inside `dist/js/rnv1.js`.
The Centralized Critic & Auxiliary Heads run ONLY during Colab A100 training.
"""

from __future__ import annotations

import math
from typing import Dict, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from .spec import (
    ACT_AIM_MODES,
    ACT_BIN_DIM,
    ACT_CONT_DIM,
    ACT_UTIL_DIM,
    CRITIC_GLOBAL_DIM,
    DEFAULT_HIDDEN_DIM,
    OBS_DIM,
)


def ortho_init(module: nn.Module, gain: float = math.sqrt(2.0)) -> nn.Module:
    if isinstance(module, nn.Linear):
        nn.init.orthogonal_(module.weight, gain=gain)
        if module.bias is not None:
            nn.init.zeros_(module.bias)
    elif isinstance(module, nn.GRUCell):
        for name, param in module.named_parameters():
            if "weight_ih" in name:
                nn.init.orthogonal_(param, gain=1.0)
            elif "weight_hh" in name:
                nn.init.orthogonal_(param, gain=1.0)
            elif "bias" in name:
                nn.init.zeros_(param)
    return module


class RNV1Actor(nn.Module):
    """Exportable browser-native fair-play tactical policy network (zero external deps in JS).

    Exact forward equations (mirrored 1-to-1 in dist/js/rnv1.js):
      x1 = silu(enc_ln(enc_fc(obs)))
      x2 = x1 + silu(res_ln(res_fc(x1)))
      h  = gru(x2, h_prev)
      cont_mean = tanh(head_cont(h))        # [..., 5]
      aim_logits = head_aim(h)              # [..., 6]
      bin_logits = head_bin(h)              # [..., 5]
      util_logits = head_util(h)            # [..., 3]
    """

    def __init__(self, obs_dim: int = OBS_DIM, hidden_dim: int = DEFAULT_HIDDEN_DIM) -> None:
        super().__init__()
        self.obs_dim = obs_dim
        self.hidden_dim = hidden_dim

        self.enc_fc = ortho_init(nn.Linear(obs_dim, hidden_dim))
        self.enc_ln = nn.LayerNorm(hidden_dim, eps=1e-5)

        self.res_fc = ortho_init(nn.Linear(hidden_dim, hidden_dim))
        self.res_ln = nn.LayerNorm(hidden_dim, eps=1e-5)

        self.gru = ortho_init(nn.GRUCell(hidden_dim, hidden_dim))

        self.head_cont = ortho_init(nn.Linear(hidden_dim, ACT_CONT_DIM), gain=0.05)
        self.head_aim = ortho_init(nn.Linear(hidden_dim, ACT_AIM_MODES), gain=0.05)
        self.head_bin = ortho_init(nn.Linear(hidden_dim, ACT_BIN_DIM), gain=0.05)
        self.head_util = ortho_init(nn.Linear(hidden_dim, ACT_UTIL_DIM), gain=0.05)

        # Mild initial bias so brand-new random agents do not spam reload/smoke/jump constantly on tick 0
        with torch.no_grad():
            self.head_bin.bias[3] = -1.5  # jump rare initially
            self.head_bin.bias[4] = -1.5  # manual reload rare initially
            self.head_util.bias[0] = 1.2  # NONE preferred until smoke/skill learned

        # Exploration std for continuous head (training only)
        self.log_std = nn.Parameter(torch.full((ACT_CONT_DIM,), -0.45))

    def encode_and_step(
        self,
        obs: torch.Tensor,
        h_prev: torch.Tensor,
    ) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        x1 = F.silu(self.enc_ln(self.enc_fc(obs)))
        x2 = x1 + F.silu(self.res_ln(self.res_fc(x1)))
        h_new = self.gru(x2, h_prev.to(x2.dtype)).float()
        outs = {
            "cont_mean": torch.tanh(self.head_cont(h_new)),
            "aim_logits": self.head_aim(h_new),
            "bin_logits": self.head_bin(h_new),
            "util_logits": self.head_util(h_new),
        }
        return h_new, outs

    def forward_sequence(
        self,
        obs_seq: torch.Tensor,
        h0: torch.Tensor,
        done_seq: torch.Tensor,
    ) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        """Unroll GRU over [T, N, obs_dim] with episode-boundary hidden state resets."""
        T, N, _ = obs_seq.shape
        flat_obs = obs_seq.reshape(T * N, self.obs_dim)
        x1 = F.silu(self.enc_ln(self.enc_fc(flat_obs)))
        x2 = (x1 + F.silu(self.res_ln(self.res_fc(x1)))).reshape(T, N, self.hidden_dim)

        h = h0
        h_list = []
        for t in range(T):
            # Reset hidden state on episode/respawn boundary before step t
            if t > 0:
                mask = (1.0 - done_seq[t - 1].to(h.dtype)).unsqueeze(-1)
                h = h * mask
            h = self.gru(x2[t], h)
            h_list.append(h)

        h_seq = torch.stack(h_list, dim=0)  # [T, N, H]
        h_flat = h_seq.reshape(T * N, self.hidden_dim)
        outs = {
            "cont_mean": torch.tanh(self.head_cont(h_flat)).reshape(T, N, ACT_CONT_DIM),
            "aim_logits": self.head_aim(h_flat).reshape(T, N, ACT_AIM_MODES),
            "bin_logits": self.head_bin(h_flat).reshape(T, N, ACT_BIN_DIM),
            "util_logits": self.head_util(h_flat).reshape(T, N, ACT_UTIL_DIM),
        }
        return h_seq, outs


class RNV1ActorCritic(nn.Module):
    """Full CTDE MAPPO training model: Fair-Play Actor + Privileged Critic + Auxiliary Heads."""

    def __init__(
        self,
        obs_dim: int = OBS_DIM,
        critic_global_dim: int = CRITIC_GLOBAL_DIM,
        hidden_dim: int = DEFAULT_HIDDEN_DIM,
    ) -> None:
        super().__init__()
        self.obs_dim = obs_dim
        self.critic_global_dim = critic_global_dim
        self.hidden_dim = hidden_dim

        self.actor = RNV1Actor(obs_dim=obs_dim, hidden_dim=hidden_dim)

        # Privileged Centralized Critic (training only — NOT exported to browser!)
        self.critic_fc1 = ortho_init(nn.Linear(hidden_dim + critic_global_dim, hidden_dim))
        self.critic_ln1 = nn.LayerNorm(hidden_dim, eps=1e-5)
        self.critic_fc2 = ortho_init(nn.Linear(hidden_dim, hidden_dim))
        self.critic_ln2 = nn.LayerNorm(hidden_dim, eps=1e-5)
        self.critic_val = ortho_init(nn.Linear(hidden_dim, 1), gain=1.0)

        # Auxiliary self-supervised prediction heads (dense gradients into GRU representation!)
        # Predicts: [nearest_enemy_dist_norm, enemy_in_close_range, imminent_damage_risk, flank_opportunity]
        self.aux_head = ortho_init(nn.Linear(hidden_dim, 4), gain=0.25)

    def _critic_forward(self, h: torch.Tensor, global_state: torch.Tensor) -> torch.Tensor:
        c_in = torch.cat([h, global_state], dim=-1)
        c1 = F.silu(self.critic_ln1(self.critic_fc1(c_in)))
        c2 = c1 + F.silu(self.critic_ln2(self.critic_fc2(c1)))
        return self.critic_val(c2).squeeze(-1)

    @staticmethod
    def _mask_aim_logits(aim_logits: torch.Tensor, obs: torch.Tensor) -> torch.Tensor:
        """Mask out invalid visible/memory slots so policy never wastes probability on empty slots."""
        # Valid flags in canonical 144-dim observation:
        # VIS_0=59, VIS_1=73, VIS_2=87, MEM_0=101, MEM_1=110
        v0 = obs[..., 59] > 0.5
        v1 = obs[..., 73] > 0.5
        v2 = obs[..., 87] > 0.5
        m0 = obs[..., 101] > 0.5
        m1 = obs[..., 110] > 0.5
        free = torch.ones_like(v0)
        valid = torch.stack([free, v0, v1, v2, m0, m1], dim=-1)
        return torch.where(valid, aim_logits, torch.full_like(aim_logits, -1e4))

    def _build_dists(self, outs: Dict[str, torch.Tensor], obs: torch.Tensor):
        cont_mean = outs["cont_mean"].float()
        std = torch.exp(torch.clamp(self.actor.log_std.float(), -2.4, 0.15)).expand_as(cont_mean)
        d_cont = torch.distributions.Normal(cont_mean, std)

        masked_aim = self._mask_aim_logits(outs["aim_logits"].float(), obs)
        d_aim = torch.distributions.Categorical(logits=masked_aim)

        d_bin = torch.distributions.Bernoulli(logits=outs["bin_logits"].float())
        d_util = torch.distributions.Categorical(logits=outs["util_logits"].float())
        return d_cont, d_aim, d_bin, d_util

    @torch.no_grad()
    def act(
        self,
        obs: torch.Tensor,
        h_prev: torch.Tensor,
        global_state: Optional[torch.Tensor] = None,
        deterministic: bool = False,
    ) -> Tuple[Dict[str, torch.Tensor], torch.Tensor, torch.Tensor, Optional[torch.Tensor]]:
        """Single-step rollout inference for [N, obs_dim]."""
        h_new, outs = self.actor.encode_and_step(obs, h_prev)
        d_cont, d_aim, d_bin, d_util = self._build_dists(outs, obs)

        if deterministic:
            a_cont = outs["cont_mean"].float()
            a_aim = d_aim.logits.argmax(dim=-1)
            a_bin = (outs["bin_logits"].float() > 0.0).float()
            a_util = d_util.logits.argmax(dim=-1)
        else:
            a_cont = torch.clamp(d_cont.sample(), -1.0, 1.0)
            a_aim = d_aim.sample()
            a_bin = d_bin.sample()
            a_util = d_util.sample()

        logp = (
            d_cont.log_prob(a_cont).sum(dim=-1)
            + d_aim.log_prob(a_aim)
            + d_bin.log_prob(a_bin).sum(dim=-1)
            + d_util.log_prob(a_util)
        )
        val = self._critic_forward(h_new, global_state) if global_state is not None else None
        actions = {
            "cont": a_cont,
            "aim": a_aim,
            "bin": a_bin,
            "util": a_util,
        }
        return actions, logp, h_new, val

    def evaluate_sequences(
        self,
        obs_seq: torch.Tensor,
        global_seq: torch.Tensor,
        h0: torch.Tensor,
        done_seq: torch.Tensor,
        act_cont: torch.Tensor,
        act_aim: torch.Tensor,
        act_bin: torch.Tensor,
        act_util: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Truncated-BPTT PPO evaluation over [T, N, ...].

        Returns:
            logp:    [T, N]
            entropy: [T, N]
            values:  [T, N]
            aux_pred:[T, N, 4]
        """
        h_seq, outs = self.actor.forward_sequence(obs_seq, h0, done_seq)
        d_cont, d_aim, d_bin, d_util = self._build_dists(outs, obs_seq)

        logp = (
            d_cont.log_prob(act_cont).sum(dim=-1)
            + d_aim.log_prob(act_aim)
            + d_bin.log_prob(act_bin).sum(dim=-1)
            + d_util.log_prob(act_util)
        )
        # Balanced per-head entropy sum (continuous + discrete)
        entropy = (
            d_cont.entropy().sum(dim=-1) * 0.35
            + d_aim.entropy()
            + d_bin.entropy().sum(dim=-1) * 0.50
            + d_util.entropy() * 0.60
        )

        T, N, H = h_seq.shape
        values = self._critic_forward(
            h_seq.reshape(T * N, H),
            global_seq.reshape(T * N, self.critic_global_dim),
        ).reshape(T, N)
        aux_pred = self.aux_head(h_seq.float())
        return logp, entropy, values, aux_pred
