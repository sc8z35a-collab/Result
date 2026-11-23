"""NV 3 Sentient Human Neural Architecture:
  1. NV3OmegaBrain   (~3.1M params): Heavy-Duty A100 BF16 Teacher with 2-Layer SwiGLU Entity-Relation
                     Transformer, 2-Layer Fused cuDNN GRU, 5 World/ToM/Emotion Understanding Heads,
                     Factored 7-Group Human-Embodied Policy, and 4-Layer 512-dim Centralized Critic.
  2. NV3BrowserCore  (~505k params): Exact bit-for-bit mirror of `dist/js/nv3.js` (Cross-Attention +
                     GRU-256 + Emotion Appraisal + All 7 Embodied Policy Heads), distilled directly
                     from NV3OmegaBrain in Phase 4 for <0.12 ms/tick 360Hz browser execution!
"""

from __future__ import annotations

import math
from typing import Dict, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from .spec import (
    ACT_AIM_DIM,
    ACT_AIM_RES_DIM,
    ACT_BIN_DIM,
    ACT_INTENT_DIM,
    ACT_MOVE_DIM,
    ACT_SOCIAL_DIM,
    ACT_UTIL_DIM,
    BROWSER_ATTN_HEADS,
    BROWSER_EGO_DIM,
    BROWSER_ENT_DIM,
    BROWSER_GRU_DIM,
    CRITIC_GLOBAL_DIM,
    EGO_OBS_DIM,
    ENTITY_DIM,
    NUM_EMOTIONS,
    NUM_ENTITIES,
    OMEGA_ATTN_HEADS,
    OMEGA_ATTN_LAYERS,
    OMEGA_CRITIC_DIM,
    OMEGA_D_MODEL,
    OMEGA_GRU_DIM,
    OMEGA_GRU_LAYERS,
)


def ortho_init(module: nn.Module, gain: float = math.sqrt(2.0)) -> nn.Module:
    if isinstance(module, nn.Linear):
        nn.init.orthogonal_(module.weight, gain=gain)
        if module.bias is not None:
            nn.init.zeros_(module.bias)
    elif isinstance(module, (nn.GRUCell, nn.GRU)):
        for name, param in module.named_parameters():
            if "weight" in name:
                nn.init.orthogonal_(param, gain=1.0)
            elif "bias" in name:
                nn.init.zeros_(param)
    return module


def mask_nv3_aim_logits(aim_logits: torch.Tensor, entities: torch.Tensor) -> torch.Tensor:
    """Mask out invalid entity slots in aim-pointer logits [..., 9].

    Slots:
      0: FREE_LOOK (always valid)
      1..4: VIS_0..3   (entities[..., 0..3, 0] > 0.5)
      5..7: MEM_0..2   (entities[..., 4..6, 0] > 0.5)
      8:    ALLY_GLANCE (entities[..., 7, 0] > 0.5 — nearest alive teammate!)
    """
    free = torch.ones_like(entities[..., 0, 0], dtype=torch.bool)
    vis = entities[..., 0:4, 0] > 0.5
    mem = entities[..., 4:7, 0] > 0.5
    ally0 = (entities[..., 7, 0] > 0.5).unsqueeze(-1)
    valid = torch.cat([free.unsqueeze(-1), vis, mem, ally0], dim=-1)
    return torch.where(valid, aim_logits, torch.full_like(aim_logits, -1e4))


