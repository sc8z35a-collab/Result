"""RNV1 A100 High-Speed Self-Play RL Training Studio (CTDE MAPPO + Recurrent BPTT + PFSP League).

Designed specifically to saturate NVIDIA A100 (40GB / 80GB) GPUs on Google Colab Pro
while also scaling gracefully down to L4/T4/CPU for verification and testing.
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

from .env_gpu import HarborStudioGPU, gpu_sparring_policy
from .export_weights import save_actor_bundle
from .harbor_map import HarborMapGPU
from .model import RNV1Actor, RNV1ActorCritic
from .spec import (
    ACT_BIN_DIM,
    ACT_CONT_DIM,
    CRITIC_GLOBAL_DIM,
    DEFAULT_HIDDEN_DIM,
    OBS_DIM,
    RNV1_VERSION,
)


@dataclass
class StudioConfig:
    preset: str = "a100_pro_fast"
    total_steps: int = 100_000_000
    num_envs: int = 0          # 0 = auto-detect from GPU VRAM (2048 on A100-80GB, 1536 on A100-40GB)
    team_size: int = 3
    rollout_steps: int = 32
    seq_chunk: int = 16
    ppo_epochs: int = 3
    num_minibatches: int = 8
    hidden_dim: int = DEFAULT_HIDDEN_DIM
    lr_start: float = 3.2e-4
    lr_end: float = 3.0e-5
    gamma: float = 0.992
    gae_lambda: float = 0.95
    clip_coef: float = 0.18
    vf_coef: float = 0.50
    aux_coef: float = 0.20
    max_grad_norm: float = 0.50
    max_episode_steps: int = 900  # 45 seconds @ 20 Hz per match
    league_max_size: int = 14
    snapshot_every_updates: int = 18
    eval_every_updates: int = 20
    save_every_updates: int = 25
    seed: int = 2026
    output_dir: str = "rnv1_outputs"
    drive_dir: str = ""
    fresh_start: bool = True
    use_compile: bool = False


PRESETS: Dict[str, Dict[str, Any]] = {
    "cpu_smoke": {
        "total_steps": 12_000,
        "num_envs": 8,
        "rollout_steps": 16,
        "seq_chunk": 8,
        "ppo_epochs": 2,
        "num_minibatches": 2,
        "max_episode_steps": 120,
        "snapshot_every_updates": 2,
        "eval_every_updates": 2,
        "save_every_updates": 2,
    },
    "a100_quick_test": {
        "total_steps": 15_000_000,
        "rollout_steps": 32,
        "seq_chunk": 16,
        "ppo_epochs": 3,
        "num_minibatches": 8,
        "snapshot_every_updates": 8,
        "eval_every_updates": 8,
        "save_every_updates": 10,
    },
    "a100_pro_fast": {
        "total_steps": 100_000_000,
        "rollout_steps": 32,
        "seq_chunk": 16,
        "ppo_epochs": 3,
        "num_minibatches": 8,
        "snapshot_every_updates": 16,
        "eval_every_updates": 16,
        "save_every_updates": 20,
    },
    "a100_pro_max": {
        "total_steps": 250_000_000,
        "rollout_steps": 32,
        "seq_chunk": 16,
        "ppo_epochs": 3,
        "num_minibatches": 8,
        "snapshot_every_updates": 24,
        "eval_every_updates": 24,
        "save_every_updates": 30,
    },
}


def detect_hardware(cfg: StudioConfig) -> Dict[str, Any]:
    """Configure TF32, BF16 AMP, fused AdamW, and optimal arena parallelism for A100/GPU/CPU."""
    has_cuda = torch.cuda.is_available()
    info: Dict[str, Any] = {
        "device": torch.device("cuda" if has_cuda else "cpu"),
        "gpu_name": "CPU",
        "vram_gb": 0.0,
        "use_bf16": False,
        "use_fp16": False,
        "fused_adam": False,
    }
    if has_cuda:
        props = torch.cuda.get_device_properties(0)
        vram_gb = props.total_memory / (1024 ** 3)
        name = props.name
        info["gpu_name"] = name
        info["vram_gb"] = round(vram_gb, 1)

        # Enable A100 TF32 Tensor Cores + high matmul throughput
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.set_float32_matmul_precision("high")

        # Native BF16 on Ampere+ (A100 / L4 / H100) — zero GradScaler overflow risk!
        bf16_ok = torch.cuda.is_bf16_supported()
        info["use_bf16"] = bf16_ok
        info["use_fp16"] = not bf16_ok
        info["fused_adam"] = True

        if cfg.num_envs <= 0:
            if vram_gb >= 70.0:
                cfg.num_envs = 2048  # A100 80GB: 12,288 live 3v3 agents!
            elif vram_gb >= 35.0:
                cfg.num_envs = 1536  # A100 40GB: 9,216 live 3v3 agents!
            elif vram_gb >= 20.0:
                cfg.num_envs = 768   # L4 / A10G 24GB
            else:
                cfg.num_envs = 384   # T4 / V100 16GB
    else:
        if cfg.num_envs <= 0:
            cfg.num_envs = 8
    # Keep num_envs even so half arenas train Team 0 (South) and half train Team 1 (North)
    cfg.num_envs = max(2, (cfg.num_envs // 2) * 2)
    return info


class PFSPLeague:
    """AlphaStar-style Prioritized Fictitious Self-Play historical opponent pool."""

    def __init__(self, max_size: int, obs_dim: int, hidden_dim: int, device: torch.device) -> None:
        self.max_size = max_size
        self.obs_dim = obs_dim
        self.hidden_dim = hidden_dim
        self.device = device
        self.snapshots: List[Dict[str, Any]] = []
        self.active_actor = RNV1Actor(obs_dim=obs_dim, hidden_dim=hidden_dim).to(device).eval()
        self.active_idx: int = -1

    def add_snapshot(self, actor: RNV1Actor, step: int, rating: float = 1000.0) -> None:
        sd = {k: v.detach().cpu().clone() for k, v in actor.state_dict().items()}
        entry = {"step": int(step), "state_dict": sd, "win_rate": 0.5, "games": 0, "rating": rating}
        if len(self.snapshots) >= self.max_size:
            # Retain earliest anchor + evenly spaced milestones, evict easiest beaten middle snapshot
            evict_i = 1
            best_wr = -1.0
            for i in range(1, len(self.snapshots) - 1):
                if self.snapshots[i]["win_rate"] > best_wr:
                    best_wr = self.snapshots[i]["win_rate"]
                    evict_i = i
            self.snapshots.pop(evict_i)
        self.snapshots.append(entry)

    def sample_opponent(self, rng: np.random.Generator) -> bool:
        """Load a PFSP-weighted historical opponent into `self.active_actor`."""
        if not self.snapshots:
            return False
        wrs = np.array([s["win_rate"] for s in self.snapshots], dtype=np.float64)
        # Prioritize snapshots that challenge the learner most: (1 - wr)^2 + floor
        probs = (1.0 - np.clip(wrs, 0.05, 0.95)) ** 2 + 0.15
        probs /= probs.sum()
        idx = int(rng.choice(len(self.snapshots), p=probs))
        self.active_idx = idx
        self.active_actor.load_state_dict(self.snapshots[idx]["state_dict"])
        self.active_actor.eval()
        return True

    def update_result(self, learner_wr: float) -> None:
        if 0 <= self.active_idx < len(self.snapshots) and learner_wr >= 0.0:
            s = self.snapshots[self.active_idx]
            s["win_rate"] = 0.85 * s["win_rate"] + 0.15 * learner_wr
            s["games"] += 1


def curriculum_schedule(progress: float) -> Dict[str, Any]:
    """Smooth 3-stage curriculum from random initialization -> Apex Self-Play Championship."""
    p = float(np.clip(progress, 0.0, 1.0))
    if p < 0.25:
        u = p / 0.25
        return {
            "stage": 1,
            "stage_name": "Stage 1: 一から基礎戦闘・照準・移動習得",
            "shaping": 1.0 - 0.45 * u,
            "skirmish_prob": 0.65 - 0.10 * u,
            "frac_sparring": 0.48 - 0.18 * u,
            "frac_pfsp": 0.20 * u,
            "ent_coef": 0.016 - 0.004 * u,
        }
    elif p < 0.70:
        u = (p - 0.25) / 0.45
        return {
            "stage": 2,
            "stage_name": "Stage 2: PFSPリーグ・遮蔽ピーク・分隊クロスファイア",
            "shaping": 0.55 - 0.40 * u,
            "skirmish_prob": 0.55 - 0.20 * u,
            "frac_sparring": 0.22 - 0.10 * u,
            "frac_pfsp": 0.35 + 0.10 * u,
            "ent_coef": 0.012 - 0.006 * u,
        }
    else:
        u = (p - 0.70) / 0.30
        return {
            "stage": 3,
            "stage_name": "Stage 3: 頂点セルフプレイ・実戦フルマップ仕上げ",
            "shaping": 0.15 - 0.13 * u,
            "skirmish_prob": 0.35 - 0.15 * u,
            "frac_sparring": 0.10,
            "frac_pfsp": 0.45,
            "ent_coef": 0.006 - 0.0035 * u,
        }


@torch.no_grad()
def evaluate_vs_sparring(
    model: RNV1ActorCritic,
    harbor_map: HarborMapGPU,
    device: torch.device,
    team_size: int = 3,
    num_envs: int = 32,
    eval_steps: int = 450,
    use_bf16: bool = False,
) -> Dict[str, float]:
    """Deterministic side-balanced benchmark of RNV1 against the GPU tactical sparring bot."""
    eval_env = HarborStudioGPU(
        num_envs=num_envs,
        team_size=team_size,
        max_steps=eval_steps + 10,
        device=device,
        harbor_map=harbor_map,
        seed=9091,
    )
    eval_env.shaping_scale = 0.0
    eval_env.skirmish_spawn_prob = 0.35
    obs, _ = eval_env.reset()

    half = num_envs // 2
    ts = team_size
    h_learn = torch.zeros((num_envs * ts, model.hidden_dim), device=device)

    model.eval()
    amp_ctx = torch.amp.autocast("cuda", dtype=torch.bfloat16) if (use_bf16 and device.type == "cuda") else torch.amp.autocast("cpu", enabled=False)

    for _ in range(eval_steps):
        # Learner controls Team 0 on [0:half] and Team 1 on [half:]
        obs_l = torch.cat([obs[:half, :ts], obs[half:, ts:]], dim=0).reshape(-1, OBS_DIM)
        obs_o = torch.cat([obs[:half, ts:], obs[half:, :ts]], dim=0)

        with amp_ctx:
            act_l, _, h_learn, _ = model.act(obs_l, h_learn, deterministic=True)
        act_o = gpu_sparring_policy(obs_o, eval_env.gen)

        actions = {}
        for k, v in act_l.items():
            vl = v.reshape(num_envs, ts, *v.shape[1:])
            vo = act_o[k]
            t0 = torch.cat([vl[:half], vo[half:]], dim=0)
            t1 = torch.cat([vo[:half], vl[half:]], dim=0)
            actions[k] = torch.cat([t0, t1], dim=1)

        obs, _, _, dones, _ = eval_env.step(actions)
        if dones.any():
            d_rep = dones[:, None].expand(num_envs, ts).reshape(-1, 1).float()
            h_learn = h_learn * (1.0 - d_rep)

    # Compute exact side-balanced learner stats
    s_learn = torch.cat([eval_env.scores[:half, 0], eval_env.scores[half:, 1]], dim=0)
    s_opp = torch.cat([eval_env.scores[:half, 1], eval_env.scores[half:, 0]], dim=0)
    k_learn = float(torch.cat([eval_env.kills[:half, :ts], eval_env.kills[half:, ts:]], dim=0).sum().item())
    d_learn = float(torch.cat([eval_env.deaths[:half, :ts], eval_env.deaths[half:, ts:]], dim=0).sum().item())
    sh_learn = float(torch.cat([eval_env.shots_fired[:half, :ts], eval_env.shots_fired[half:, ts:]], dim=0).sum().item())
    ht_learn = float(torch.cat([eval_env.shots_hit[:half, :ts], eval_env.shots_hit[half:, ts:]], dim=0).sum().item())
    win_rate = float((s_learn > s_opp).float().mean().item())
    model.train()
    return {
        "eval_win_rate": win_rate,
        "eval_kd": k_learn / max(1.0, d_learn),
        "eval_acc": ht_learn / max(1.0, sh_learn),
        "eval_kills": k_learn,
        "eval_deaths": d_learn,
    }


def save_dashboard_plot(history: List[Dict[str, Any]], out_path: Path) -> None:
    """Render clean training curve dashboard PNG (Steps vs WinRate, K/D, Accuracy, Throughput)."""
    if len(history) < 2:
        return
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return

    steps_m = [h["steps"] / 1e6 for h in history]
    kd = [h["kd"] for h in history]
    acc = [h["acc"] * 100.0 for h in history]
    sps = [h["sps"] / 1000.0 for h in history]
    eval_pts = [(h["steps"] / 1e6, h["eval_win_rate"] * 100.0, h["eval_kd"]) for h in history if h.get("eval_win_rate", -1) >= 0]

    fig, axes = plt.subplots(2, 2, figsize=(12, 7.5), facecolor="#0f1b1d")
    fig.suptitle("RNV1 — Harbor Range A100 High-Speed RL Studio", color="#f2f3e9", fontsize=14, fontweight="bold")

    def style_ax(ax, title, ylabel):
        ax.set_facecolor("#152528")
        ax.set_title(title, color="#edc166", fontsize=11, fontweight="bold")
        ax.set_xlabel("Learner Steps (Millions)", color="#b8c9c7", fontsize=9)
        ax.set_ylabel(ylabel, color="#b8c9c7", fontsize=9)
        ax.tick_params(colors="#b8c9c7", labelsize=8)
        ax.grid(True, color="#253b3f", alpha=0.6, linestyle="--")

    style_ax(axes[0, 0], "Combat K/D Ratio (Learner)", "K/D")
    axes[0, 0].plot(steps_m, kd, color="#4fe3c1", linewidth=2.0, label="League K/D")
    if eval_pts:
        axes[0, 0].plot([p[0] for p in eval_pts], [p[2] for p in eval_pts], color="#edc166", marker="o", linewidth=2.0, label="Eval vs Sparring K/D")
    axes[0, 0].axhline(1.0, color="#ff6b6b", linestyle=":", alpha=0.6)
    axes[0, 0].legend(facecolor="#0f1b1d", edgecolor="#253b3f", labelcolor="#f2f3e9", fontsize=8)

    style_ax(axes[0, 1], "Win Rate vs Baseline Benchmark (%)", "Win Rate (%)")
    if eval_pts:
        axes[0, 1].plot([p[0] for p in eval_pts], [p[1] for p in eval_pts], color="#ff9f43", marker="o", linewidth=2.2)
    axes[0, 1].axhline(50.0, color="#b8c9c7", linestyle=":", alpha=0.5)
    axes[0, 1].set_ylim(-5, 105)

    style_ax(axes[1, 0], "Shot Hit Accuracy (%)", "Accuracy (%)")
    axes[1, 0].plot(steps_m, acc, color="#54a0ff", linewidth=2.0)

    style_ax(axes[1, 1], "A100 Studio Throughput (k steps/sec)", "k steps/sec")
    axes[1, 1].plot(steps_m, sps, color="#a29bfe", linewidth=2.0)

    plt.tight_layout(rect=[0, 0, 1, 0.95])
    plt.savefig(out_path, dpi=130, facecolor=fig.get_facecolor())
    plt.close(fig)


def train_rnv1(cfg: StudioConfig) -> Dict[str, Any]:
    """Main RNV1 From-Scratch A100 High-Speed RL Training Loop."""
    hw = detect_hardware(cfg)
    device: torch.device = hw["device"]
    use_bf16: bool = hw["use_bf16"]
    use_fp16: bool = hw["use_fp16"]

    torch.manual_seed(cfg.seed)
    np.random.seed(cfg.seed)
    rng = np.random.default_rng(cfg.seed)

    out_dir = Path(cfg.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    drive_dir = Path(cfg.drive_dir) if cfg.drive_dir else None
    if drive_dir:
        drive_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 72)
    print(f"  RNV1 — Harbor Range High-Speed GPU Training Studio ({RNV1_VERSION})")
    print("=" * 72)
    print(f"  Device       : {hw['gpu_name']} ({hw['vram_gb']} GB VRAM)")
    print(f"  Precision    : {'BF16 + TF32 (A100 Native)' if use_bf16 else 'FP16' if use_fp16 else 'FP32 (CPU)'}")
    print(f"  Preset       : {cfg.preset} | Target Learner Steps: {cfg.total_steps:,}")
    print(f"  Parallelism  : {cfg.num_envs} arenas x {cfg.team_size}v{cfg.team_size} = {cfg.num_envs * cfg.team_size * 2:,} live NPCs")
    print(f"  Architecture : RNV1Actor(144 -> {cfg.hidden_dim} Res -> GRU({cfg.hidden_dim}) -> Hybrid Heads) + CTDE Critic")
    print(f"  Init Mode    : FROM SCRATCH (一からランダム初期化 -> 自己対戦強化学習)")
    print("=" * 72, flush=True)

    t_init0 = time.perf_counter()
    harbor_map = HarborMapGPU(device=device, build_lidar_lut=True)
    env = HarborStudioGPU(
        num_envs=cfg.num_envs,
        team_size=cfg.team_size,
        max_steps=cfg.max_episode_steps,
        device=device,
        harbor_map=harbor_map,
        seed=cfg.seed,
    )
    print(f"  Studio ready in {time.perf_counter() - t_init0:.2f}s (80 exact obstacles, O(1) GPU Lidar LUT built)", flush=True)

    model = RNV1ActorCritic(
        obs_dim=OBS_DIM,
        critic_global_dim=CRITIC_GLOBAL_DIM,
        hidden_dim=cfg.hidden_dim,
    ).to(device)

    adam_kwargs: Dict[str, Any] = {"lr": cfg.lr_start, "eps": 1e-5, "weight_decay": 1e-4}
    if hw["fused_adam"]:
        try:
            optimizer = torch.optim.AdamW(model.parameters(), fused=True, **adam_kwargs)
        except Exception:
            optimizer = torch.optim.AdamW(model.parameters(), **adam_kwargs)
    else:
        optimizer = torch.optim.AdamW(model.parameters(), **adam_kwargs)
    scaler = torch.amp.GradScaler("cuda", enabled=use_fp16)

    league = PFSPLeague(cfg.league_max_size, OBS_DIM, cfg.hidden_dim, device)

    # Optional resume when fresh_start=False and checkpoint exists
    ckpt_path = out_dir / "rnv1_checkpoint_latest.pt"
    start_steps = 0
    start_update = 0
    history: List[Dict[str, Any]] = []
    best_eval_score = -1.0
    if not cfg.fresh_start and ckpt_path.exists():
        ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        start_steps = int(ckpt.get("steps", 0))
        start_update = int(ckpt.get("update", 0))
        history = list(ckpt.get("history", []))
        best_eval_score = float(ckpt.get("best_eval_score", -1.0))
        print(f"  Resumed checkpoint from {start_steps:,} steps (update {start_update})", flush=True)

    # Allocate rollout buffers on GPU for learner agents [T, N, ...]
    # Half arenas: Learner = Team 0 (South); Half arenas: Learner = Team 1 (North) -> 100% side-balanced!
    B = cfg.num_envs
    half = B // 2
    ts = cfg.team_size
    N = B * ts  # learner agents per step
    T = cfg.rollout_steps

    buf_obs = torch.zeros((T, N, OBS_DIM), dtype=torch.float32, device=device)
    buf_glob = torch.zeros((T, N, CRITIC_GLOBAL_DIM), dtype=torch.float32, device=device)
    buf_aux = torch.zeros((T, N, 4), dtype=torch.float32, device=device)
    buf_cont = torch.zeros((T, N, ACT_CONT_DIM), dtype=torch.float32, device=device)
    buf_aim = torch.zeros((T, N), dtype=torch.long, device=device)
    buf_bin = torch.zeros((T, N, ACT_BIN_DIM), dtype=torch.float32, device=device)
    buf_util = torch.zeros((T, N), dtype=torch.long, device=device)
    buf_logp = torch.zeros((T, N), dtype=torch.float32, device=device)
    buf_val = torch.zeros((T, N), dtype=torch.float32, device=device)
    buf_rew = torch.zeros((T, N), dtype=torch.float32, device=device)
    buf_done = torch.zeros((T, N), dtype=torch.float32, device=device)

    obs, glob = env.reset()
    h_learn = torch.zeros((N, cfg.hidden_dim), dtype=torch.float32, device=device)
    h_opp = torch.zeros((N, cfg.hidden_dim), dtype=torch.float32, device=device)

    steps_per_update = T * N
    total_updates = max(1, math.ceil((cfg.total_steps - start_steps) / steps_per_update))
    global_steps = start_steps
    t_train_start = time.perf_counter()

    amp_dtype = torch.bfloat16 if use_bf16 else (torch.float16 if use_fp16 else torch.float32)
    amp_enabled = use_bf16 or use_fp16

    def extract_sides(tensor: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Split [B, 2*ts, ...] into (learner [N, ...], opponent [N, ...]) with 50/50 South/North balance."""
        l_part = torch.cat([tensor[:half, :ts], tensor[half:, ts:]], dim=0)
        o_part = torch.cat([tensor[:half, ts:], tensor[half:, :ts]], dim=0)
        return l_part.reshape(N, *tensor.shape[2:]), o_part.reshape(N, *tensor.shape[2:])

    def merge_actions(act_l: Dict[str, torch.Tensor], act_o: Dict[str, torch.Tensor]) -> Dict[str, torch.Tensor]:
        merged = {}
        for k in act_l:
            vl = act_l[k].reshape(B, ts, *act_l[k].shape[1:])
            vo = act_o[k].reshape(B, ts, *act_o[k].shape[1:])
            t0 = torch.cat([vl[:half], vo[half:]], dim=0)
            t1 = torch.cat([vo[:half], vl[half:]], dim=0)
            merged[k] = torch.cat([t0, t1], dim=1)
        return merged

    # Seed initial random snapshot for league stability
    if not league.snapshots:
        league.add_snapshot(model.actor, step=0)

    for upd in range(1, total_updates + 1):
        t_u0 = time.perf_counter()
        progress = min(1.0, global_steps / max(1, cfg.total_steps))
        cur = curriculum_schedule(progress)
        env.shaping_scale = cur["shaping"]
        env.skirmish_spawn_prob = cur["skirmish_prob"]

        # Cosine LR decay with brief warmup
        warmup = min(1.0, upd / max(1, min(15, total_updates // 10 + 1)))
        cos_lr = cfg.lr_end + 0.5 * (cfg.lr_start - cfg.lr_end) * (1.0 + math.cos(math.pi * progress))
        lr_now = cos_lr * warmup
        for pg in optimizer.param_groups:
            pg["lr"] = lr_now

        # Select opponent mode for this rollout batch (Sparring / PFSP Historical / Latest Self-Play)
        opp_draw = float(rng.random())
        if opp_draw < cur["frac_sparring"]:
            opp_mode = "sparring"
        elif opp_draw < cur["frac_sparring"] + cur["frac_pfsp"] and league.sample_opponent(rng):
            opp_mode = "pfsp"
        else:
            opp_mode = "self_play"

        h0_rollout = h_learn.clone()
        roll_rew_sum = 0.0

        # ---- 1. GPU Vectorized Rollout Collection ----
        model.eval()
        with torch.no_grad():
            for t in range(T):
                obs_l, obs_o = extract_sides(obs)
                glob_l, _ = extract_sides(glob)
                aux_l, _ = extract_sides(env.last_aux)

                buf_obs[t] = obs_l
                buf_glob[t] = glob_l
                buf_aux[t] = aux_l

                with torch.amp.autocast("cuda", dtype=amp_dtype, enabled=amp_enabled):
                    act_l, lp_l, h_learn, val_l = model.act(obs_l, h_learn, glob_l, deterministic=False)

                    if opp_mode == "sparring":
                        act_o = gpu_sparring_policy(obs_o, env.gen)
                    elif opp_mode == "pfsp":
                        h_opp, outs_o = league.active_actor.encode_and_step(obs_o, h_opp)
                        d_c, d_a, d_b, d_u = model._build_dists(outs_o, obs_o)
                        act_o = {
                            "cont": torch.clamp(d_c.sample(), -1.0, 1.0),
                            "aim": d_a.sample(),
                            "bin": d_b.sample(),
                            "util": d_u.sample(),
                        }
                    else:
                        act_o, _, h_opp, _ = model.act(obs_o, h_opp, None, deterministic=False)

                buf_cont[t] = act_l["cont"]
                buf_aim[t] = act_l["aim"]
                buf_bin[t] = act_l["bin"]
                buf_util[t] = act_l["util"]
                buf_logp[t] = lp_l
                buf_val[t] = val_l.float()

                obs, glob, rew, dones, _ = env.step(merge_actions(act_l, act_o))
                rew_l, _ = extract_sides(rew)
                buf_rew[t] = rew_l
                done_n = dones[:, None].expand(B, ts).reshape(N).float()
                buf_done[t] = done_n
                roll_rew_sum += float(rew_l.mean().item())

                # Reset GRU hidden state cleanly on episode completion
                keep = (1.0 - done_n).unsqueeze(-1)
                h_learn = h_learn * keep
                h_opp = h_opp * keep

            # Bootstrap value V(s_T) for GAE
            obs_l_last, _ = extract_sides(obs)
            glob_l_last, _ = extract_sides(glob)
            with torch.amp.autocast("cuda", dtype=amp_dtype, enabled=amp_enabled):
                _, _, _, next_val = model.act(obs_l_last, h_learn, glob_l_last, deterministic=True)
            next_val = next_val.float()

            # Compute GAE(lambda) advantages & returns
            adv = torch.zeros_like(buf_rew)
            last_gae = torch.zeros(N, dtype=torch.float32, device=device)
            for t in reversed(range(T)):
                nt = 1.0 - buf_done[t]
                nv = next_val if t == T - 1 else buf_val[t + 1]
                delta = buf_rew[t] + cfg.gamma * nv * nt - buf_val[t]
                last_gae = delta + cfg.gamma * cfg.gae_lambda * nt * last_gae
                adv[t] = last_gae
            returns = adv + buf_val

        # ---- 2. Truncated-BPTT Recurrent MAPPO Update on A100 ----
        model.train()
        # Split [T, N] into sequence chunks of length seq_chunk across environments
        chunk_len = min(cfg.seq_chunk, T)
        num_chunks_t = T // chunk_len
        # Normalize advantages globally across the rollout batch
        adv_norm = (adv - adv.mean()) / (adv.std() + 1e-8)

        # Precompute starting hidden states for each time chunk (simple & fast: use h0 at chunk 0, recompute intermediate)
        # Recompute chunk boundary hidden states under no_grad once per update
        chunk_h0s = [h0_rollout]
        if num_chunks_t > 1:
            with torch.no_grad(), torch.amp.autocast("cuda", dtype=amp_dtype, enabled=amp_enabled):
                h_tmp = h0_rollout
                for c_i in range(num_chunks_t - 1):
                    s0, s1 = c_i * chunk_len, (c_i + 1) * chunk_len
                    h_seq_tmp, _ = model.actor.forward_sequence(buf_obs[s0:s1], h_tmp, buf_done[s0:s1])
                    h_tmp = h_seq_tmp[-1] * (1.0 - buf_done[s1 - 1]).unsqueeze(-1)
                    chunk_h0s.append(h_tmp.detach().float())

        # Reshape chunks to [chunk_len, num_chunks_t * N, ...]
        M_seq = num_chunks_t * N
        c_obs = torch.cat([buf_obs[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_glob = torch.cat([buf_glob[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_aux = torch.cat([buf_aux[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_cont = torch.cat([buf_cont[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_aim = torch.cat([buf_aim[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_bin = torch.cat([buf_bin[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_util = torch.cat([buf_util[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_old_lp = torch.cat([buf_logp[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_old_v = torch.cat([buf_val[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_adv = torch.cat([adv_norm[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_ret = torch.cat([returns[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_done = torch.cat([buf_done[i * chunk_len : (i + 1) * chunk_len] for i in range(num_chunks_t)], dim=1)
        c_h0 = torch.cat(chunk_h0s, dim=0)  # [M_seq, H]

        mb_size = max(1, M_seq // cfg.num_minibatches)
        pg_loss_acc = 0.0
        vf_loss_acc = 0.0
        ent_acc = 0.0
        kl_acc = 0.0
        mb_count = 0

        for _ in range(cfg.ppo_epochs):
            perm = torch.randperm(M_seq, device=device)
            for mb_s in range(0, M_seq, mb_size):
                mb_idx = perm[mb_s : mb_s + mb_size]
                if mb_idx.numel() < 2:
                    continue
                optimizer.zero_grad(set_to_none=True)
                with torch.amp.autocast("cuda", dtype=amp_dtype, enabled=amp_enabled):
                    new_lp, ent, new_v, aux_pred = model.evaluate_sequences(
                        c_obs[:, mb_idx],
                        c_glob[:, mb_idx],
                        c_h0[mb_idx],
                        c_done[:, mb_idx],
                        c_cont[:, mb_idx],
                        c_aim[:, mb_idx],
                        c_bin[:, mb_idx],
                        c_util[:, mb_idx],
                    )
                    log_ratio = torch.clamp(new_lp - c_old_lp[:, mb_idx], -10.0, 10.0)
                    ratio = torch.exp(log_ratio)
                    mb_adv = c_adv[:, mb_idx]
                    pg1 = -mb_adv * ratio
                    pg2 = -mb_adv * torch.clamp(ratio, 1.0 - cfg.clip_coef, 1.0 + cfg.clip_coef)
                    pg_loss = torch.maximum(pg1, pg2).mean()

                    # Clipped value loss
                    mb_ret = c_ret[:, mb_idx]
                    mb_ov = c_old_v[:, mb_idx]
                    v_clip = mb_ov + torch.clamp(new_v - mb_ov, -cfg.clip_coef, cfg.clip_coef)
                    vf_loss = 0.5 * torch.maximum((new_v - mb_ret) ** 2, (v_clip - mb_ret) ** 2).mean()

                    # Auxiliary tactical prediction loss (dense representation signal into GRU!)
                    mb_aux = c_aux[:, mb_idx]
                    aux_loss = (
                        F.mse_loss(torch.sigmoid(aux_pred[..., 0]), mb_aux[..., 0])
                        + F.binary_cross_entropy_with_logits(aux_pred[..., 1:], mb_aux[..., 1:])
                    )

                    ent_mean = ent.mean()
                    loss = pg_loss + cfg.vf_coef * vf_loss + cfg.aux_coef * aux_loss - cur["ent_coef"] * ent_mean

                if use_fp16:
                    scaler.scale(loss).backward()
                    scaler.unscale_(optimizer)
                    nn.utils.clip_grad_norm_(model.parameters(), cfg.max_grad_norm)
                    scaler.step(optimizer)
                    scaler.update()
                else:
                    loss.backward()
                    nn.utils.clip_grad_norm_(model.parameters(), cfg.max_grad_norm)
                    optimizer.step()

                with torch.no_grad():
                    approx_kl = ((ratio - 1.0) - log_ratio).mean().item()
                pg_loss_acc += float(pg_loss.item())
                vf_loss_acc += float(vf_loss.item())
                ent_acc += float(ent_mean.item())
                kl_acc += approx_kl
                mb_count += 1

        global_steps += steps_per_update
        upd_dt = max(1e-4, time.perf_counter() - t_u0)
        sps = steps_per_update / upd_dt

        m_env = env.pop_metrics()
        if opp_mode == "pfsp" and m_env["t0_win_rate"] >= 0.0:
            league.update_result(m_env["t0_win_rate"])

        # Add league snapshot periodically
        if upd % cfg.snapshot_every_updates == 0:
            league.add_snapshot(model.actor, step=global_steps)

        eval_res: Dict[str, float] = {"eval_win_rate": -1.0, "eval_kd": -1.0, "eval_acc": -1.0}
        if upd % cfg.eval_every_updates == 0 or upd == total_updates:
            eval_n = min(64, max(4, cfg.num_envs // 4))
            eval_n = max(2, (eval_n // 2) * 2)
            eval_res = evaluate_vs_sparring(
                model,
                harbor_map,
                device,
                team_size=cfg.team_size,
                num_envs=eval_n,
                eval_steps=300 if cfg.preset != "cpu_smoke" else 60,
                use_bf16=use_bf16,
            )

        rec = {
            "update": start_update + upd,
            "steps": global_steps,
            "stage": cur["stage"],
            "opp_mode": opp_mode,
            "sps": round(sps, 1),
            "lr": lr_now,
            "rew": round(roll_rew_sum / T, 4),
            "kd": round(m_env["t0_kd"], 3),
            "acc": round(m_env["t0_acc"], 4),
            "pg_loss": round(pg_loss_acc / max(1, mb_count), 4),
            "vf_loss": round(vf_loss_acc / max(1, mb_count), 4),
            "ent": round(ent_acc / max(1, mb_count), 4),
            "kl": round(kl_acc / max(1, mb_count), 5),
            "eval_win_rate": round(eval_res["eval_win_rate"], 4),
            "eval_kd": round(eval_res["eval_kd"], 3),
            "eval_acc": round(eval_res["eval_acc"], 4),
            "elapsed_s": round(time.perf_counter() - t_train_start, 1),
        }
        history.append(rec)

        # Print rich live progress
        if upd == 1 or upd % max(1, min(5, cfg.eval_every_updates)) == 0 or eval_res["eval_win_rate"] >= 0 or upd == total_updates:
            eta_s = (cfg.total_steps - global_steps) / max(1.0, global_steps / max(1.0, rec["elapsed_s"]))
            eval_str = (
                f" | EVAL WR={eval_res['eval_win_rate']*100:5.1f}% K/D={eval_res['eval_kd']:.2f} ACC={eval_res['eval_acc']*100:4.1f}%"
                if eval_res["eval_win_rate"] >= 0
                else ""
            )
            print(
                f"[S{cur['stage']} {upd:4d}/{total_updates}] "
                f"{global_steps/1e6:6.2f}M/{cfg.total_steps/1e6:.1f}M | "
                f"{sps/1000:6.1f}k stp/s | {opp_mode:9s} | "
                f"K/D={rec['kd']:.2f} ACC={rec['acc']*100:4.1f}% ENT={rec['ent']:.2f}{eval_str} | "
                f"ETA {eta_s/60:4.1f}m",
                flush=True,
            )

        # Export best & periodic checkpoints + browser-ready rnv1-weights.json
        export_meta = {
            "trained": True,
            "origin": f"colab-a100-studio ({hw['gpu_name']})",
            "preset": cfg.preset,
            "steps": global_steps,
            "stage": cur["stage"],
            "evalWinRate": round(eval_res["eval_win_rate"], 4) if eval_res["eval_win_rate"] >= 0 else None,
            "evalKD": round(eval_res["eval_kd"], 3) if eval_res["eval_kd"] >= 0 else None,
            "trainKD": rec["kd"],
            "trainAcc": rec["acc"],
            "teamSize": cfg.team_size,
            "autoActivate": True,
        }
        if eval_res["eval_win_rate"] >= 0:
            score_now = eval_res["eval_win_rate"] * 2.0 + min(3.0, eval_res["eval_kd"]) * 0.5
            if score_now >= best_eval_score:
                best_eval_score = score_now
                save_actor_bundle(model.actor, out_dir / "rnv1-weights-best.json", quantize="q8", meta=export_meta)

        if upd % cfg.save_every_updates == 0 or upd == total_updates:
            weights_file = save_actor_bundle(model.actor, out_dir / "rnv1-weights.json", quantize="q8", meta=export_meta)
            torch.save(
                {
                    "model": model.state_dict(),
                    "optimizer": optimizer.state_dict(),
                    "steps": global_steps,
                    "update": start_update + upd,
                    "config": asdict(cfg),
                    "history": history,
                    "best_eval_score": best_eval_score,
                },
                ckpt_path,
            )
            (out_dir / "training_metrics.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
            save_dashboard_plot(history, out_dir / "training_dashboard.png")
            if drive_dir:
                shutil.copy2(weights_file, drive_dir / "rnv1-weights.json")
                if (out_dir / "rnv1-weights-best.json").exists():
                    shutil.copy2(out_dir / "rnv1-weights-best.json", drive_dir / "rnv1-weights-best.json")
                shutil.copy2(ckpt_path, drive_dir / "rnv1_checkpoint_latest.pt")
                if (out_dir / "training_dashboard.png").exists():
                    shutil.copy2(out_dir / "training_dashboard.png", drive_dir / "training_dashboard.png")

    elapsed = time.perf_counter() - t_train_start
    print("=" * 72)
    print(f"  RNV1 Training Complete! {global_steps:,} steps in {elapsed/60:.2f} min ({global_steps/max(1,elapsed)/1000:.1f}k steps/s avg)")
    print(f"  Exported browser weights : {out_dir / 'rnv1-weights.json'}")
    if (out_dir / "rnv1-weights-best.json").exists():
        print(f"  Best eval weights        : {out_dir / 'rnv1-weights-best.json'}")
    print("=" * 72, flush=True)

    return {
        "steps": global_steps,
        "elapsed_s": elapsed,
        "weights_path": str(out_dir / "rnv1-weights.json"),
        "best_weights_path": str(out_dir / "rnv1-weights-best.json"),
        "history": history,
    }


def parse_args() -> StudioConfig:
    p = argparse.ArgumentParser(description="RNV1 — Harbor Range A100 High-Speed RL Studio")
    p.add_argument("--preset", choices=list(PRESETS.keys()), default="a100_pro_fast")
    p.add_argument("--total-steps", type=int, default=0)
    p.add_argument("--num-envs", type=int, default=0)
    p.add_argument("--team-size", type=int, default=3)
    p.add_argument("--hidden-dim", type=int, default=DEFAULT_HIDDEN_DIM)
    p.add_argument("--output-dir", type=str, default="rnv1_outputs")
    p.add_argument("--drive-dir", type=str, default="")
    p.add_argument("--resume", action="store_true")
    p.add_argument("--seed", type=int, default=2026)
    args = p.parse_args()

    cfg = StudioConfig(preset=args.preset)
    for k, v in PRESETS[args.preset].items():
        setattr(cfg, k, v)
    if args.total_steps > 0:
        cfg.total_steps = args.total_steps
    if args.num_envs > 0:
        cfg.num_envs = args.num_envs
    cfg.team_size = args.team_size
    cfg.hidden_dim = args.hidden_dim
    cfg.output_dir = args.output_dir
    cfg.drive_dir = args.drive_dir
    cfg.fresh_start = not args.resume
    cfg.seed = args.seed
    return cfg


if __name__ == "__main__":
    train_rnv1(parse_args())
