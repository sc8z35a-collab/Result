"""NV 3 Omega A100 Heavy-Duty Training Studio (4-Phase Affective MAPPO + Exploiter + Distillation).

Designed specifically to saturate Google Colab Pro NVIDIA A100 (40GB / 80GB) Tensor Cores in BF16:
  - Phase 1 (0-15%)  : Perceptual Grounding, Cover/Aim Reflexes & Affective-World Awakening
  - Phase 2 (15-55%) : Multi-Personality Squad Empathy, Cover-Peeking & PFSP League Escalation
  - Phase 3 (55-90%) : Apex 20-Snapshot PFSP League + Live Adversarial Counter-Exploiter Branch
  - Phase 4 (90-100%): High-Fidelity On-Policy Distillation (4.19M A100 Omega Teacher -> 588k NV3BrowserCore)
  - Factored 6-Group PPO Clipping (completely eliminates RNV1 multi-head ratio starvation!)
  - 5 Self-Supervised World / Theory-of-Mind / Emotion Understanding Objectives
  - Automatic 6-Panel Matplotlib Dashboard + Optional Google Drive Auto-Backup & Seamless Resume
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from .env_omega_gpu import HarborOmegaEnvGPU, gpu_nv3_cognitive_sparring
from .export_nv3 import save_nv3_bundle
from .model_nv3 import NV3BrowserCore, NV3OmegaBrain, mask_nv3_aim_logits
from .spec import (
    ACT_AIM_RES_DIM,
    ACT_BIN_DIM,
    ACT_MOVE_DIM,
    CRITIC_GLOBAL_DIM,
    EGO_OBS_DIM,
    ENTITY_DIM,
    NUM_EMOTIONS,
    NUM_ENTITIES,
    NV3_VERSION,
)


@dataclass
class NV3OmegaConfig:
    preset: str = "a100_heavy_1h"
    num_envs: int = 1024
    team_size: int = 3
    total_steps: int = 300_000_000
    rollout_steps: int = 64
    seq_len: int = 16
    ppo_epochs: int = 4
    minibatches: int = 8
    lr: float = 2.8e-4
    lr_end: float = 3.5e-5
    gamma: float = 0.992
    gae_lambda: float = 0.95
    clip_coef: float = 0.20
    vf_coef: float = 0.50
    ent_coef: float = 0.014
    ent_coef_end: float = 0.004
    aux_coef: float = 0.75
    max_grad_norm: float = 0.75
    use_bf16: bool = True
    seed: int = 2026
    league_max_size: int = 20
    league_snapshot_interval: int = 20
    exploiter_updates_per_cycle: int = 1
    eval_interval: int = 12
    eval_envs: int = 64
    eval_steps: int = 420
    save_interval: int = 15
    distill_updates: int = 80
    distill_rollout_steps: int = 32
    distill_epochs: int = 4
    distill_lr: float = 7.0e-4
    quantize: str = "q8"
    output_dir: str = "training/nv3_omega_studio/output"
    drive_dir: Optional[str] = None
    fresh_start: bool = False


NV3_PRESETS: Dict[str, Dict[str, Any]] = {
    "a100_heavy_1h": {
        "num_envs": 1024,
        "total_steps": 300_000_000,
        "rollout_steps": 64,
        "seq_len": 16,
        "ppo_epochs": 4,
        "minibatches": 8,
        "eval_interval": 15,
        "eval_envs": 64,
        "eval_steps": 450,
        "save_interval": 18,
        "distill_updates": 90,
    },
    "a100_extreme_3h": {
        "num_envs": 1024,
        "total_steps": 1_000_000_000,
        "rollout_steps": 64,
        "seq_len": 16,
        "ppo_epochs": 4,
        "minibatches": 8,
        "eval_interval": 25,
        "eval_envs": 64,
        "eval_steps": 500,
        "save_interval": 30,
        "distill_updates": 140,
    },
    "a100_omega_6h": {
        "num_envs": 1024,
        "total_steps": 2_000_000_000,
        "rollout_steps": 64,
        "seq_len": 16,
        "ppo_epochs": 4,
        "minibatches": 8,
        "eval_interval": 35,
        "eval_envs": 96,
        "eval_steps": 540,
        "save_interval": 40,
        "distill_updates": 180,
    },
    "l4_heavy_1h": {
        "num_envs": 512,
        "total_steps": 120_000_000,
        "rollout_steps": 64,
        "seq_len": 16,
        "ppo_epochs": 4,
        "minibatches": 8,
        "eval_interval": 12,
        "eval_envs": 48,
        "eval_steps": 420,
        "save_interval": 15,
        "distill_updates": 75,
    },
    "a100_verify_5m": {
        "num_envs": 512,
        "total_steps": 25_000_000,
        "rollout_steps": 64,
        "seq_len": 16,
        "ppo_epochs": 4,
        "minibatches": 8,
        "eval_interval": 6,
        "eval_envs": 48,
        "eval_steps": 360,
        "save_interval": 8,
        "distill_updates": 35,
    },
    "cpu_smoke": {
        "num_envs": 4,
        "total_steps": 3_072,
        "rollout_steps": 16,
        "seq_len": 8,
        "ppo_epochs": 2,
        "minibatches": 2,
        "eval_interval": 2,
        "eval_envs": 4,
        "eval_steps": 40,
        "save_interval": 4,
        "distill_updates": 3,
        "distill_rollout_steps": 16,
        "distill_epochs": 2,
        "use_bf16": False,
    },
}


def auto_configure_for_hardware(cfg: NV3OmegaConfig) -> Tuple[torch.device, str, float]:
    """Detect GPU & VRAM and tune arena batch size + TF32/BF16 safely for Colab A100/L4/T4/CPU."""
    if not torch.cuda.is_available():
        cfg.use_bf16 = False
        if cfg.preset != "cpu_smoke":
            cfg.num_envs = min(cfg.num_envs, 16)
            cfg.eval_envs = min(cfg.eval_envs, 8)
            cfg.minibatches = min(cfg.minibatches, 4)
        return torch.device("cpu"), "CPU", 0.0

    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True
    try:
        torch.set_float32_matmul_precision("high")
    except Exception:
        pass

    dev = torch.device("cuda")
    props = torch.cuda.get_device_properties(0)
    gpu_name = props.name
    vram_gb = props.total_memory / (1024 ** 3)
    bf16_ok = bool(torch.cuda.is_bf16_supported())
    cfg.use_bf16 = cfg.use_bf16 and bf16_ok

    if cfg.preset != "cpu_smoke":
        if vram_gb >= 72.0:
            # A100-80GB / H100: Unleash 2,048 parallel Harbor arenas = 12,288 sentient NPCs!
            cfg.num_envs = max(cfg.num_envs, 2048) if cfg.preset != "a100_verify_5m" else 1024
            cfg.minibatches = max(cfg.minibatches, 12)
        elif vram_gb >= 34.0:
            # A100-40GB: 1,024 parallel Harbor arenas = 6,144 sentient NPCs (~16-24 GB VRAM)
            cfg.num_envs = min(cfg.num_envs, 1024)
            cfg.minibatches = max(cfg.minibatches, 8)
        elif vram_gb >= 20.0:
            cfg.num_envs = min(cfg.num_envs, 512)
            cfg.minibatches = max(cfg.minibatches, 8)
        else:
            cfg.num_envs = min(cfg.num_envs, 256)
            cfg.minibatches = max(cfg.minibatches, 8)

    # Ensure num_envs is even for symmetric Team-0/Team-1 half-split
    cfg.num_envs = max(2, (cfg.num_envs // 2) * 2)
    return dev, gpu_name, vram_gb


class RunningMeanStd:
    """Numerically stable running mean/variance for return normalization."""

    def __init__(self) -> None:
        self.mean = 0.0
        self.var = 1.0
        self.count = 1e-4

    def update(self, x: torch.Tensor) -> None:
        flat = x.detach().float().reshape(-1)
        if flat.numel() == 0:
            return
        b_mean = float(flat.mean().item())
        b_var = float(flat.var(unbiased=False).item())
        b_cnt = float(flat.numel())
        delta = b_mean - self.mean
        tot = self.count + b_cnt
        new_mean = self.mean + delta * b_cnt / tot
        m_a = self.var * self.count
        m_b = b_var * b_cnt
        m2 = m_a + m_b + (delta ** 2) * self.count * b_cnt / tot
        self.mean = new_mean
        self.var = max(1e-4, m2 / tot)
        self.count = tot

    @property
    def std(self) -> float:
        return math.sqrt(self.var + 1e-6)


class PFSPLeague:
    """Prioritized Fictitious Self-Play (PFSP) League Pool for NV 3 Omega."""

    def __init__(self, max_size: int = 20) -> None:
        self.max_size = max_size
        self.entries: List[Dict[str, Any]] = []

    def add_snapshot(self, model: NV3OmegaBrain, step: int, tag: str = "main") -> None:
        cpu_sd = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        self.entries.append({
            "step": int(step),
            "tag": tag,
            "win_rate": 0.50,
            "games": 0,
            "state_dict": cpu_sd,
        })
        if len(self.entries) > self.max_size:
            # Keep oldest anchor + drop easiest mid snapshot
            drop_i = 1 + int(np.argmax([e["win_rate"] for e in self.entries[1:-1]])) if len(self.entries) > 2 else 0
            self.entries.pop(drop_i)

    def sample_index(self, rng: np.random.Generator) -> int:
        if not self.entries:
            return -1
        # PFSP weighting: prioritize opponents we beat LESS often -> f(p) = (1 - p)^2 + 0.08
        weights = np.array([(1.0 - float(e["win_rate"])) ** 2 + 0.08 for e in self.entries], dtype=np.float64)
        weights /= weights.sum()
        return int(rng.choice(len(self.entries), p=weights))

    def update_win_rate(self, idx: int, learner_wr: float) -> None:
        if 0 <= idx < len(self.entries) and learner_wr >= 0.0:
            e = self.entries[idx]
            e["win_rate"] = 0.80 * float(e["win_rate"]) + 0.20 * float(learner_wr)
            e["games"] = int(e["games"]) + 1


def _split_learner_opponent(
    t: torch.Tensor,
    half: int,
    ts: int,
) -> Tuple[torch.Tensor, torch.Tensor]:
    """Symmetric half-split: envs[:half] Team 0 + envs[half:] Team 1 = learner [B, ts, ...]."""
    learner = torch.cat([t[:half, :ts], t[half:, ts:]], dim=0)
    opp = torch.cat([t[:half, ts:], t[half:, :ts]], dim=0)
    return learner, opp


def _merge_learner_opponent(
    learner: torch.Tensor,
    opp: torch.Tensor,
    half: int,
) -> torch.Tensor:
    """Recombine [B, ts, ...] learner & opponent tensors into full [B, 2*ts, ...]."""
    top = torch.cat([learner[:half], opp[:half]], dim=1)
    bot = torch.cat([opp[half:], learner[half:]], dim=1)
    return torch.cat([top, bot], dim=0)


def _merge_action_dicts(
    a_learn: Dict[str, torch.Tensor],
    a_opp: Dict[str, torch.Tensor],
    half: int,
) -> Dict[str, torch.Tensor]:
    return {k: _merge_learner_opponent(a_learn[k], a_opp[k], half) for k in a_learn}


def _phase_schedule(progress: float) -> Tuple[int, float, float, float, float, Dict[str, float]]:
    """Return (phase_id, duel_prob, skirmish_prob, shaping_scale, smooth_coef, opponent_mix)."""
    if progress < 0.15:
        p = progress / 0.15
        duel_p = 0.55 * (1.0 - p) + 0.15 * p
        skirm_p = 0.35 + 0.30 * p
        shaping = 1.0 - 0.30 * p
        smooth = 0.45 + 0.45 * p
        mix = {"sparring": 0.65, "self": 0.35, "league": 0.0, "exploiter": 0.0}
        return 1, duel_p, skirm_p, shaping, smooth, mix
    if progress < 0.55:
        p = (progress - 0.15) / 0.40
        duel_p = 0.10 * (1.0 - p)
        skirm_p = 0.50 * (1.0 - p) + 0.10 * p
        shaping = 0.70 * (1.0 - p) + 0.18 * p
        smooth = 1.00
        mix = {"sparring": 0.30, "self": 0.30, "league": 0.40, "exploiter": 0.0}
        return 2, duel_p, skirm_p, shaping, smooth, mix
    # Phase 3 (55% -> 100% of RL stage): Apex PFSP League + Adversarial Counter-Exploiter
    p = min(1.0, (progress - 0.55) / 0.45)
    shaping = max(0.0, 0.18 * (1.0 - p))
    smooth = 1.10
    mix = {"sparring": 0.15, "self": 0.25, "league": 0.40, "exploiter": 0.20}
    return 3, 0.0, 0.0, shaping, smooth, mix


@torch.no_grad()
def evaluate_policy_vs_sparring(
    policy: nn.Module,
    is_browser_core: bool,
    device: torch.device,
    use_bf16: bool,
    eval_envs: int = 64,
    team_size: int = 3,
    eval_steps: int = 420,
    seed: int = 9999,
    harbor_map: Any = None,
) -> Dict[str, float]:
    """Evaluate NV3OmegaBrain OR distilled NV3BrowserCore vs Elite Cognitive Sparring on standard Harbor."""
    policy.eval()
    env = HarborOmegaEnvGPU(
        num_envs=eval_envs,
        team_size=team_size,
        device=device,
        harbor_map=harbor_map,
        seed=seed,
    )
    env.duel_spawn_prob = 0.0
    env.skirmish_spawn_prob = 0.0
    env.shaping_scale = 0.0
    env.enable_skills = True
    ego, ent, _ = env.reset()
    B, ts = eval_envs, team_size
    half = B // 2
    N = B * ts

    if is_browser_core:
        h = torch.zeros((N, policy.gru_dim), dtype=torch.float32, device=device)
    else:
        h = torch.zeros((policy.gru_layers, N, policy.gru_dim), dtype=torch.float32, device=device)

    amp_ctx = torch.amp.autocast("cuda", dtype=torch.bfloat16) if (device.type == "cuda" and use_bf16) else torch.amp.autocast("cpu", enabled=False)

    for _ in range(eval_steps):
        ego_l, ego_o = _split_learner_opponent(ego, half, ts)
        ent_l, ent_o = _split_learner_opponent(ent, half, ts)

        with amp_ctx:
            if is_browser_core:
                h, outs = policy.step(
                    ego_l.reshape(N, EGO_OBS_DIM),
                    ent_l.reshape(N, NUM_ENTITIES, ENTITY_DIM),
                    h,
                )
                a_l_flat = {
                    "intent": outs["intent_logits"].argmax(dim=-1),
                    "social": outs["social_logits"].argmax(dim=-1),
                    "aim": outs["aim_logits"].argmax(dim=-1),
                    "move": outs["move_mean"].float(),
                    "aim_res": outs["aim_res_mean"].float(),
                    "bin": (outs["bin_logits"].float() > 0.0).float(),
                    "util": outs["util_logits"].argmax(dim=-1),
                }
                emo_l = outs["emotion_pred"].float().reshape(B, ts, NUM_EMOTIONS)
            else:
                a_l_flat, _, h, _, emo_flat = policy.act(
                    ego_l.reshape(N, EGO_OBS_DIM),
                    ent_l.reshape(N, NUM_ENTITIES, ENTITY_DIM),
                    h,
                    global_state=None,
                    deterministic=True,
                )
                emo_l = emo_flat.float().reshape(B, ts, NUM_EMOTIONS)

        a_l = {k: v.reshape(B, ts, *v.shape[1:]) for k, v in a_l_flat.items()}
        a_o = gpu_nv3_cognitive_sparring(ego_o, ent_o, env.gen)
        acts_full = _merge_action_dicts(a_l, a_o, half)
        emo_full = _merge_learner_opponent(emo_l, torch.full_like(emo_l, 0.5), half)

        ego, ent, _, _, dones = env.step(acts_full, emo_full)
        if dones.any():
            d_rep = dones[:, None].expand(B, ts).reshape(N)
            keep = (~d_rep).float()
            if is_browser_core:
                h = h * keep.unsqueeze(-1)
            else:
                h = h * keep.view(1, N, 1)

    # Also compute partial lead rate if short smoke eval had 0 finished episodes
    m = env.pop_metrics()
    if m["win_rate"] < 0.0:
        lead0 = (env.scores[:half, 0] > env.scores[:half, 1]).float().mean().item() if half > 0 else 0.5
        lead1 = (env.scores[half:, 1] > env.scores[half:, 0]).float().mean().item() if half < B else lead0
        m["win_rate"] = 0.5 * (lead0 + lead1)
    policy.train()
    return m


def _ppo_update_brain(
    model: NV3OmegaBrain,
    optimizer: torch.optim.Optimizer,
    buf: Dict[str, torch.Tensor],
    ret_rms: RunningMeanStd,
    cfg: NV3OmegaConfig,
    ent_coef: float,
    aux_coef: float,
    device: torch.device,
    use_bf16: bool,
) -> Dict[str, float]:
    """Factored 6-Group PPO + Value + 5 Self-Supervised World/ToM/Emotion Update."""
    T, N = buf["adv"].shape
    L = cfg.seq_len
    n_seq_t = T // L
    num_chunks = n_seq_t * N

    # Reshape [T, N, ...] -> [n_seq_t, L, N, ...] -> [L, num_chunks, ...]
    def chunkify(x: torch.Tensor) -> torch.Tensor:
        tail = x.shape[2:]
        return x[: n_seq_t * L].reshape(n_seq_t, L, N, *tail).permute(1, 0, 2, *range(3, 3 + len(tail))).reshape(L, num_chunks, *tail)

    c_ego = chunkify(buf["ego"])
    c_ent = chunkify(buf["ent"])
    c_glob = chunkify(buf["glob"])
    c_done = chunkify(buf["done"])
    c_old_lp = chunkify(buf["lp_groups"])
    c_old_val = chunkify(buf["val"])
    c_ret = chunkify(buf["ret"])
    c_adv = chunkify(buf["adv"])
    c_t_emo = chunkify(buf["tgt_emo"])
    c_t_dng = chunkify(buf["tgt_danger"])
    c_t_sec = chunkify(buf["tgt_sectors"])
    c_t_tom = chunkify(buf["tgt_tom"])
    c_t_aly = chunkify(buf["tgt_ally"])

    c_act = {k: chunkify(v) for k, v in buf["act"].items()}
    # h0 at start of every L-step chunk: [n_seq_t, layers, N, H] -> [layers, num_chunks, H]
    c_h0 = buf["h_chunks"].permute(1, 0, 2, 3).reshape(model.gru_layers, num_chunks, model.gru_dim)

    ret_rms.update(c_ret)
    ret_std = max(1.0, ret_rms.std)
    c_adv = (c_adv - c_adv.mean()) / (c_adv.std() + 1e-6)

    # Per-group PPO weights [move, aim_res, aim_ptr, bin, intent, social+util]
    grp_w = torch.tensor([1.0, 1.0, 1.25, 1.15, 0.80, 0.60], dtype=torch.float32, device=device)
    grp_w = grp_w / grp_w.sum()

    mb_size = max(1, num_chunks // cfg.minibatches)
    amp_ctx = torch.amp.autocast("cuda", dtype=torch.bfloat16) if (device.type == "cuda" and use_bf16) else torch.amp.autocast("cpu", enabled=False)

    stat_pg, stat_vf, stat_ent, stat_aux, stat_kl, stat_clip = 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    stat_emo_l, stat_tom_l, stat_sec_l = 0.0, 0.0, 0.0
    n_mb = 0

    for _ in range(cfg.ppo_epochs):
        perm = torch.randperm(num_chunks, device=device)
        for start in range(0, num_chunks, mb_size):
            idx = perm[start : start + mb_size]
            if idx.numel() == 0:
                continue

            mb_act = {k: v[:, idx] for k, v in c_act.items()}
            with amp_ctx:
                new_lp_g, ent_t, new_val, outs = model.evaluate_sequences(
                    c_ego[:, idx],
                    c_ent[:, idx],
                    c_glob[:, idx],
                    c_h0[:, idx],
                    c_done[:, idx],
                    mb_act,
                )

            # ---- FACTORED 6-GROUP PPO CLIPPED OBJECTIVE (Zero Clipping Starvation!) ----
            log_ratio = torch.clamp(new_lp_g.float() - c_old_lp[:, idx].float(), -10.0, 10.0)  # [L, mb, 6]
            ratio = torch.exp(log_ratio)
            adv_exp = c_adv[:, idx].unsqueeze(-1)  # [L, mb, 1]
            pg1 = -adv_exp * ratio
            pg2 = -adv_exp * torch.clamp(ratio, 1.0 - cfg.clip_coef, 1.0 + cfg.clip_coef)
            pg_per_group = torch.maximum(pg1, pg2).mean(dim=(0, 1))  # [6]
            pg_loss = (pg_per_group * grp_w).sum()

            # Clipped value loss (return-scale stabilized)
            ret_mb = c_ret[:, idx]
            oval_mb = c_old_val[:, idx]
            v_clip = oval_mb + torch.clamp(new_val - oval_mb, -cfg.clip_coef * ret_std, cfg.clip_coef * ret_std)
            vf_loss = 0.5 * torch.maximum(((new_val - ret_mb) / ret_std) ** 2, ((v_clip - ret_mb) / ret_std) ** 2).mean()

            ent_loss = ent_t.float().mean()

            # ---- 5 Deep Self-Supervised Understanding Losses ----
            l_emo = F.mse_loss(outs["emotion_pred"].float(), c_t_emo[:, idx])
            l_dng = F.binary_cross_entropy_with_logits(outs["aux_danger"].float(), c_t_dng[:, idx])
            l_sec = F.binary_cross_entropy_with_logits(outs["aux_sectors"].float(), c_t_sec[:, idx])
            l_tom = F.binary_cross_entropy_with_logits(outs["aux_tom"].float(), c_t_tom[:, idx])
            l_aly = F.binary_cross_entropy_with_logits(outs["aux_ally"].float(), c_t_aly[:, idx])
            aux_loss = 1.6 * l_emo + 0.50 * l_dng + 0.45 * l_sec + 0.50 * l_tom + 0.40 * l_aly

            loss = pg_loss + cfg.vf_coef * vf_loss - ent_coef * ent_loss + aux_coef * aux_loss

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), cfg.max_grad_norm)
            optimizer.step()

            with torch.no_grad():
                approx_kl = ((ratio - 1.0) - log_ratio).mean().item()
                clip_frac = ((ratio - 1.0).abs() > cfg.clip_coef).float().mean().item()

            stat_pg += float(pg_loss.item())
            stat_vf += float(vf_loss.item())
            stat_ent += float(ent_loss.item())
            stat_aux += float(aux_loss.item())
            stat_emo_l += float(l_emo.item())
            stat_tom_l += float(l_tom.item())
            stat_sec_l += float(l_sec.item())
            stat_kl += float(approx_kl)
            stat_clip += float(clip_frac)
            n_mb += 1

    inv = 1.0 / max(1, n_mb)
    return {
        "pg_loss": stat_pg * inv,
        "vf_loss": stat_vf * inv,
        "entropy": stat_ent * inv,
        "aux_loss": stat_aux * inv,
        "emo_loss": stat_emo_l * inv,
        "tom_loss": stat_tom_l * inv,
        "sec_loss": stat_sec_l * inv,
        "kl": stat_kl * inv,
        "clip_frac": stat_clip * inv,
    }


def distill_omega_to_browser(
    teacher: NV3OmegaBrain,
    student: NV3BrowserCore,
    cfg: NV3OmegaConfig,
    device: torch.device,
    use_bf16: bool,
    harbor_map: Any = None,
) -> Dict[str, float]:
    """Phase 4: On-Policy High-Fidelity Distillation from 4.19M NV3OmegaBrain -> 588k NV3BrowserCore."""
    teacher.eval()
    student.train()
    for p in teacher.parameters():
        p.requires_grad_(False)

    d_envs = min(cfg.num_envs, 512) if device.type == "cuda" else min(cfg.num_envs, 4)
    d_envs = max(2, (d_envs // 2) * 2)
    ts = cfg.team_size
    half = d_envs // 2
    N = d_envs * ts
    T = cfg.distill_rollout_steps
    L = min(cfg.seq_len, T)

    env = HarborOmegaEnvGPU(
        num_envs=d_envs,
        team_size=ts,
        device=device,
        harbor_map=harbor_map,
        seed=cfg.seed + 777,
    )
    env.duel_spawn_prob = 0.0
    env.skirmish_spawn_prob = 0.0
    env.shaping_scale = 0.0
    env.enable_skills = True
    ego, ent, _ = env.reset()
    h_t = torch.zeros((teacher.gru_layers, N, teacher.gru_dim), dtype=torch.float32, device=device)
    h_s = torch.zeros((N, student.gru_dim), dtype=torch.float32, device=device)

    try:
        opt = torch.optim.AdamW(student.parameters(), lr=cfg.distill_lr, weight_decay=1e-4, fused=(device.type == "cuda"))
    except TypeError:
        opt = torch.optim.AdamW(student.parameters(), lr=cfg.distill_lr, weight_decay=1e-4)

    amp_ctx = torch.amp.autocast("cuda", dtype=torch.bfloat16) if (device.type == "cuda" and use_bf16) else torch.amp.autocast("cpu", enabled=False)

    last_loss = 0.0
    last_kl = 0.0
    t0 = time.time()

    for upd in range(1, cfg.distill_updates + 1):
        frac = 1.0 - (upd - 1) / max(1, cfg.distill_updates)
        for pg in opt.param_groups:
            pg["lr"] = cfg.distill_lr * (0.15 + 0.85 * frac)

        # DAgger-style mixing: early rollouts driven by Teacher, later 60% by Student so Student recovers from own states!
        use_student_prob = min(0.65, upd / max(1.0, cfg.distill_updates * 0.7))

        b_ego = torch.empty((T, N, EGO_OBS_DIM), dtype=torch.float32, device=device)
        b_ent = torch.empty((T, N, NUM_ENTITIES, ENTITY_DIM), dtype=torch.float32, device=device)
        b_done = torch.empty((T, N), dtype=torch.float32, device=device)
        b_ht_chunks: List[torch.Tensor] = []
        b_hs_chunks: List[torch.Tensor] = []

        with torch.no_grad():
            for t in range(T):
                if t % L == 0:
                    b_ht_chunks.append(h_t.clone())
                    b_hs_chunks.append(h_s.clone())

                ego_l, ego_o = _split_learner_opponent(ego, half, ts)
                ent_l, ent_o = _split_learner_opponent(ent, half, ts)
                ef = ego_l.reshape(N, EGO_OBS_DIM)
                enf = ent_l.reshape(N, NUM_ENTITIES, ENTITY_DIM)
                b_ego[t] = ef
                b_ent[t] = enf

                with amp_ctx:
                    t_act_f, _, h_t, _, t_emo = teacher.act(ef, enf, h_t, deterministic=False)
                    h_s, s_outs = student.step(ef, enf, h_s)

                if np.random.random() < use_student_prob:
                    a_exec_f = {
                        "intent": s_outs["intent_logits"].argmax(dim=-1),
                        "social": s_outs["social_logits"].argmax(dim=-1),
                        "aim": s_outs["aim_logits"].argmax(dim=-1),
                        "move": s_outs["move_mean"].float(),
                        "aim_res": s_outs["aim_res_mean"].float(),
                        "bin": (s_outs["bin_logits"].float() > 0.0).float(),
                        "util": s_outs["util_logits"].argmax(dim=-1),
                    }
                    emo_l = s_outs["emotion_pred"].float().reshape(d_envs, ts, NUM_EMOTIONS)
                else:
                    a_exec_f = t_act_f
                    emo_l = t_emo.float().reshape(d_envs, ts, NUM_EMOTIONS)

                a_l = {k: v.reshape(d_envs, ts, *v.shape[1:]) for k, v in a_exec_f.items()}
                a_o = gpu_nv3_cognitive_sparring(ego_o, ent_o, env.gen)
                ego, ent, _, _, dones = env.step(_merge_action_dicts(a_l, a_o, half), _merge_learner_opponent(emo_l, torch.full_like(emo_l, 0.5), half))
                d_rep = dones[:, None].expand(d_envs, ts).reshape(N)
                b_done[t] = d_rep.float()
                if dones.any():
                    keep = (~d_rep).float()
                    h_t = h_t * keep.view(1, N, 1)
                    h_s = h_s * keep.unsqueeze(-1)

        # Chunk sequences for fast GPU supervised distillation
        n_seq_t = T // L
        num_chunks = n_seq_t * N
        c_ego = b_ego[: n_seq_t * L].reshape(n_seq_t, L, N, EGO_OBS_DIM).permute(1, 0, 2, 3).reshape(L, num_chunks, EGO_OBS_DIM)
        c_ent = b_ent[: n_seq_t * L].reshape(n_seq_t, L, N, NUM_ENTITIES, ENTITY_DIM).permute(1, 0, 2, 3, 4).reshape(L, num_chunks, NUM_ENTITIES, ENTITY_DIM)
        c_done = b_done[: n_seq_t * L].reshape(n_seq_t, L, N).permute(1, 0, 2).reshape(L, num_chunks)
        c_ht0 = torch.stack(b_ht_chunks[:n_seq_t], dim=0).permute(1, 0, 2, 3).reshape(teacher.gru_layers, num_chunks, teacher.gru_dim)
        c_hs0 = torch.stack(b_hs_chunks[:n_seq_t], dim=0).reshape(num_chunks, student.gru_dim)

        mb_sz = max(1, num_chunks // min(cfg.minibatches, 8))
        l_acc, kl_acc, cnt = 0.0, 0.0, 0

        for _ in range(cfg.distill_epochs):
            perm = torch.randperm(num_chunks, device=device)
            for st in range(0, num_chunks, mb_sz):
                idx = perm[st : st + mb_sz]
                if idx.numel() == 0:
                    continue
                with torch.no_grad():
                    with amp_ctx:
                        _, t_out = teacher.forward_teacher_outputs(c_ego[:, idx], c_ent[:, idx], c_ht0[:, idx], c_done[:, idx])
                    t_aim_masked = mask_nv3_aim_logits(t_out["aim_logits"].float(), c_ent[:, idx])

                with amp_ctx:
                    _, s_out = student.forward_sequence(c_ego[:, idx], c_ent[:, idx], c_hs0[idx], c_done[:, idx])
                s_aim_masked = mask_nv3_aim_logits(s_out["aim_logits"].float(), c_ent[:, idx])

                def kl_cat(s_log: torch.Tensor, t_log: torch.Tensor) -> torch.Tensor:
                    p_t = F.softmax(t_log.float(), dim=-1)
                    log_p_t = F.log_softmax(t_log.float(), dim=-1)
                    log_p_s = F.log_softmax(s_log.float(), dim=-1)
                    return (p_t * (log_p_t - log_p_s)).sum(dim=-1).mean()

                kl_aim = kl_cat(s_aim_masked, t_aim_masked)
                kl_int = kl_cat(s_out["intent_logits"], t_out["intent_logits"])
                kl_soc = kl_cat(s_out["social_logits"], t_out["social_logits"])
                kl_uti = kl_cat(s_out["util_logits"], t_out["util_logits"])

                bce_bin = F.binary_cross_entropy_with_logits(
                    s_out["bin_logits"].float(),
                    torch.sigmoid(t_out["bin_logits"].float()),
                )
                mse_mov = F.mse_loss(s_out["move_mean"].float(), t_out["move_mean"].float())
                mse_res = F.mse_loss(s_out["aim_res_mean"].float(), t_out["aim_res_mean"].float())
                mse_emo = F.mse_loss(s_out["emotion_pred"].float(), t_out["emotion_pred"].float())
                bce_dng = F.binary_cross_entropy_with_logits(
                    s_out["aux_danger"].float(),
                    torch.sigmoid(t_out["aux_danger"].float()),
                )

                loss = (
                    1.6 * kl_aim + 0.9 * kl_int + 0.7 * kl_soc + 0.8 * kl_uti
                    + 1.6 * bce_bin + 2.2 * mse_mov + 2.5 * mse_res + 1.8 * mse_emo + 0.6 * bce_dng
                )
                opt.zero_grad(set_to_none=True)
                loss.backward()
                nn.utils.clip_grad_norm_(student.parameters(), 1.0)
                opt.step()

                l_acc += float(loss.item())
                kl_acc += float((kl_aim + kl_int + kl_soc + kl_uti).item())
                cnt += 1

        last_loss = l_acc / max(1, cnt)
        last_kl = kl_acc / max(1, cnt)
        if upd == 1 or upd % max(1, cfg.distill_updates // 5) == 0 or upd == cfg.distill_updates:
            print(f"[Phase 4 Distill {upd:3d}/{cfg.distill_updates}] loss={last_loss:.4f} | sum_KL={last_kl:.4f} | DAgger={use_student_prob*100:.0f}%")

    for p in teacher.parameters():
        p.requires_grad_(True)
    return {
        "distill_loss": last_loss,
        "distill_kl": last_kl,
        "distill_sec": time.time() - t0,
    }


def save_nv3_dashboard(history: List[Dict[str, Any]], out_png: Path, browser_eval: Optional[Dict[str, float]] = None) -> None:
    """Render 6-Panel NV 3 Sentient Human Emotion + Combat + A100 Telemetry Dashboard."""
    if not history:
        return
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return

    steps_m = [h["steps"] / 1e6 for h in history]
    fig, axes = plt.subplots(2, 3, figsize=(18, 9.5), dpi=130)
    fig.patch.set_facecolor("#0a0f18")
    for ax in axes.flat:
        ax.set_facecolor("#101827")
        ax.tick_params(colors="#cbd5e1", labelsize=9)
        ax.grid(True, color="#1e293b", alpha=0.7, linestyle="--")
        for sp in ax.spines.values():
            sp.set_color("#334155")

    # 1. Eval Win Rate
    ax = axes[0, 0]
    ev_x = [h["steps"] / 1e6 for h in history if h.get("eval_wr") is not None]
    ev_y = [h["eval_wr"] * 100.0 for h in history if h.get("eval_wr") is not None]
    if ev_x:
        ax.plot(ev_x, ev_y, color="#38bdf8", lw=2.4, marker="o", ms=4, label="Omega Teacher (4.2M)")
    if browser_eval and ev_x:
        ax.scatter([ev_x[-1]], [browser_eval.get("win_rate", 0.0) * 100.0], color="#facc15", s=95, zorder=6, marker="*", label="NV 3 Browser Core (588k)")
    ax.axhline(50.0, color="#64748b", ls=":", lw=1.2)
    ax.set_title("1. Win Rate vs Cognitive Sparring (%)", color="#f8fafc", fontweight="bold")
    ax.set_ylabel("Win Rate (%)", color="#94a3b8")
    ax.set_ylim(0, 105)
    ax.legend(facecolor="#0f172a", edgecolor="#334155", labelcolor="#e2e8f0", fontsize=8)

    # 2. Combat K/D & Accuracy
    ax = axes[0, 1]
    kds = [h.get("train_kd", 0.0) for h in history]
    accs = [h.get("train_acc", 0.0) * 100.0 for h in history]
    ax.plot(steps_m, kds, color="#fb7185", lw=2.0, label="K/D Ratio")
    ax2 = ax.twinx()
    ax2.plot(steps_m, accs, color="#34d399", lw=1.8, alpha=0.85, label="Hit Accuracy (%)")
    ax2.tick_params(colors="#34d399", labelsize=9)
    ax.set_title("2. Combat Lethality (K/D & Accuracy)", color="#f8fafc", fontweight="bold")
    ax.set_ylabel("K/D", color="#fb7185")
    ax2.set_ylabel("Acc (%)", color="#34d399")

    # 3. 8-D Human Emotion Trajectories!
    ax = axes[0, 2]
    emo_specs = [
        ("emo_composure", "Composure", "#38bdf8"),
        ("emo_fear", "Fear", "#f43f5e"),
        ("emo_courage", "Courage", "#f59e0b"),
        ("emo_focus", "Focus", "#a78bfa"),
        ("emo_frustration", "Tilt", "#fb923c"),
        ("emo_trust", "Trust", "#34d399"),
        ("emo_curiosity", "Curiosity", "#2dd4bf"),
        ("emo_relief", "Relief", "#cbd5e1"),
    ]
    for key, lbl, col in emo_specs:
        ax.plot(steps_m, [h.get(key, 0.0) for h in history], color=col, lw=1.6, label=lbl)
    ax.set_title("3. 8-D Sentient Emotion Dynamics", color="#f8fafc", fontweight="bold")
    ax.set_ylim(0, 1.02)
    ax.legend(ncol=2, facecolor="#0f172a", edgecolor="#334155", labelcolor="#e2e8f0", fontsize=7.5)

    # 4. World / ToM / Emotion Self-Supervised Losses
    ax = axes[1, 0]
    ax.plot(steps_m, [h.get("emo_loss", 0.0) for h in history], color="#facc15", lw=1.8, label="Emotion Appraisal MSE")
    ax.plot(steps_m, [h.get("tom_loss", 0.0) for h in history], color="#c084fc", lw=1.8, label="Enemy ToM BCE")
    ax.plot(steps_m, [h.get("sec_loss", 0.0) for h in history], color="#38bdf8", lw=1.8, label="6-Sector Belief BCE")
    ax.set_title("4. World / ToM / Emotion Understanding", color="#f8fafc", fontweight="bold")
    ax.set_xlabel("Policy Steps (Millions)", color="#94a3b8")
    ax.legend(facecolor="#0f172a", edgecolor="#334155", labelcolor="#e2e8f0", fontsize=8)

    # 5. Embodied Humanity (Smoothness, Breaths, Gestures, Trades)
    ax = axes[1, 1]
    ax.plot(steps_m, [h.get("smoothness", 0.0) * 100.0 for h in history], color="#2dd4bf", lw=2.0, label="Motor Smoothness (%)")
    ax3 = ax.twinx()
    ax3.plot(steps_m, [h.get("trades", 0.0) for h in history], color="#f97316", lw=1.7, label="Squad Trades")
    ax3.plot(steps_m, [h.get("breaths", 0.0) for h in history], color="#60a5fa", lw=1.5, ls="--", label="Calm Breaths")
    ax3.tick_params(colors="#f97316", labelsize=9)
    ax.set_title("5. Embodied Humanity & Squad Empathy", color="#f8fafc", fontweight="bold")
    ax.set_xlabel("Policy Steps (Millions)", color="#94a3b8")
    ax.set_ylabel("Smoothness (%)", color="#2dd4bf")

    # 6. A100 Throughput & PPO Health
    ax = axes[1, 2]
    ax.plot(steps_m, [h.get("sps", 0.0) / 1000.0 for h in history], color="#4ade80", lw=2.2, label="Throughput (k steps/s)")
    ax4 = ax.twinx()
    ax4.plot(steps_m, [h.get("clip_frac", 0.0) * 100.0 for h in history], color="#f472b6", lw=1.5, ls="--", label="Factored Clip %")
    ax4.tick_params(colors="#f472b6", labelsize=9)
    ax.set_title("6. A100 Throughput & Factored PPO Health", color="#f8fafc", fontweight="bold")
    ax.set_xlabel("Policy Steps (Millions)", color="#94a3b8")
    ax.set_ylabel("k steps / sec", color="#4ade80")
    ax4.set_ylabel("Clip %", color="#f472b6")

    fig.suptitle("NV 3 OMEGA — A100 Heavy-Duty Sentient Human RL Studio", color="#f8fafc", fontsize=15, fontweight="bold", y=0.98)
    plt.tight_layout(rect=[0, 0, 1, 0.95])
    out_png.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out_png, facecolor=fig.get_facecolor())
    plt.close(fig)


def _mirror_to_drive(out_dir: Path, drive_dir: Optional[str], filenames: Tuple[str, ...]) -> None:
    if not drive_dir:
        return
    dst_root = Path(drive_dir)
    dst_root.mkdir(parents=True, exist_ok=True)
    for fn in filenames:
        src = out_dir / fn
        if src.exists():
            try:
                shutil.copy2(src, dst_root / fn)
            except Exception:
                pass


def train_nv3_omega(cfg: NV3OmegaConfig) -> Dict[str, Any]:
    """Execute full 4-Phase NV 3 Omega A100 training + Browser Distillation + Export."""
    torch.manual_seed(cfg.seed)
    np.random.seed(cfg.seed)
    rng = np.random.default_rng(cfg.seed)

    device, gpu_name, vram_gb = auto_configure_for_hardware(cfg)
    out_dir = Path(cfg.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    B = cfg.num_envs
    ts = cfg.team_size
    half = B // 2
    N = B * ts  # learner agents per policy step
    T = cfg.rollout_steps
    steps_per_update = N * T

    teacher = NV3OmegaBrain().to(device)
    exploiter = NV3OmegaBrain().to(device)
    opp_net = NV3OmegaBrain().to(device)
    opp_net.eval()
    student = NV3BrowserCore().to(device)

    teacher_params = sum(p.numel() for p in teacher.parameters())
    student_params = sum(p.numel() for p in student.parameters())

    try:
        opt_main = torch.optim.AdamW(teacher.parameters(), lr=cfg.lr, eps=1e-5, weight_decay=1e-4, fused=(device.type == "cuda"))
        opt_exp = torch.optim.AdamW(exploiter.parameters(), lr=cfg.lr * 0.9, eps=1e-5, weight_decay=1e-4, fused=(device.type == "cuda"))
    except TypeError:
        opt_main = torch.optim.AdamW(teacher.parameters(), lr=cfg.lr, eps=1e-5, weight_decay=1e-4)
        opt_exp = torch.optim.AdamW(exploiter.parameters(), lr=cfg.lr * 0.9, eps=1e-5, weight_decay=1e-4)

    ret_rms = RunningMeanStd()
    exp_ret_rms = RunningMeanStd()
    league = PFSPLeague(max_size=cfg.league_max_size)
    history: List[Dict[str, Any]] = []
    global_steps = 0
    best_eval_wr = -1.0
    best_teacher_sd: Optional[Dict[str, torch.Tensor]] = None

    ckpt_path = out_dir / "nv3_omega_checkpoint.pt"
    drive_ckpt = Path(cfg.drive_dir) / "nv3_omega_checkpoint.pt" if cfg.drive_dir else None
    resume_src = ckpt_path if ckpt_path.exists() else (drive_ckpt if (drive_ckpt and drive_ckpt.exists()) else None)
    if not cfg.fresh_start and resume_src is not None:
        print(f"[NV 3 Omega] Resuming from checkpoint: {resume_src}")
        ck = torch.load(resume_src, map_location=device, weights_only=False)
        teacher.load_state_dict(ck["teacher"])
        if "exploiter" in ck:
            exploiter.load_state_dict(ck["exploiter"])
        if "student" in ck:
            student.load_state_dict(ck["student"])
        if "opt_main" in ck:
            try:
                opt_main.load_state_dict(ck["opt_main"])
            except Exception:
                pass
        global_steps = int(ck.get("global_steps", 0))
        best_eval_wr = float(ck.get("best_eval_wr", -1.0))
        history = list(ck.get("history", []))
        if ck.get("league_entries"):
            league.entries = ck["league_entries"]
    else:
        exploiter.load_state_dict(teacher.state_dict())

    print("=" * 84)
    print(f" NV 3 OMEGA — A100 Heavy-Duty Sentient Human RL Studio ({cfg.preset})")
    print(f" Hardware     : {gpu_name} ({vram_gb:.1f} GB VRAM) | BF16={cfg.use_bf16}")
    print(f" Simulation   : {B} parallel Harbor arenas x {ts*2} NPCs = {B*ts*2:,} concurrent sentient agents!")
    print(f" Omega Brain  : {teacher_params:,} params -> Browser Core: {student_params:,} params ({cfg.quantize})")
    print(f" Budget       : {cfg.total_steps:,} steps ({steps_per_update:,} learner steps/update)")
    print("=" * 84)

    env = HarborOmegaEnvGPU(
        num_envs=B,
        team_size=ts,
        device=device,
        seed=cfg.seed,
    )
    env.duel_spawn_prob = 0.55
    env.skirmish_spawn_prob = 0.35
    env.shaping_scale = 1.0
    env.enable_skills = True
    ego, ent, glob = env.reset()

    h_learn = torch.zeros((teacher.gru_layers, N, teacher.gru_dim), dtype=torch.float32, device=device)
    h_opp = torch.zeros((teacher.gru_layers, N, teacher.gru_dim), dtype=torch.float32, device=device)

    amp_ctx = torch.amp.autocast("cuda", dtype=torch.bfloat16) if (device.type == "cuda" and cfg.use_bf16) else torch.amp.autocast("cpu", enabled=False)

    # Pre-allocate GPU rollout buffers for zero-fragmentation A100 throughput
    n_seq_t = T // cfg.seq_len
    buf_ego = torch.empty((T, N, EGO_OBS_DIM), dtype=torch.float32, device=device)
    buf_ent = torch.empty((T, N, NUM_ENTITIES, ENTITY_DIM), dtype=torch.float32, device=device)
    buf_glob = torch.empty((T, N, CRITIC_GLOBAL_DIM), dtype=torch.float32, device=device)
    buf_rew = torch.empty((T, N), dtype=torch.float32, device=device)
    buf_done = torch.empty((T, N), dtype=torch.float32, device=device)
    buf_val = torch.empty((T, N), dtype=torch.float32, device=device)
    buf_lp = torch.empty((T, N, 6), dtype=torch.float32, device=device)
    buf_h_chunks = torch.empty((n_seq_t, teacher.gru_layers, N, teacher.gru_dim), dtype=torch.float32, device=device)

    buf_t_emo = torch.empty((T, N, NUM_EMOTIONS), dtype=torch.float32, device=device)
    buf_t_dng = torch.empty((T, N, 2), dtype=torch.float32, device=device)
    buf_t_sec = torch.empty((T, N, 6), dtype=torch.float32, device=device)
    buf_t_tom = torch.empty((T, N, 4), dtype=torch.float32, device=device)
    buf_t_aly = torch.empty((T, N, 2), dtype=torch.float32, device=device)

    buf_act = {
        "intent": torch.empty((T, N), dtype=torch.long, device=device),
        "social": torch.empty((T, N), dtype=torch.long, device=device),
        "aim": torch.empty((T, N), dtype=torch.long, device=device),
        "move": torch.empty((T, N, ACT_MOVE_DIM), dtype=torch.float32, device=device),
        "aim_res": torch.empty((T, N, ACT_AIM_RES_DIM), dtype=torch.float32, device=device),
        "bin": torch.empty((T, N, ACT_BIN_DIM), dtype=torch.float32, device=device),
        "util": torch.empty((T, N), dtype=torch.long, device=device),
    }

    t_start = time.time()
    update_idx = 0
    total_updates = max(1, math.ceil((cfg.total_steps - global_steps) / steps_per_update))

    while global_steps < cfg.total_steps:
        update_idx += 1
        upd_t0 = time.time()
        progress = min(1.0, global_steps / max(1.0, float(cfg.total_steps)))
        phase, duel_p, skirm_p, shaping_scale, smooth_coef, opp_mix = _phase_schedule(progress)
        env.duel_spawn_prob = duel_p
        env.skirmish_spawn_prob = skirm_p
        env.shaping_scale = shaping_scale
        env.human_smooth_coef = smooth_coef

        # Cosine LR & linear entropy annealing
        cos_f = 0.5 * (1.0 + math.cos(math.pi * progress))
        cur_lr = cfg.lr_end + (cfg.lr - cfg.lr_end) * cos_f
        cur_ent = cfg.ent_coef_end + (cfg.ent_coef - cfg.ent_coef_end) * (1.0 - progress)
        cur_aux = cfg.aux_coef * (0.45 + 0.55 * (1.0 - progress))
        for pg in opt_main.param_groups:
            pg["lr"] = cur_lr

        # Select opponent mode for this rollout cycle (PFSP / Sparring / Self-Play / Counter-Exploiter)
        r_opp = float(rng.random())
        league_idx = -1
        train_exploiter_turn = False
        if phase == 3 and (update_idx % 5 == 0):
            # Dedicated Counter-Exploiter training turn: Exploiter learns to beat frozen Main!
            opp_mode = "exploiter_train"
            train_exploiter_turn = True
        elif r_opp < opp_mix["sparring"]:
            opp_mode = "sparring"
        elif r_opp < opp_mix["sparring"] + opp_mix["self"]:
            opp_mode = "self"
        elif league.entries and r_opp < opp_mix["sparring"] + opp_mix["self"] + opp_mix["league"]:
            opp_mode = "league"
            league_idx = league.sample_index(rng)
            opp_net.load_state_dict(league.entries[league_idx]["state_dict"])
            opp_net.eval()
        elif phase == 3:
            opp_mode = "exploiter"
        else:
            opp_mode = "sparring"

        active_learner = exploiter if train_exploiter_turn else teacher
        active_opt = opt_exp if train_exploiter_turn else opt_main
        active_rms = exp_ret_rms if train_exploiter_turn else ret_rms
        active_learner.eval()

        with torch.no_grad():
            for t in range(T):
                if t % cfg.seq_len == 0:
                    buf_h_chunks[t // cfg.seq_len].copy_(h_learn)

                ego_l, ego_o = _split_learner_opponent(ego, half, ts)
                ent_l, ent_o = _split_learner_opponent(ent, half, ts)
                glob_l, _ = _split_learner_opponent(glob, half, ts)

                t_emo_l, _ = _split_learner_opponent(env.tgt_emotion, half, ts)
                t_dng_l, _ = _split_learner_opponent(env.tgt_danger, half, ts)
                t_sec_l, _ = _split_learner_opponent(env.tgt_sectors, half, ts)
                t_tom_l, _ = _split_learner_opponent(env.tgt_tom, half, ts)
                t_aly_l, _ = _split_learner_opponent(env.tgt_ally, half, ts)

                ef = ego_l.reshape(N, EGO_OBS_DIM)
                enf = ent_l.reshape(N, NUM_ENTITIES, ENTITY_DIM)
                gf = glob_l.reshape(N, CRITIC_GLOBAL_DIM)

                buf_ego[t] = ef
                buf_ent[t] = enf
                buf_glob[t] = gf
                buf_t_emo[t] = t_emo_l.reshape(N, NUM_EMOTIONS)
                buf_t_dng[t] = t_dng_l.reshape(N, 2)
                buf_t_sec[t] = t_sec_l.reshape(N, 6)
                buf_t_tom[t] = t_tom_l.reshape(N, 4)
                buf_t_aly[t] = t_aly_l.reshape(N, 2)

                with amp_ctx:
                    a_l_f, lp_g, h_learn, val_f, emo_l_f = active_learner.act(ef, enf, h_learn, gf, deterministic=False)

                buf_lp[t] = lp_g.float()
                buf_val[t] = val_f.float()
                for k in buf_act:
                    buf_act[k][t] = a_l_f[k]

                a_l = {k: v.reshape(B, ts, *v.shape[1:]) for k, v in a_l_f.items()}
                emo_l = emo_l_f.float().reshape(B, ts, NUM_EMOTIONS)

                # Opponent inference
                if opp_mode == "sparring":
                    a_o = gpu_nv3_cognitive_sparring(ego_o, ent_o, env.gen)
                    emo_o = torch.full_like(emo_l, 0.5)
                else:
                    eof = ego_o.reshape(N, EGO_OBS_DIM)
                    enof = ent_o.reshape(N, NUM_ENTITIES, ENTITY_DIM)
                    o_model = teacher if (opp_mode in ("self", "exploiter_train")) else (exploiter if opp_mode == "exploiter" else opp_net)
                    with amp_ctx:
                        a_o_f, _, h_opp, _, emo_o_f = o_model.act(eof, enof, h_opp, deterministic=False)
                    a_o = {k: v.reshape(B, ts, *v.shape[1:]) for k, v in a_o_f.items()}
                    emo_o = emo_o_f.float().reshape(B, ts, NUM_EMOTIONS)

                acts_full = _merge_action_dicts(a_l, a_o, half)
                emo_full = _merge_learner_opponent(emo_l, emo_o, half)
                ego, ent, glob, rew_full, dones = env.step(acts_full, emo_full)

                rew_l, _ = _split_learner_opponent(rew_full, half, ts)
                buf_rew[t] = rew_l.reshape(N)
                d_rep = dones[:, None].expand(B, ts).reshape(N)
                buf_done[t] = d_rep.float()

                if dones.any():
                    keep = (~d_rep).float().view(1, N, 1)
                    h_learn = h_learn * keep
                    h_opp = h_opp * keep

            # Bootstrap final value for GAE
            ego_l, _ = _split_learner_opponent(ego, half, ts)
            ent_l, _ = _split_learner_opponent(ent, half, ts)
            glob_l, _ = _split_learner_opponent(glob, half, ts)
            with amp_ctx:
                _, _, _, next_val, _ = active_learner.act(
                    ego_l.reshape(N, EGO_OBS_DIM),
                    ent_l.reshape(N, NUM_ENTITIES, ENTITY_DIM),
                    h_learn,
                    glob_l.reshape(N, CRITIC_GLOBAL_DIM),
                    deterministic=True,
                )
            next_val = next_val.float()

            adv = torch.zeros((T, N), dtype=torch.float32, device=device)
            last_gae = torch.zeros((N,), dtype=torch.float32, device=device)
            for t in reversed(range(T)):
                nt = 1.0 - buf_done[t]
                nv = next_val if t == T - 1 else buf_val[t + 1]
                delta = buf_rew[t] + cfg.gamma * nv * nt - buf_val[t]
                last_gae = delta + cfg.gamma * cfg.gae_lambda * nt * last_gae
                adv[t] = last_gae
            ret = adv + buf_val

        active_learner.train()
        ppo_stats = _ppo_update_brain(
            active_learner,
            active_opt,
            {
                "ego": buf_ego, "ent": buf_ent, "glob": buf_glob, "done": buf_done,
                "lp_groups": buf_lp, "val": buf_val, "ret": ret, "adv": adv,
                "h_chunks": buf_h_chunks, "act": buf_act,
                "tgt_emo": buf_t_emo, "tgt_danger": buf_t_dng,
                "tgt_sectors": buf_t_sec, "tgt_tom": buf_t_tom, "tgt_ally": buf_t_aly,
            },
            active_rms,
            cfg,
            cur_ent,
            cur_aux,
            device,
            cfg.use_bf16,
        )

        global_steps += steps_per_update
        env_m = env.pop_metrics()
        if opp_mode == "league" and league_idx >= 0 and env_m["win_rate"] >= 0.0:
            league.update_win_rate(league_idx, env_m["win_rate"])

        if update_idx % cfg.league_snapshot_interval == 0:
            league.add_snapshot(teacher, global_steps, tag=f"p{phase}")
            if phase == 3:
                league.add_snapshot(exploiter, global_steps, tag="exploiter")

        upd_dt = max(1e-4, time.time() - upd_t0)
        sps = steps_per_update / upd_dt
        eval_wr = None
        eval_kd = None
        eval_acc = None

        if update_idx == 1 or update_idx % cfg.eval_interval == 0 or global_steps >= cfg.total_steps:
            ev = evaluate_policy_vs_sparring(
                teacher, False, device, cfg.use_bf16,
                eval_envs=cfg.eval_envs, team_size=ts, eval_steps=cfg.eval_steps, seed=cfg.seed + update_idx,
                harbor_map=env.map,
            )
            eval_wr = ev["win_rate"]
            eval_kd = ev["kd"]
            eval_acc = ev["acc"]
            if eval_wr >= best_eval_wr:
                best_eval_wr = eval_wr
                best_teacher_sd = {k: v.detach().cpu().clone() for k, v in teacher.state_dict().items()}

        row = {
            "update": update_idx,
            "steps": global_steps,
            "phase": phase,
            "opp": opp_mode,
            "sps": sps,
            "train_kd": env_m["kd"],
            "train_acc": env_m["acc"],
            "train_wr": env_m["win_rate"],
            "trades": env_m["trades"],
            "breaths": env_m["breaths"],
            "gestures": env_m["gestures"],
            "smoothness": env_m["smoothness"],
            "emo_composure": env_m["emo_composure"],
            "emo_fear": env_m["emo_fear"],
            "emo_courage": env_m["emo_courage"],
            "emo_focus": env_m["emo_focus"],
            "emo_frustration": env_m["emo_frustration"],
            "emo_trust": env_m["emo_trust"],
            "emo_curiosity": env_m["emo_curiosity"],
            "emo_relief": env_m["emo_relief"],
            "eval_wr": eval_wr,
            "eval_kd": eval_kd,
            "eval_acc": eval_acc,
            **ppo_stats,
        }
        history.append(row)

        if update_idx == 1 or update_idx % max(1, min(5, cfg.eval_interval)) == 0 or eval_wr is not None:
            vram_used = (torch.cuda.max_memory_allocated() / (1024 ** 3)) if device.type == "cuda" else 0.0
            ev_s = f" | EVAL WR={eval_wr*100:5.1f}% KD={eval_kd:4.2f} ACC={eval_acc*100:4.1f}%" if eval_wr is not None else ""
            print(
                f"[P{phase} U{update_idx:4d} | {global_steps/1e6:7.2f}M/{cfg.total_steps/1e6:.1f}M | {sps/1e3:6.1f}k/s | {vram_used:4.1f}GB | {opp_mode:9s}] "
                f"KD={env_m['kd']:.2f} ACC={env_m['acc']*100:4.1f}% SM={env_m['smoothness']*100:4.1f}% "
                f"EMO(C={env_m['emo_composure']:.2f}/F={env_m['emo_fear']:.2f}/G={env_m['emo_courage']:.2f}) "
                f"aux={ppo_stats['aux_loss']:.3f} clip={ppo_stats['clip_frac']*100:4.1f}%{ev_s}"
            )

        if update_idx % cfg.save_interval == 0 or global_steps >= cfg.total_steps:
            torch.save(
                {
                    "teacher": teacher.state_dict(),
                    "exploiter": exploiter.state_dict(),
                    "student": student.state_dict(),
                    "opt_main": opt_main.state_dict(),
                    "global_steps": global_steps,
                    "best_eval_wr": best_eval_wr,
                    "history": history,
                    "league_entries": league.entries[-8:],  # keep recent 8 snapshots compactly
                    "config": asdict(cfg),
                },
                ckpt_path,
            )
            save_nv3_dashboard(history, out_dir / "nv3_omega_dashboard.png")
            (out_dir / "metrics.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
            _mirror_to_drive(out_dir, cfg.drive_dir, ("nv3_omega_checkpoint.pt", "nv3_omega_dashboard.png", "metrics.json"))

    # ---- PHASE 4: High-Fidelity On-Policy Distillation (Best Omega Teacher -> NV3BrowserCore) ----
    print("=" * 84)
    print(" PHASE 4: Distilling 4.19M NV3OmegaBrain -> 588k 360Hz NV3BrowserCore...")
    print("=" * 84)
    if best_teacher_sd is not None:
        teacher.load_state_dict(best_teacher_sd)

    distill_stats = distill_omega_to_browser(teacher, student, cfg, device, cfg.use_bf16, harbor_map=env.map)
    browser_eval = evaluate_policy_vs_sparring(
        student, True, device, cfg.use_bf16,
        eval_envs=cfg.eval_envs, team_size=ts, eval_steps=cfg.eval_steps, seed=cfg.seed + 55555,
        harbor_map=env.map,
    )
    print(
        f"[NV 3 BrowserCore Final Eval] WR={browser_eval['win_rate']*100:.1f}% | "
        f"KD={browser_eval['kd']:.2f} | ACC={browser_eval['acc']*100:.1f}% | "
        f"Smoothness={browser_eval['smoothness']*100:.1f}% | Trades={browser_eval['trades']:.0f} | Breaths={browser_eval['breaths']:.0f}"
    )

    elapsed = time.time() - t_start
    meta = {
        "displayName": NV3_VERSION,
        "trained": True,
        "preset": cfg.preset,
        "gpu": gpu_name,
        "steps": int(global_steps),
        "teacherParams": int(teacher_params),
        "paramCount": int(student_params),
        "teacherEvalWinRate": round(float(max(best_eval_wr, 0.0)), 4),
        "evalWinRate": round(float(browser_eval["win_rate"]), 4),
        "evalKD": round(float(browser_eval["kd"]), 3),
        "evalAcc": round(float(browser_eval["acc"]), 4),
        "distillKL": round(float(distill_stats["distill_kl"]), 4),
        "smoothness": round(float(browser_eval["smoothness"]), 4),
        "elapsedSec": round(float(elapsed), 1),
    }

    weights_path = save_nv3_bundle(student, out_dir / "nv3-weights.json", quantize=cfg.quantize, meta=meta)
    save_nv3_dashboard(history, out_dir / "nv3_omega_dashboard.png", browser_eval=browser_eval)
    (out_dir / "metrics.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    torch.save(
        {
            "teacher": teacher.state_dict(),
            "exploiter": exploiter.state_dict(),
            "student": student.state_dict(),
            "global_steps": global_steps,
            "best_eval_wr": best_eval_wr,
            "browser_eval": browser_eval,
            "distill_stats": distill_stats,
            "meta": meta,
            "history": history,
            "config": asdict(cfg),
        },
        ckpt_path,
    )
    _mirror_to_drive(
        out_dir,
        cfg.drive_dir,
        ("nv3-weights.json", "nv3_omega_checkpoint.pt", "nv3_omega_dashboard.png", "metrics.json"),
    )

    size_kb = weights_path.stat().st_size / 1024.0
    print("=" * 84)
    print(f" COMPLETE! Exported {weights_path} ({size_kb:.1f} KB) in {elapsed/60.0:.1f} min")
    print("=" * 84)
    return {
        "weights_path": str(weights_path),
        "dashboard_path": str(out_dir / "nv3_omega_dashboard.png"),
        "meta": meta,
        "browser_eval": browser_eval,
        "distill_stats": distill_stats,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="NV 3 Omega A100 Heavy-Duty Sentient Human RL Studio")
    ap.add_argument("--preset", type=str, default="a100_heavy_1h", choices=list(NV3_PRESETS.keys()))
    ap.add_argument("--output-dir", type=str, default="training/nv3_omega_studio/output")
    ap.add_argument("--drive-dir", type=str, default=None)
    ap.add_argument("--total-steps", type=int, default=None)
    ap.add_argument("--num-envs", type=int, default=None)
    ap.add_argument("--quantize", type=str, default="q8", choices=["q8", "f32"])
    ap.add_argument("--fresh-start", action="store_true")
    ap.add_argument("--seed", type=int, default=2026)
    args = ap.parse_args()

    p = copy.deepcopy(NV3_PRESETS[args.preset])
    cfg = NV3OmegaConfig(preset=args.preset, output_dir=args.output_dir, drive_dir=args.drive_dir, quantize=args.quantize, fresh_start=args.fresh_start, seed=args.seed, **p)
    if args.total_steps is not None:
        cfg.total_steps = args.total_steps
    if args.num_envs is not None:
        cfg.num_envs = args.num_envs

    train_nv3_omega(cfg)


if __name__ == "__main__":
    main()