class SwiGLUBlock(nn.Module):
    """Pre-Norm Multi-Head Entity-Relation Self-Attention + SwiGLU FFN (A100 Tensor Core optimized)."""

    def __init__(self, d_model: int, n_heads: int, ffn_mult: int = 2) -> None:
        super().__init__()
        self.d_model = d_model
        self.n_heads = n_heads
        self.d_head = d_model // n_heads
        self.ln1 = nn.LayerNorm(d_model, eps=1e-5)
        self.qkv = ortho_init(nn.Linear(d_model, 3 * d_model), gain=1.0)
        self.proj = ortho_init(nn.Linear(d_model, d_model), gain=0.7)

        self.ln2 = nn.LayerNorm(d_model, eps=1e-5)
        d_ff = d_model * ffn_mult
        self.w_gate = ortho_init(nn.Linear(d_model, d_ff), gain=1.0)
        self.w_up = ortho_init(nn.Linear(d_model, d_ff), gain=1.0)
        self.w_down = ortho_init(nn.Linear(d_ff, d_model), gain=0.7)

    def forward(self, x: torch.Tensor, key_valid_mask: torch.Tensor) -> torch.Tensor:
        """x: [N, L, D], key_valid_mask: [N, L] bool (True = valid token)."""
        N, L, D = x.shape
        h = self.ln1(x)
        qkv = self.qkv(h).view(N, L, 3, self.n_heads, self.d_head)
        q = qkv[:, :, 0].transpose(1, 2)  # [N, H, L, dh]
        k = qkv[:, :, 1].transpose(1, 2)
        v = qkv[:, :, 2].transpose(1, 2)

        # Additive attention mask [N, 1, 1, L] for SDPA (FlashAttention / Math on A100!)
        attn_bias = torch.zeros((N, 1, 1, L), dtype=q.dtype, device=x.device)
        attn_bias = attn_bias.masked_fill(~key_valid_mask[:, None, None, :], -1e4)
        ctx = F.scaled_dot_product_attention(q, k, v, attn_mask=attn_bias)
        ctx = ctx.transpose(1, 2).contiguous().view(N, L, D)
        x = x + self.proj(ctx)

        h2 = self.ln2(x)
        ff = F.silu(self.w_gate(h2)) * self.w_up(h2)
        x = x + self.w_down(ff)
        return x


