"""High-Throughput GPU Recurrent-PPO + World-Model Meta-RL Trainer for NV Gamer.

Trains NV Gamer across 5 completely distinct game genres simultaneously on Google Colab Pro
GPUs (A100 / L4 / V100 / T4), combining:
  - Recurrent-PPO over GRU working-memory sequences (learns in-context adaptation to unknown rules!)
  - Self-Supervised Forward World-Model Prediction Loss (MSE on s_{t+1} -> curiosity & anomaly sensitivity!)
  - Virtual Human Controller continuous & discrete multi-head optimization
  - Automatic Google Drive checkpoint/resume scaling toward billions of steps & episodes
  - 1-Click export to nvgamer-weights.json & nvgamer-weights-colab.js for ANY web/JS game!

Usage:
  python colab/train_nvgamer.py --target-steps 200000000 --out-dir ./nvgamer_runs
"""

from __future__ import annotations

import argparse
import json
import os
import time
from typing import Dict, List

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.distributions import Categorical, Normal

from nvgamer_model import ARCH, NVGamerNetTorch
from nvgamer_multigame_env import MultiGameConfig, NVGamerMultiGameUniverse


def auto_tune_hardware() -> Dict[str, object]:
    if not torch.cuda.is_available():
        return {"device": "cpu", "gpu_name": "CPU", "num_envs": 256, "amp_dtype": None}
    name = torch.cuda.get_device_name(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    bf16_ok = torch.cuda.is_bf16_supported()
    if "A100" in name or "H100" in name or vram_gb >= 36:
        num_envs = 8192
    elif "L4" in name or vram_gb >= 20:
        num_envs = 4096
    elif "V100" in name or vram_gb >= 14:
        num_envs = 3072
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
    ckpt_path = os.path.join(args.out_dir, "nvgamer_checkpoint.pt")
    json_path = os.path.join(args.out_dir, "nvgamer-weights.json")
    js_path = os.path.join(args.out_dir, "nvgamer-weights-colab.js")
    metrics_path = os.path.join(args.out_dir, "nvgamer_metrics.json")

    print("=" * 76)
    print("  NV Gamer — Multi-Game Universal Meta-RL + World Model (Colab Pro GPU)")
    print(f"  Hardware      : {hw['gpu_name']} | device={device} | amp={amp_dtype}")
    print(f"  Parallel World: {num_envs:,} multi-genre games x {rollout_steps} steps = {num_envs * rollout_steps:,} steps/upd")
    print("  Genres Active : Tactical FPS | Arcade Racing | Bullet-Hell/Platform | MOBA/Survival | Unknown Adaptive")
    print(f"  Target Steps  : {args.target_steps:,} (auto-resume: {not args.fresh})")
    print("=" * 76)

    if device.type == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

    universe = NVGamerMultiGameUniverse(MultiGameConfig(num_envs=num_envs, device=str(device)))
    model = NVGamerNetTorch(ARCH).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, eps=1e-5, weight_decay=1e-4)

    trained_steps = 0
    trained_episodes = 0
    history: List[Dict[str, float]] = []

    if not args.fresh and os.path.exists(ckpt_path):
        ckpt = torch.load(ckpt_path, map_location=device)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        trained_steps = int(ckpt.get("trained_steps", 0))
        trained_episodes = int(ckpt.get("trained_episodes", 0))
        universe.total_episodes = trained_episodes
        history = list(ckpt.get("history", []))
        print(f"[RESUME] Loaded NV Gamer checkpoint: {trained_steps:,} steps | {trained_episodes:,} episodes.")

    obs = universe.reset_all()
    hidden = model.init_hidden(num_envs, device)
    t0 = time.perf_counter()
    start_steps = trained_steps
    update_idx = 0

    gamma = 0.985
    gae_lambda = 0.95
    clip_eps = 0.2
    ent_coef = 0.015
    vf_coef = 0.5
    wm_coef = 0.35
    steps_per_update = num_envs * rollout_steps

    while trained_steps < args.target_steps:
        update_idx += 1

        # Rollout storage on GPU (includes GRU hidden inputs & next-state targets for World Model!)
        b_sv = torch.empty((rollout_steps, num_envs, ARCH.state_dim), device=device)
        b_nsv = torch.empty((rollout_steps, num_envs, ARCH.state_dim), device=device)
        b_et = torch.empty((rollout_steps, num_envs, universe.N, ARCH.token_dim), device=device)
        b_em = torch.empty((rollout_steps, num_envs, universe.N), dtype=torch.bool, device=device)
        b_ad = torch.empty((rollout_steps, num_envs, universe.C, ARCH.action_desc_dim), device=device)
        b_hid = torch.empty((rollout_steps, num_envs, ARCH.d_model), device=device)

        b_int = torch.empty((rollout_steps, num_envs), dtype=torch.long, device=device)
        b_mov = torch.empty((rollout_steps, num_envs, 2), device=device)
        b_aim = torch.empty((rollout_steps, num_envs, 2), device=device)
        b_btn = torch.empty((rollout_steps, num_envs), dtype=torch.long, device=device)
        b_logp = torch.empty((rollout_steps, num_envs), device=device)
        b_rew = torch.empty((rollout_steps, num_envs), device=device)
        b_done = torch.empty((rollout_steps, num_envs), device=device)
        b_val = torch.empty((rollout_steps, num_envs), device=device)

        win_acc, win_cnt, hum_acc, rew_acc, surp_acc = 0.0, 0, 0.0, 0.0, 0.0

        with torch.no_grad():
            for t in range(rollout_steps):
                sv, et, em, ad = obs
                b_sv[t], b_et[t], b_em[t], b_ad[t], b_hid[t] = sv, et, em, ad, hidden

                with torch.amp.autocast(device_type=device.type, dtype=amp_dtype, enabled=amp_dtype is not None):
                    new_h, pred_ns, int_logits, mov_mean, aim_mean, btn_q, _, val = model(sv, et, hidden, em)
                    btn_logits = model.score_buttons(btn_q, ad)

                int_d = Categorical(logits=int_logits.float())
                mov_std = model.move_log_std.exp().clamp(0.05, 0.50).expand_as(mov_mean)
                aim_std = model.aim_log_std.exp().clamp(0.05, 0.45).expand_as(aim_mean)
                mov_d = Normal(mov_mean.float(), mov_std.float())
                aim_d = Normal(aim_mean.float(), aim_std.float())
                btn_d = Categorical(logits=btn_logits.float())

                int_a = int_d.sample()
                mov_a = mov_d.sample().clamp(-1.0, 1.0)
                aim_a = aim_d.sample().clamp(-1.0, 1.0)
                btn_a = btn_d.sample()

                logp = (
                    int_d.log_prob(int_a)
                    + mov_d.log_prob(mov_a).sum(dim=-1)
                    + aim_d.log_prob(aim_a).sum(dim=-1)
                    + btn_d.log_prob(btn_a)
                )

                obs, rew, done, info = universe.step(int_a, mov_a, aim_a, btn_a)
                next_sv = obs[0]
                b_nsv[t] = next_sv

                # Intrinsic curiosity bonus from world-model prediction error (scaled gently)
                wm_err = (pred_ns.float() - next_sv).pow(2).mean(dim=-1).sqrt()
                curiosity = (wm_err * 0.06).clamp(0.0, 0.15) * (1.0 - done)
                tot_rew = rew + curiosity

                b_int[t], b_mov[t], b_aim[t], b_btn[t] = int_a, mov_a, aim_a, btn_a
                b_logp[t], b_rew[t], b_done[t], b_val[t] = logp, tot_rew, done, val.float()

                # Reset GRU hidden state on episode termination
                hidden = new_h.float() * (1.0 - done.unsqueeze(-1))

                if info["done_episodes"] > 0:
                    win_acc += info["win_rate"]
                    win_cnt += 1
                hum_acc += info["human_realism"]
                rew_acc += info["mean_reward"]
                surp_acc += float(wm_err.mean().item())

            sv, et, em, _ = obs
            with torch.amp.autocast(device_type=device.type, dtype=amp_dtype, enabled=amp_dtype is not None):
                _, _, _, _, _, _, _, next_val = model(sv, et, hidden, em)
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

        # Flatten for high-throughput PPO + Self-Supervised World-Model updates
        N_tot = rollout_steps * num_envs
        f_sv = b_sv.reshape(N_tot, ARCH.state_dim)
        f_nsv = b_nsv.reshape(N_tot, ARCH.state_dim)
        f_et = b_et.reshape(N_tot, universe.N, ARCH.token_dim)
        f_em = b_em.reshape(N_tot, universe.N)
        f_ad = b_ad.reshape(N_tot, universe.C, ARCH.action_desc_dim)
        f_hid = b_hid.reshape(N_tot, ARCH.d_model)
        f_int = b_int.reshape(N_tot)
        f_mov = b_mov.reshape(N_tot, 2)
        f_aim = b_aim.reshape(N_tot, 2)
        f_btn = b_btn.reshape(N_tot)
        f_logp = b_logp.reshape(N_tot)
        f_done = b_done.reshape(N_tot)
        f_adv = adv.reshape(N_tot)
        f_adv = (f_adv - f_adv.mean()) / (f_adv.std() + 1e-8)
        f_ret = returns.reshape(N_tot)

        mb_size = min(args.minibatch_size, N_tot)
        last_loss, last_wm_loss = 0.0, 0.0
        for _ in range(args.ppo_epochs):
            perm = torch.randperm(N_tot, device=device)
            for start in range(0, N_tot, mb_size):
                idx = perm[start : start + mb_size]
                with torch.amp.autocast(device_type=device.type, dtype=amp_dtype, enabled=amp_dtype is not None):
                    _, pred_ns, int_logits, mov_mean, aim_mean, btn_q, _, val = model(
                        f_sv[idx], f_et[idx], f_hid[idx], f_em[idx]
                    )
                    btn_logits = model.score_buttons(btn_q, f_ad[idx])

                int_d = Categorical(logits=int_logits.float())
                mov_std = model.move_log_std.exp().clamp(0.05, 0.50).expand_as(mov_mean)
                aim_std = model.aim_log_std.exp().clamp(0.05, 0.45).expand_as(aim_mean)
                mov_d = Normal(mov_mean.float(), mov_std.float())
                aim_d = Normal(aim_mean.float(), aim_std.float())
                btn_d = Categorical(logits=btn_logits.float())

                new_logp = (
                    int_d.log_prob(f_int[idx])
                    + mov_d.log_prob(f_mov[idx]).sum(dim=-1)
                    + aim_d.log_prob(f_aim[idx]).sum(dim=-1)
                    + btn_d.log_prob(f_btn[idx])
                )
                ent = (
                    int_d.entropy()
                    + mov_d.entropy().sum(dim=-1) * 0.25
                    + aim_d.entropy().sum(dim=-1) * 0.25
                    + btn_d.entropy()
                ).mean()

                ratio = torch.exp((new_logp - f_logp[idx]).clamp(-6.0, 6.0))
                pg1 = -f_adv[idx] * ratio
                pg2 = -f_adv[idx] * torch.clamp(ratio, 1.0 - clip_eps, 1.0 + clip_eps)
                pg_loss = torch.maximum(pg1, pg2).mean()
                v_loss = 0.5 * (val.float() - f_ret[idx]).pow(2).mean()

                # Self-Supervised Forward World-Model loss (masked on non-terminal steps)
                non_term = (1.0 - f_done[idx]).unsqueeze(-1)
                wm_loss = (F.mse_loss(pred_ns.float(), f_nsv[idx], reduction="none") * non_term).mean()

                loss = pg_loss + vf_coef * v_loss + wm_coef * wm_loss - ent_coef * ent

                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), 0.5)
                optimizer.step()
                last_loss = float(loss.item())
                last_wm_loss = float(wm_loss.item())

        trained_steps += steps_per_update
        trained_episodes = universe.total_episodes

        elapsed = max(1e-3, time.perf_counter() - t0)
        sps = (trained_steps - start_steps) / elapsed
        win_pct = (win_acc / max(1, win_cnt)) * 100.0
        hum_score = hum_acc / rollout_steps
        mean_rew = rew_acc / rollout_steps
        mean_surp = surp_acc / rollout_steps

        rec = {
            "steps": trained_steps,
            "episodes": trained_episodes,
            "sps": round(sps, 1),
            "win_pct": round(win_pct, 2),
            "human_realism": round(hum_score, 2),
            "world_model_err": round(mean_surp, 4),
            "mean_reward": round(mean_rew, 4),
            "wm_loss": round(last_wm_loss, 4),
            "loss": round(last_loss, 4),
        }
        history.append(rec)

        if update_idx % args.log_every == 0 or trained_steps >= args.target_steps:
            print(
                f"[Upd {update_idx:5d}] steps={trained_steps:>12,} | eps={trained_episodes:>10,} "
                f"| {sps:>8,.0f} step/s | win={win_pct:5.1f}% | human={hum_score:5.1f}/100 "
                f"| wm_err={mean_surp:.3f} | rew={mean_rew:+.3f}"
            )

        if update_idx % args.save_every == 0 or trained_steps >= args.target_steps:
            torch.save(
                {
                    "model": model.state_dict(),
                    "optimizer": optimizer.state_dict(),
                    "trained_steps": trained_steps,
                    "trained_episodes": trained_episodes,
                    "history": history[-2000:],
                },
                ckpt_path,
            )
            model.save_browser_files(
                json_path=json_path,
                js_path=js_path,
                trained_steps=trained_steps,
                trained_episodes=trained_episodes,
                genres_trained=5,
                source=f"colab-pro-gpu-nvgamer ({hw['gpu_name']})",
            )
            with open(metrics_path, "w", encoding="utf-8") as mf:
                json.dump(history[-2000:], mf)

    print(f"\n[DONE] NV Gamer universal weights exported to:\n  - {json_path}\n  - {js_path}")
    return {"trained_steps": trained_steps, "trained_episodes": trained_episodes, "json_path": json_path, "js_path": js_path}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train NV Gamer Multi-Game Foundation AI via GPU Meta-RL")
    p.add_argument("--target-steps", type=int, default=100_000_000, help="Cumulative training steps across 5 genres")
    p.add_argument("--num-envs", type=int, default=0, help="Parallel multi-genre GPU worlds (0 = auto-tune)")
    p.add_argument("--rollout-steps", type=int, default=32, help="Recurrent rollout horizon per PPO update")
    p.add_argument("--minibatch-size", type=int, default=8192, help="PPO minibatch size")
    p.add_argument("--ppo-epochs", type=int, default=3, help="PPO epochs per update")
    p.add_argument("--lr", type=float, default=3.2e-4, help="AdamW learning rate")
    p.add_argument("--out-dir", type=str, default="./nvgamer_runs", help="Checkpoint & weights output directory")
    p.add_argument("--log-every", type=int, default=2, help="Log interval in PPO updates")
    p.add_argument("--save-every", type=int, default=10, help="Checkpoint & JSON export interval")
    p.add_argument("--device", type=str, default="", help="Force device (cuda / cpu)")
    p.add_argument("--no-amp", action="store_true", help="Disable mixed precision AMP")
    p.add_argument("--fresh", action="store_true", help="Start fresh ignoring existing checkpoint")
    return p.parse_args()


if __name__ == "__main__":
    train(parse_args())
