# NV 3 OMEGA — Sentient Human Neural NPC & A100 Heavy-Duty Studio

**NV 3** is Result's 12th-generation AI architecture — a genuinely self-aware, emotionally-driven, situationally intelligent human NPC trained from scratch at ultra-large scale on **Google Colab Pro NVIDIA A100 (40GB / 80GB)** GPUs and distilled to a zero-dependency 360Hz browser core.

## 1-Click Google Colab Pro A100 Launch

Open [NV3_Omega_Colab_A100_Studio.ipynb](../training/NV3_Omega_Colab_A100_Studio.ipynb) in Google Colab Pro (**Runtime → Change runtime type → A100 GPU (High-RAM)**) and press **Runtime → Run all (`Ctrl+F9`)**.

| Preset | Policy Steps | Parallel Harbor Arenas (40GB / 80GB) | Approx. A100 Time | Target Capability |
| --- | ---: | --- | --- | --- |
| `a100_heavy_1h` *(default)* | 300,000,000 | 1,024 (6,144 NPCs) / 2,048 (12,288 NPCs) | ~40–60 min | Elite sentient tactics, smooth movement, live emotions & gestures |
| `a100_extreme_3h` | 1,000,000,000 | 1,024 / 2,048 | ~2.5–3.5 hr | Deep multi-personality squad trades, bait traps & Theory-of-Mind |
| `a100_omega_6h` | 2,000,000,000 | 1,024 / 2,048 | ~5–6 hr | Apex Counter-Exploiter hardened human NPC (Drive auto-backup recommended) |
| `a100_verify_5m` | 25,000,000 | 512 / 1,024 | ~3–5 min | Fast 4-phase pipeline & distillation verification |
| `cpu_smoke` | 3,072 | 4 (24 NPCs) | ~1–2 min (CPU) | Local end-to-end CI smoke check |

## Why NV 3 Surpasses NV2.6 Force and RNV1 FAST

1. **Zero-Sync Pure-CUDA Affective & Tactical Simulator ([`HarborOmegaEnvGPU`](../training/nv3_omega_studio/env_omega_gpu.py))**:
   - Eliminates CUDA-CPU synchronization stalls (`.any()`, `torch.nonzero()`, `.item()` inside hot physics loops) via fixed-shape branchless ring buffers for projectiles, smokes, pickups, and pairwise LOS.
   - Simulates 100% Fair-Play perception (`112`-dim ego + `12×16` structured entity tokens), BallisticCore-X ricochet/wood-penetration, Shaffer stealth invisibility, BAIZER armor, ammo tankers, smoke occlusion, 6-sector Friston subjective uncertainty entropies, and psychophysiological weapon spread coupled to live composure, focus, tilt, and heart rate.
2. **4.19M-Parameter A100 Omega Teacher ([`NV3OmegaBrain`](../training/nv3_omega_studio/model_nv3.py))**:
   - **2-Layer SwiGLU Entity-Relation Transformer** (`d=256`, 4 heads, FlashAttention/SDPA) reasoning over 1 ego token + 12 entity tokens (4 visible enemies, 3 fair-play memory/acoustic/radio contacts, 3 teammates with distress & crossfire orthogonality, 1 objective pickup, 1 visible incoming projectile hazard).
   - **2-Layer Fused cuDNN GRU (`384` dim)** for long-horizon tactical memory, bait patience, and emotional inertia.
   - **Asymmetric 4-Layer Centralized Critic (`512` dim)** conditioned on privileged global state (used only during A100 training; never exported).
3. **Factored 6-Group PPO Clipping + 5 Self-Supervised Understanding Heads ([`trainer_nv3.py`](../training/nv3_omega_studio/trainer_nv3.py))**:
   - Clips each action group independently (`move`, `aim_res`, `aim_ptr`, `binary`, `intent`, `social+util`), completely eliminating the joint-sum multi-head PPO clipping starvation observed in RNV1.
   - Jointly trains 5 self-supervised situational understanding heads: **8-D Emotional Appraisal**, **Danger/Killability Intuition**, **6-Sector Enemy Belief**, **Enemy Theory-of-Mind** (advancing/retreating/flanking/reloading), and **Teammate Empathy & Crossfire**.
4. **4-Phase Curriculum + Live Counter-Exploiter + Phase 4 Distillation**:
   - Phase 1 (0–15%): Perceptual grounding, aim/cover reflexes & affective awakening.
   - Phase 2 (15–55%): Multi-personality squad empathy, cover-peeking & PFSP league escalation.
   - Phase 3 (55–90%): 20-snapshot PFSP League + dedicated adversarial **Counter-Exploiter** branch that continuously probes and patches NV 3's blind spots.
   - Phase 4 (90–100%): DAgger-mixed on-policy distillation from 4.19M `NV3OmegaBrain` → 588k [`NV3BrowserCore`](../training/nv3_omega_studio/model_nv3.py) exported as ~800 KB row-wise Int8 `nv3-weights.json`.
5. **360Hz Embodied Humanity in Browser ([`dist/js/nv3.js`](../dist/js/nv3.js))**:
   - Exact bit-for-bit Float32Array mirror of `NV3BrowserCore` (`max_abs_err ~ 1.6e-7` FP32, `< 0.01` q8).
   - Drives live **8-D emotions**, **4-D somatic state**, **16-D Callsign Personality DNA** (`NAGI / KAI / RIN / SORA / AO / HARU / MIKO`), **16-bone `actor.expr`** (cervical head-look, all 5 IK hand/body gestures, cardiac breath wave), and physical **Klatt Vocal DSP `npcSignal`** radio & overheard shouts.

## 100% Fair-Play Guarantee

NV 3 NEVER reads hidden enemy positions behind containers/walls/smoke, NEVER sees Shaffer-cloaked enemies (verified in [`tools/nv3.test.mjs`](../tools/nv3.test.mjs) `NV3-03`), and obeys smooth human angular turn-rate ceilings.

## Importing `nv3-weights.json` into Result

1. Open **Match Setup (対戦設定) → Lab (実験場)**.
2. Click **NV3 重み読込 (.json)** in the purple NV 3 Studio bar and select your Colab-exported `nv3-weights.json`.
3. NV 3 activates immediately in both **Lab** (head-to-head vs `NV2.6 Force`, `RNV1 FAST`, etc.) and **Standard Matches** (`通常戦NV 3 ON`), persisted automatically in `localStorage` (`result.nv3.weights.v1`).