class NV3OmegaBrain(nn.Module):
    """Heavy-Duty ~3.1M Parameter A100 Sentient Human Teacher + Centralized Critic."""

    def __init__(
        self,
        d_model: int = OMEGA_D_MODEL,
        n_heads: int = OMEGA_ATTN_HEADS,
        n_layers: int = OMEGA_ATTN_LAYERS,
        gru_dim: int = OMEGA_GRU_DIM,
        gru_layers: int = OMEGA_GRU_LAYERS,
        critic_dim: int = OMEGA_CRITIC_DIM,
    ) -> None:
        super().__init__()
        self.d_model = d_model
        self.gru_dim = gru_dim
        self.gru_layers = gru_layers

        # Stream 1: Ego + Emotion + Somatic + Personality DNA + Spatial/Friston encoder
        self.ego_fc1 = ortho_init(nn.Linear(EGO_OBS_DIM, d_model))
        self.ego_ln1 = nn.LayerNorm(d_model, eps=1e-5)
        self.ego_fc2 = ortho_init(nn.Linear(d_model, d_model))
        self.ego_ln2 = nn.LayerNorm(d_model, eps=1e-5)

        # Stream 2: 12-Entity Relational Transformer (Ego query token + 12 entity tokens = 13 tokens)
        self.ent_fc = ortho_init(nn.Linear(ENTITY_DIM, d_model))
        self.ent_ln = nn.LayerNorm(d_model, eps=1e-5)
        self.blocks = nn.ModuleList([SwiGLUBlock(d_model, n_heads, ffn_mult=2) for _ in range(n_layers)])
        self.pool_q = ortho_init(nn.Linear(d_model, 1), gain=0.5)

        # Temporal Fusion -> 2-Layer Fused cuDNN GRU
        self.fuse_fc = ortho_init(nn.Linear(d_model * 2, gru_dim))
        self.fuse_ln = nn.LayerNorm(gru_dim, eps=1e-5)
        self.gru = ortho_init(nn.GRU(gru_dim, gru_dim, num_layers=gru_layers, batch_first=False))

        # 7 Factored Human-Embodied Policy Heads (independent PPO ratio groups!)
        self.head_intent = ortho_init(nn.Linear(gru_dim, ACT_INTENT_DIM), gain=0.05)
        self.head_social = ortho_init(nn.Linear(gru_dim, ACT_SOCIAL_DIM), gain=0.05)
        self.head_aim = ortho_init(nn.Linear(gru_dim, ACT_AIM_DIM), gain=0.05)
        self.head_move = ortho_init(nn.Linear(gru_dim, ACT_MOVE_DIM), gain=0.05)
        self.head_aim_res = ortho_init(nn.Linear(gru_dim, ACT_AIM_RES_DIM), gain=0.05)
        self.head_bin = ortho_init(nn.Linear(gru_dim, ACT_BIN_DIM), gain=0.05)
        self.head_util = ortho_init(nn.Linear(gru_dim, ACT_UTIL_DIM), gain=0.05)

        # Mild natural starter priors (avoid random spam of jump/reload/social on step 0)
        with torch.no_grad():
            self.head_social.bias[0] = 1.6  # NONE default until meaningful gesture/callout learned
            self.head_bin.bias[3] = -1.6    # jump rare initially
            self.head_bin.bias[4] = -1.4    # manual reload rare initially
            self.head_util.bias[0] = 1.4    # NONE default for smoke/skill

        self.log_std_move = nn.Parameter(torch.full((ACT_MOVE_DIM,), -0.50))
        self.log_std_aim = nn.Parameter(torch.full((ACT_AIM_RES_DIM,), -0.75))

        # 5 Deep Self-, Surroundings-, Theory-of-Mind-, & Emotion-Understanding Heads
        self.head_emotion = ortho_init(nn.Linear(gru_dim, NUM_EMOTIONS), gain=0.20)
        self.aux_danger = ortho_init(nn.Linear(gru_dim, 2), gain=0.25)
        self.aux_sectors = ortho_init(nn.Linear(gru_dim, 6), gain=0.25)
        self.aux_tom = ortho_init(nn.Linear(gru_dim, 4), gain=0.25)
        self.aux_ally = ortho_init(nn.Linear(gru_dim, 2), gain=0.25)

        # Asymmetric 4-Layer Centralized Critic (d=512, training only!)
        self.c_in = ortho_init(nn.Linear(gru_dim + CRITIC_GLOBAL_DIM, critic_dim))
        self.c_ln1 = nn.LayerNorm(critic_dim, eps=1e-5)
        self.c_res1 = ortho_init(nn.Linear(critic_dim, critic_dim))
        self.c_ln2 = nn.LayerNorm(critic_dim, eps=1e-5)
        self.c_res2 = ortho_init(nn.Linear(critic_dim, critic_dim))
        self.c_ln3 = nn.LayerNorm(critic_dim, eps=1e-5)
        self.c_val = ortho_init(nn.Linear(critic_dim, 1), gain=1.0)

    def encode_scene(self, ego: torch.Tensor, entities: torch.Tensor) -> torch.Tensor:
        """Encode [N, 112] ego + [N, 12, 16] entities through 2-layer Entity-Relation Transformer -> [N, gru_dim]."""
        N = ego.shape[0]
        e1 = F.silu(self.ego_ln1(self.ego_fc1(ego)))
        e_tok = e1 + F.silu(self.ego_ln2(self.ego_fc2(e1)))  # [N, D]

        ent_tok = F.silu(self.ent_ln(self.ent_fc(entities)))  # [N, 12, D]
        ent_valid = entities[:, :, 0] > 0.5                   # [N, 12]
        ego_valid = torch.ones((N, 1), dtype=torch.bool, device=ego.device)
        mask = torch.cat([ego_valid, ent_valid], dim=1)       # [N, 13]

        seq = torch.cat([e_tok.unsqueeze(1), ent_tok], dim=1) # [N, 13, D]
        for blk in self.blocks:
            seq = blk(seq, mask)

        ego_out = seq[:, 0, :]     # [N, D]
        ent_out = seq[:, 1:, :]    # [N, 12, D]

        # Masked attention pooling over entity tokens
        w_logits = self.pool_q(ent_out).squeeze(-1)  # [N, 12]
        any_valid = ent_valid.any(dim=1, keepdim=True)
        w_logits = torch.where(ent_valid, w_logits, torch.full_like(w_logits, -1e4))
        w = torch.softmax(w_logits.float(), dim=-1).to(ent_out.dtype)
        w = torch.where(any_valid, w, torch.zeros_like(w))
        ent_pool = (ent_out * w.unsqueeze(-1)).sum(dim=1)     # [N, D]

        fused = torch.cat([ego_out, ent_pool], dim=-1)        # [N, 2*D]
        return F.silu(self.fuse_ln(self.fuse_fc(fused)))      # [N, gru_dim]

    def _heads_from_h(self, h_top: torch.Tensor) -> Dict[str, torch.Tensor]:
        return {
            "intent_logits": self.head_intent(h_top),
            "social_logits": self.head_social(h_top),
            "aim_logits": self.head_aim(h_top),
            "move_mean": torch.tanh(self.head_move(h_top)),
            "aim_res_mean": torch.tanh(self.head_aim_res(h_top)),
            "bin_logits": self.head_bin(h_top),
            "util_logits": self.head_util(h_top),
            "emotion_pred": torch.sigmoid(self.head_emotion(h_top.float())),
            "aux_danger": self.aux_danger(h_top.float()),
            "aux_sectors": self.aux_sectors(h_top.float()),
            "aux_tom": self.aux_tom(h_top.float()),
            "aux_ally": self.aux_ally(h_top.float()),
        }

    def _critic(self, h_top: torch.Tensor, global_state: torch.Tensor) -> torch.Tensor:
        c = F.silu(self.c_ln1(self.c_in(torch.cat([h_top, global_state], dim=-1))))
        c = c + F.silu(self.c_ln2(self.c_res1(c)))
        c = c + F.silu(self.c_ln3(self.c_res2(c)))
        return self.c_val(c).squeeze(-1)

    def _build_dists(self, outs: Dict[str, torch.Tensor], entities: torch.Tensor):
        d_intent = torch.distributions.Categorical(logits=outs["intent_logits"].float())
        d_social = torch.distributions.Categorical(logits=outs["social_logits"].float())
        d_aim = torch.distributions.Categorical(logits=mask_nv3_aim_logits(outs["aim_logits"].float(), entities))

        std_m = torch.exp(torch.clamp(self.log_std_move.float(), -2.3, 0.15))
        d_move = torch.distributions.Normal(outs["move_mean"].float(), std_m.expand_as(outs["move_mean"]))

        std_a = torch.exp(torch.clamp(self.log_std_aim.float(), -2.6, 0.05))
        d_aim_res = torch.distributions.Normal(outs["aim_res_mean"].float(), std_a.expand_as(outs["aim_res_mean"]))

        d_bin = torch.distributions.Bernoulli(logits=outs["bin_logits"].float())
        d_util = torch.distributions.Categorical(logits=outs["util_logits"].float())
        return d_intent, d_social, d_aim, d_move, d_aim_res, d_bin, d_util

    @torch.no_grad()
    def act(
        self,
        ego: torch.Tensor,
        entities: torch.Tensor,
        h_prev: torch.Tensor,
        global_state: Optional[torch.Tensor] = None,
        deterministic: bool = False,
    ) -> Tuple[Dict[str, torch.Tensor], Dict[str, torch.Tensor], torch.Tensor, Optional[torch.Tensor], torch.Tensor]:
        """Single-step rollout inference for [N, ...]. `h_prev`: [num_layers, N, gru_dim]."""
        feat = self.encode_scene(ego, entities)  # [N, gru_dim]
        out_seq, h_new = self.gru(feat.unsqueeze(0), h_prev.to(feat.dtype))
        h_top = out_seq.squeeze(0)
        h_new = h_new.float()

        outs = self._heads_from_h(h_top)
        d_intent, d_social, d_aim, d_move, d_aim_res, d_bin, d_util = self._build_dists(outs, entities)

        if deterministic:
            a_intent = d_intent.logits.argmax(dim=-1)
            a_social = d_social.logits.argmax(dim=-1)
            a_aim = d_aim.logits.argmax(dim=-1)
            a_move = outs["move_mean"].float()
            a_aim_res = outs["aim_res_mean"].float()
            a_bin = (outs["bin_logits"].float() > 0.0).float()
            a_util = d_util.logits.argmax(dim=-1)
        else:
            a_intent = d_intent.sample()
            a_social = d_social.sample()
            a_aim = d_aim.sample()
            a_move = torch.clamp(d_move.sample(), -1.0, 1.0)
            a_aim_res = torch.clamp(d_aim_res.sample(), -1.0, 1.0)
            a_bin = d_bin.sample()
            a_util = d_util.sample()

        # Store FACTORED per-group log-probs [N, 6] so PPO never suffers joint-sum clipping starvation!
        lp_groups = torch.stack([
            d_move.log_prob(a_move).mean(dim=-1),
            d_aim_res.log_prob(a_aim_res).mean(dim=-1),
            d_aim.log_prob(a_aim),
            d_bin.log_prob(a_bin).mean(dim=-1),
            d_intent.log_prob(a_intent),
            0.5 * (d_social.log_prob(a_social) + d_util.log_prob(a_util)),
        ], dim=-1)

        val = self._critic(h_top, global_state).float() if global_state is not None else None
        actions = {
            "intent": a_intent,
            "social": a_social,
            "aim": a_aim,
            "move": a_move,
            "aim_res": a_aim_res,
            "bin": a_bin,
            "util": a_util,
        }
        return actions, lp_groups, h_new, val, outs["emotion_pred"]

    def forward_teacher_outputs(
        self,
        ego_seq: torch.Tensor,
        ent_seq: torch.Tensor,
        h0: torch.Tensor,
        done_seq: torch.Tensor,
    ) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        """Fast cuDNN GRU sequence unroll over [T, N, ...] with exact episode-boundary resets."""
        T, N, _ = ego_seq.shape
        feat = self.encode_scene(
            ego_seq.reshape(T * N, EGO_OBS_DIM),
            ent_seq.reshape(T * N, NUM_ENTITIES, ENTITY_DIM),
        ).reshape(T, N, self.gru_dim)

        # Fast cuDNN path when no episode resets occur inside this T-step chunk (98%+ of chunks!)
        if T <= 1 or not bool(done_seq[:-1].any().item()):
            h_seq, _ = self.gru(feat, h0.to(feat.dtype))
        else:
            h = h0.to(feat.dtype)
            outs_h = []
            for t in range(T):
                if t > 0:
                    keep = (1.0 - done_seq[t - 1].to(h.dtype)).view(1, N, 1)
                    h = h * keep
                o_t, h = self.gru(feat[t : t + 1], h)
                outs_h.append(o_t.squeeze(0))
            h_seq = torch.stack(outs_h, dim=0)

        flat_h = h_seq.reshape(T * N, self.gru_dim)
        raw = self._heads_from_h(flat_h)
        outs = {k: v.reshape(T, N, *v.shape[1:]) for k, v in raw.items()}
        return h_seq, outs

    def evaluate_sequences(
        self,
        ego_seq: torch.Tensor,
        ent_seq: torch.Tensor,
        global_seq: torch.Tensor,
        h0: torch.Tensor,
        done_seq: torch.Tensor,
        actions: Dict[str, torch.Tensor],
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, Dict[str, torch.Tensor]]:
        """Factored MAPPO evaluation returning per-group logp [T, N, 6], entropy [T, N], values [T, N], aux dict."""
        T, N, _ = ego_seq.shape
        h_seq, outs = self.forward_teacher_outputs(ego_seq, ent_seq, h0, done_seq)
        d_intent, d_social, d_aim, d_move, d_aim_res, d_bin, d_util = self._build_dists(outs, ent_seq)

        lp_groups = torch.stack([
            d_move.log_prob(actions["move"]).mean(dim=-1),
            d_aim_res.log_prob(actions["aim_res"]).mean(dim=-1),
            d_aim.log_prob(actions["aim"]),
            d_bin.log_prob(actions["bin"]).mean(dim=-1),
            d_intent.log_prob(actions["intent"]),
            0.5 * (d_social.log_prob(actions["social"]) + d_util.log_prob(actions["util"])),
        ], dim=-1)

        entropy = (
            d_move.entropy().mean(dim=-1) * 0.45
            + d_aim_res.entropy().mean(dim=-1) * 0.35
            + d_aim.entropy() * 0.85
            + d_bin.entropy().mean(dim=-1) * 0.70
            + d_intent.entropy() * 0.55
            + d_social.entropy() * 0.35
            + d_util.entropy() * 0.40
        )

        values = self._critic(
            h_seq.reshape(T * N, self.gru_dim),
            global_seq.reshape(T * N, CRITIC_GLOBAL_DIM),
        ).reshape(T, N).float()
        return lp_groups, entropy, values, outs


