"""High-Throughput GPU PPO Trainer for NV Super Soldier (NVSS) on Google Colab Pro.

Runs massively parallel GPU rollouts (2,048 - 16,384 arenas simultaneously) with
Mixed-Precision AMP (bf16 on A100/L4, fp16 on V100/T4), GAE(lambda) PPO, multi-head
actor-critic optimization (Tactics + Biomechanical Motor Style + Universal Capability
Selection), and automatic Google Drive checkpoint/resume toward billions of steps/matches.

Usage:
  python colab/train_nvss.py --target-steps 100000000 --out-dir ./nvss_runs
"""

from __future__ import annotations

import argparse
import json
import os
import time
from typing import Dict, List

import torch
import torch.nn as nn
from torch.distributions import Categorical, Normal

from nvss_model import ARCH, NVSSPolicyNetTorch
from nvss_rl_env import ArenaConfig, NVSSVectorArena


def auto_tune_hardware() -> Dict[str, object]:
    if not torch.cuda.is_available():
        return {"device": "cpu", "gpu_name": "CPU", "num_envs": 256, "amp_dtype": None}
    name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    bf16_ok = torch.cuda.is_bf16_supported()
    if "A100" in name or "H100" in name or vram_gb >= 36:
        num_envs = 12288
    elif "L4" in name or vram_gb >= 20:
        num_envs = 6144
    elif "V100" in name or vram_gb >= 14:
        num_envs = 4096
    else:
        num_envs = 2048
    return {
        "device": "cuda",
        "gpu_name": f"{name} ({vram_gb:.1f} GB)",
        "num_envs": num_envs,
        "amp_dtype": torch.bfloat16 if bf16_ok else torch.float16,
    }