class NV3BrowserCore(nn.Module):
    """Compact ~505k-param distilled browser policy core mirrored bit-for-bit in `dist/js/nv3.js`.

    Exact forward equations (1-to-1 with dist/js/nv3.js):
      e     = silu(ego_ln(ego_fc(ego)))                  # [N, 192]
      u     = silu(ent_ln(ent_fc(entities)))             # [N, 12, 128]
      q     = attn_q(e)                                  # [N, 4, 32]
      k, v  = attn_k(u), attn_v(u)                       # [N, 4, 12, 32]
      ctx   = attn_o(masked_softmax(q @ k^T / sqrt(32)) @ v)  # [N, 128]
      f     = silu(fuse_ln(fuse_fc(cat(e, ctx))))        # [N, 256]
      h_new = gru(f, h_prev)                             # [N, 256]
      heads = linear projections of h_new
    """

    def __init__(
        self,
        ego_dim: int = BROWSER_EGO_DIM,
        ent_dim: int = BROWSER_ENT_DIM,
        gru_dim: int = BROWSER_GRU_DIM,
        n_heads: int = BROWSER_ATTN_HEADS,
    ) -> None:
        super().__init__()
        self.ego_dim = ego_dim
        self.ent_dim = ent_dim
        self.gru_dim = gru_dim
        self.n_heads = n_heads
        self.d_head = ent_dim // n_heads

        self.ego_fc = ortho_init(nn.Linear(EGO_OBS_DIM, ego_dim))
        self.ego_ln = nn.LayerNorm(ego_dim, eps=1e-5)

        self.ent_fc = ortho_init(nn.Linear(ENTITY_DIM, ent_dim))
        self.ent_ln = nn.LayerNorm(ent_dim, eps=1e-5)

        self.attn_q = ortho_init(nn.Linear(ego_dim, ent_dim), gain=1.0)
        self.attn_k = ortho_init(nn.Linear(ent_dim, ent_dim), gain=1.0)
        self.attn_v = ortho_init(nn.Linear(ent_dim, ent_dim), gain=1.0)
        self.attn_o = ortho_init(nn.Linear(ent_dim, ent_dim), gain=0.8)

        self.fuse_fc = ortho_init(nn.Linear(ego_dim + ent_dim, gru_dim))
        self.fuse_ln = nn.LayerNorm(gru_dim, eps=1e-5)
        self.gru = ortho_init(nn.GRUCell(gru_dim, gru_dim))

        self.head_intent = ortho_init(nn.Linear(gru_dim, ACT_INTENT_DIM), gain=0.05)
        self.head_social = ortho_init(nn.Linear(gru_dim, ACT_SOCIAL_DIM), gain=0.05)
        self.head_aim = ortho_init(nn.Linear(gru_dim, ACT_AIM_DIM), gain=0.05)
        self.head_move = ortho_init(nn.Linear(gru_dim, ACT_MOVE_DIM), gain=0.05)
        self.head_aim_res = ortho_init(nn.Linear(gru_dim, ACT_AIM_RES_DIM), gain=0.05)
        self.head_bin = ortho_init(nn.Linear(gru_dim, ACT_BIN_DIM), gain=0.05)
        self.head_util = ortho_init(nn.Linear(gru_dim, ACT_UTIL_DIM), gain=0.05)
        self.head_emotion = ortho_init(nn.Linear(gru_dim, NUM_EMOTIONS), gain=0.20)
        self.aux_danger = ortho_init(nn.Linear(gru_dim, 2), gain=0.25)

    def encode_fused(self, ego: torch.Tensor, entities: torch.Tensor) -> torch.Tensor:
        N = ego.shape[0]
        e = F.silu(self.ego_ln(self.ego_fc(ego)))         # [N, 192]
        u = F.silu(self.ent_ln(self.ent_fc(entities)))    # [N, 12, 128]
        valid = entities[:, :, 0] > 0.5                   # [N, 12]

        q = self.attn_q(e).view(N, self.n_heads, 1, self.d_head)                    # [N, 4, 1, 32]
        k = self.attn_k(u).view(N, NUM_ENTITIES, self.n_heads, self.d_head).transpose(1, 2)  # [N, 4, 12, 32]
        v = self.attn_v(u).view(N, NUM_ENTITIES, self.n_heads, self.d_head).transpose(1, 2)

        scores = torch.matmul(q, k.transpose(-2, -1)) * (1.0 / math.sqrt(self.d_head))  # [N, 4, 1, 12]
        scores = torch.where(valid[:, None, None, :], scores, torch.full_like(scores, -1e4))
        attn = torch.softmax(scores.float(), dim=-1).to(v.dtype)
        any_v = valid.any(dim=1).view(N, 1, 1, 1)
        attn = torch.where(any_v, attn, torch.zeros_like(attn))
        ctx = torch.matmul(attn, v).squeeze(2).reshape(N, self.ent_dim)
        ctx = self.attn_o(ctx)

        return F.silu(self.fuse_ln(self.fuse_fc(torch.cat([e, ctx], dim=-1))))

    def step(self, ego: torch.Tensor, entities: torch.Tensor, h_prev: torch.Tensor) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        f = self.encode_fused(ego, entities)
        h_new = self.gru(f, h_prev.to(f.dtype)).float()
        outs = {
            "intent_logits": self.head_intent(h_new),
            "social_logits": self.head_social(h_new),
            "aim_logits": mask_nv3_aim_logits(self.head_aim(h_new), entities),
            "move_mean": torch.tanh(self.head_move(h_new)),
            "aim_res_mean": torch.tanh(self.head_aim_res(h_new)),
            "bin_logits": self.head_bin(h_new),
            "util_logits": self.head_util(h_new),
            "emotion_pred": torch.sigmoid(self.head_emotion(h_new)),
            "aux_danger": self.aux_danger(h_new),
        }
        return h_new, outs

    def forward_sequence(
        self,
        ego_seq: torch.Tensor,
        ent_seq: torch.Tensor,
        h0: torch.Tensor,
        done_seq: torch.Tensor,
    ) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        T, N, _ = ego_seq.shape
        f_seq = self.encode_fused(
            ego_seq.reshape(T * N, EGO_OBS_DIM),
            ent_seq.reshape(T * N, NUM_ENTITIES, ENTITY_DIM),
        ).reshape(T, N, self.gru_dim)

        h = h0.to(f_seq.dtype)
        hs = []
        for t in range(T):
            if t > 0:
                h = h * (1.0 - done_seq[t - 1].to(h.dtype)).unsqueeze(-1)
            h = self.gru(f_seq[t], h)
            hs.append(h)
        h_seq = torch.stack(hs, dim=0).float()
        fh = h_seq.reshape(T * N, self.gru_dim)
        outs = {
            "intent_logits": self.head_intent(fh).reshape(T, N, ACT_INTENT_DIM),
            "social_logits": self.head_social(fh).reshape(T, N, ACT_SOCIAL_DIM),
            "aim_logits": self.head_aim(fh).reshape(T, N, ACT_AIM_DIM),
            "move_mean": torch.tanh(self.head_move(fh)).reshape(T, N, ACT_MOVE_DIM),
            "aim_res_mean": torch.tanh(self.head_aim_res(fh)).reshape(T, N, ACT_AIM_RES_DIM),
            "bin_logits": self.head_bin(fh).reshape(T, N, ACT_BIN_DIM),
            "util_logits": self.head_util(fh).reshape(T, N, ACT_UTIL_DIM),
            "emotion_pred": torch.sigmoid(self.head_emotion(fh)).reshape(T, N, NUM_EMOTIONS),
            "aux_danger": self.aux_danger(fh).reshape(T, N, 2),
        }
        return h_seq, outs