def train(args: argparse.Namespace) -> Dict[str, object]:
    hw = auto_tune_hardware()
    device = torch.device(args.device or hw["device"])
    num_envs = args.num_envs if args.num_envs > 0 else int(hw["num_envs"])
    rollout_steps = args.rollout_steps
    amp_dtype = hw["amp_dtype"] if device.type == "cuda" and not args.no_amp else None

    os.makedirs(args.out_dir, exist_ok=True)
    ckpt_path = os.path.join(args.out_dir, "nvss_checkpoint.pt")
    json_path = os.path.join(args.out_dir, "nvss-weights.json")
    js_path = os.path.join(args.out_dir, "nvss-weights-colab.js")
    metrics_path = os.path.join(args.out_dir, "training_metrics.json")

    print("=" * 72)
    print("  NV Super Soldier (NVSS) — Google Colab Pro GPU Reinforcement Learning")
    print(f"  Hardware      : {hw['gpu_name']} | device={device} | amp={amp_dtype}")
    print(f"  Parallel Envs : {num_envs:,} arenas x {rollout_steps} rollout steps = {num_envs * rollout_steps:,} steps/update")
    print(f"  Target Steps  : {args.target_steps:,} (auto-resume enabled: {not args.fresh})")
    print("=" * 72)

    if device.type == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

    arena = NVSSVectorArena(ArenaConfig(num_envs=num_envs, device=str(device)))
    model = NVSSPolicyNetTorch(ARCH).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, eps=1e-5, weight_decay=1e-4)

    trained_steps = 0
    trained_matches = 0
    history: List[Dict[str, float]] = []

    if not args.fresh and os.path.exists(ckpt_path):
        ckpt = torch.load(ckpt_path, map_location=device)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        trained_steps = int(ckpt.get("trained_steps", 0))
        trained_matches = int(ckpt.get("trained_matches", 0))
        arena.total_matches_completed = trained_matches
        history = list(ckpt.get("history", []))
        print(f"[RESUME] Loaded checkpoint: {trained_steps:,} steps | {trained_matches:,} matches completed.")

    obs = arena.reset_all()
    t0 = time.perf_counter()
    start_steps = trained_steps
    update_idx = 0

    gamma = 0.985
    gae_lambda = 0.95
    clip_eps = 0.2
    ent_coef = 0.014
    vf_coef = 0.5
    steps_per_update = num_envs * rollout_steps

    while trained_steps < args.target_steps:
        update_idx += 1

        # Rollout storage on GPU (zero CPU transfer!)
        b_sv = torch.empty((rollout_steps, num_envs, ARCH.self_dim), device=device)
        b_et = torch.empty((rollout_steps, num_envs, arena.N, ARCH.entity_dim), device=device)
        b_em = torch.empty((rollout_steps, num_envs, arena.N), dtype=torch.bool, device=device)
        b_cd = torch.empty((rollout_steps, num_envs, arena.C, ARCH.cap_dim), device=device)

        b_tac = torch.empty((rollout_steps, num_envs), dtype=torch.long, device=device)
        b_mot = torch.empty((rollout_steps, num_envs, ARCH.n_motor), device=device)
        b_cap = torch.empty((rollout_steps, num_envs), dtype=torch.long, device=device)
        b_logp = torch.empty((rollout_steps, num_envs), device=device)
        b_rew = torch.empty((rollout_steps, num_envs), device=device)
        b_done = torch.empty((rollout_steps, num_envs), device=device)
        b_val = torch.empty((rollout_steps, num_envs), device=device)

        win_acc, win_cnt, hum_acc, rew_acc = 0.0, 0, 0.0, 0.0

        with torch.no_grad():
            for t in range(rollout_steps):
                sv, et, em, cd = obs
                b_sv[t], b_et[t], b_em[t], b_cd[t] = sv, et, em, cd

                with torch.amp.autocast(device_type=device.type, dtype=amp_dtype, enabled=amp_dtype is not None):
                    tac_logits, mot_mean, cap_q, val = model(sv, et, em)
                    cap_logits = model.score_capabilities(cap_q, cd)

                tac_dist = Categorical(logits=tac_logits.float())
                mot_std = model.motor_log_std.exp().clamp(0.05, 0.45).expand_as(mot_mean)
                mot_dist = Normal(mot_mean.float(), mot_std.float())
                cap_dist = Categorical(logits=cap_logits.float())

                tac_a = tac_dist.sample()
                mot_a = mot_dist.sample().clamp(0.02, 0.98)
                cap_a = cap_dist.sample()

                logp = (
                    tac_dist.log_prob(tac_a)
                    + mot_dist.log_prob(mot_a).sum(dim=-1)
                    + cap_dist.log_prob(cap_a)
                )

                obs, rew, done, info = arena.step(tac_a, mot_a, cap_a)

                b_tac[t], b_mot[t], b_cap[t] = tac_a, mot_a, cap_a
                b_logp[t], b_rew[t], b_done[t], b_val[t] = logp, rew, done, val.float()

                if info["done_matches"] > 0:
                    win_acc += info["win_rate"]
                    win_cnt += 1
                hum_acc += info["human_realism"]
                rew_acc += info["mean_reward"]

            # Bootstrap value for GAE
            sv, et, em, _ = obs
            with torch.amp.autocast(device_type=device.type, dtype=amp_dtype, enabled=amp_dtype is not None):
                _, _, _, next_val = model(sv, et, em)
            next_val = next_val.float()

            adv = torch.zeros_like(b_rew)
            last_gae = torch.zeros(num_envs, device=device)
            for t in reversed(range(rollout_steps)):
                non_term = 1.0 - b_done[t]
                nv = next_val if t == rollout_steps - 1 else b_val[t + 1]
                delta = b_rew[t] + gamma * nv * non_term - b_val[t]
                last_gae = delta + gamma * gae_lambda * non_term * last_gae
                adv[t] = last_gae
            returns = adv + b_val

        # Flatten rollout batch for PPO mini-batch updates
        N_tot = rollout_steps * num_envs
        f_sv = b_sv.reshape(N_tot, ARCH.self_dim)
        f_et = b_et.reshape(N_tot, arena.N, ARCH.entity_dim)
        f_em = b_em.reshape(N_tot, arena.N)
        f_cd = b_cd.reshape(N_tot, arena.C, ARCH.cap_dim)
        f_tac = b_tac.reshape(N_tot)
        f_mot = b_mot.reshape(N_tot, ARCH.n_motor)
        f_cap = b_cap.reshape(N_tot)
        f_logp = b_logp.reshape(N_tot)
        f_adv = adv.reshape(N_tot)
        f_adv = (f_adv - f_adv.mean()) / (f_adv.std() + 1e-8)
        f_ret = returns.reshape(N_tot)

        mb_size = min(args.minibatch_size, N_tot)
        last_loss = 0.0
        for _ in range(args.ppo_epochs):
            perm = torch.randperm(N_tot, device=device)
            for start in range(0, N_tot, mb_size):
                idx = perm[start : start + mb_size]
                with torch.amp.autocast(device_type=device.type, dtype=amp_dtype, enabled=amp_dtype is not None):
                    tac_logits, mot_mean, cap_q, val = model(f_sv[idx], f_et[idx], f_em[idx])
                    cap_logits = model.score_capabilities(cap_q, f_cd[idx])

                tac_dist = Categorical(logits=tac_logits.float())
                mot_std = model.motor_log_std.exp().clamp(0.05, 0.45).expand_as(mot_mean)
                mot_dist = Normal(mot_mean.float(), mot_std.float())
                cap_dist = Categorical(logits=cap_logits.float())

                new_logp = (
                    tac_dist.log_prob(f_tac[idx])
                    + mot_dist.log_prob(f_mot[idx]).sum(dim=-1)
                    + cap_dist.log_prob(f_cap[idx])
                )
                ent = (
                    tac_dist.entropy()
                    + mot_dist.entropy().sum(dim=-1) * 0.25
                    + cap_dist.entropy()
                ).mean()

                ratio = torch.exp((new_logp - f_logp[idx]).clamp(-6.0, 6.0))
                pg1 = -f_adv[idx] * ratio
                pg2 = -f_adv[idx] * torch.clamp(ratio, 1.0 - clip_eps, 1.0 + clip_eps)
                pg_loss = torch.maximum(pg1, pg2).mean()
                v_loss = 0.5 * (val.float() - f_ret[idx]).pow(2).mean()
                loss = pg_loss + vf_coef * v_loss - ent_coef * ent

                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), 0.5)
                optimizer.step()
                last_loss = float(loss.item())

        trained_steps += steps_per_update
        trained_matches = arena.total_matches_completed

        elapsed = max(1e-3, time.perf_counter() - t0)
        sps = (trained_steps - start_steps) / elapsed
        win_pct = (win_acc / max(1, win_cnt)) * 100.0
        hum_score = hum_acc / rollout_steps
        mean_rew = rew_acc / rollout_steps

        rec = {
            "steps": trained_steps,
            "matches": trained_matches,
            "sps": round(sps, 1),
            "win_pct": round(win_pct, 2),
            "human_realism": round(hum_score, 2),
            "mean_reward": round(mean_rew, 4),
            "loss": round(last_loss, 4),
        }
        history.append(rec)

        if update_idx % args.log_every == 0 or trained_steps >= args.target_steps:
            print(
                f"[Upd {update_idx:5d}] steps={trained_steps:>12,} | matches={trained_matches:>10,} "
                f"| {sps:>9,.0f} step/s | win={win_pct:5.1f}% | human={hum_score:5.1f}/100 | rew={mean_rew:+.3f}"
            )

        if update_idx % args.save_every == 0 or trained_steps >= args.target_steps:
            torch.save(
                {
                    "model": model.state_dict(),
                    "optimizer": optimizer.state_dict(),
                    "trained_steps": trained_steps,
                    "trained_matches": trained_matches,
                    "history": history[-2000:],
                },
                ckpt_path,
            )
            model.save_browser_files(
                json_path=json_path,
                js_path=js_path,
                trained_steps=trained_steps,
                trained_matches=trained_matches,
                source=f"colab-pro-gpu ({hw['gpu_name']})",
            )
            with open(metrics_path, "w", encoding="utf-8") as mf:
                json.dump(history[-2000:], mf)

    print(f"\n[DONE] NVSS weights exported to:\n  - {json_path}\n  - {js_path}")
    return {"trained_steps": trained_steps, "trained_matches": trained_matches, "json_path": json_path, "js_path": js_path}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train NV Super Soldier (NVSS) via GPU PPO")
    p.add_argument("--target-steps", type=int, default=50_000_000, help="Cumulative training steps (resumes from checkpoint)")
    p.add_argument("--num-envs", type=int, default=0, help="Parallel GPU arenas (0 = auto-tune to Colab Pro GPU)")
    p.add_argument("--rollout-steps", type=int, default=32, help="Rollout horizon per PPO update")
    p.add_argument("--minibatch-size", type=int, default=8192, help="PPO minibatch size")
    p.add_argument("--ppo-epochs", type=int, default=3, help="PPO epochs per update")
    p.add_argument("--lr", type=float, default=3.5e-4, help="AdamW learning rate")
    p.add_argument("--out-dir", type=str, default="./nvss_runs", help="Checkpoint & exported weights output directory")
    p.add_argument("--log-every", type=int, default=2, help="Log interval in PPO updates")
    p.add_argument("--save-every", type=int, default=10, help="Checkpoint & JSON export interval in PPO updates")
    p.add_argument("--device", type=str, default="", help="Force device (cuda / cpu)")
    p.add_argument("--no-amp", action="store_true", help="Disable mixed precision AMP")
    p.add_argument("--fresh", action="store_true", help="Ignore existing checkpoint and train from scratch")
    return p.parse_args()


if __name__ == "__main__":
    train(parse_args())
