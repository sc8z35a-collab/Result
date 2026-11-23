"""HarborStudioGPU — 100% GPU-Resident Vectorized 3D Harbor Range RL Studio.

Faithfully simulates the exact 50 x 200 m Harbor Range wharf (`dist/js/yard.js` & `dist/js/match.js`)
across thousands of parallel arenas simultaneously on NVIDIA A100 GPUs:
  - Exact 80 AABB obstacles (containers, wood crates, concrete barriers, tankers, cranes, bollards)
  - Exact 20 Hz policy cadence with 3x 60 Hz physics substeps (movement, crouch, lean, jump, gravity)
  - Exact weapons (SW T, SRA, D1, MS10, RD20, RD30, RD 50), bursts, salvos, reload & stock regen
  - BallisticCore-X wood-crate wallbang penetration & steel/concrete grazing ricochet
  - QuantumTick swept-capsule hit detection
  - BAIZER 200/400 stacking up to 100, Base Shield 25 regen, Tanker +100 ammo & 1.5x regen
  - Tactical Smoke LOS occlusion & Shaffer cloak / Recharge Heal skills
  - Strictly 100% Fair-Play 144-dim egocentric observations (bit-for-bit aligned with dist/js/rnv1.js)
  - Privileged 64-dim Centralized Critic state for CTDE MAPPO training
"""

from __future__ import annotations

import math
from typing import Dict, Optional, Tuple

import torch

from .harbor_map import (
    ACTOR_RADIUS,
    FIELD_HALF_L,
    FIELD_HALF_W,
    HarborMapGPU,
)
from .spec import (
    ACOUSTIC_TTL,
    ACT_AIM_MODES,
    ACT_BIN_DIM,
    ACT_CONT_DIM,
    ACT_UTIL_DIM,
    BAIZER_MAX_STACK,
    BASE_SHIELD_MAX,
    CRITIC_GLOBAL_DIM,
    CROUCH_SPEED_LOSS,
    GRAVITY,
    INCOMING_MIN_AGE,
    INCOMING_RANGE,
    JUMP_VY,
    KILLS_PER_SKILL_CHARGE,
    LIDAR_CHEST_RAD,
    LIDAR_LOW_RAD,
    LIDAR_MAT_RAD,
    LIDAR_MAX_DIST,
    MAT_CONCRETE,
    MAT_STEEL,
    MAT_WOOD,
    MAX_ACOUSTIC_RANGE,
    MAX_PITCH,
    MAX_SKILL_CHARGES,
    MAX_TRACK_PITCH_RATE,
    MAX_TRACK_YAW_RATE,
    MAX_FREE_YAW_RATE,
    MAX_VISION_RANGE,
    MEM_RESIDUAL_PITCH,
    MEM_RESIDUAL_YAW,
    MEMORY_TTL,
    NORMAL_FOV_HALF,
    NPC_WEAPONS,
    NUM_WEAPONS,
    OBS_DIM,
    POLICY_DT,
    PROXIMITY_SENSE_RANGE,
    RADIO_DELAY,
    RESPAWN_DURATION,
    SHAFFER_DURATION,
    SIM_SUBSTEPS,
    SMOKE_COOLDOWN,
    SMOKE_DURATION,
    SMOKE_RADIUS,
    SPRINT_SPEED,
    SUBSTEP_DT,
    TRACK_FOV_HALF,
    VIS_RESIDUAL_PITCH,
    VIS_RESIDUAL_YAW,
    WALK_SPEED,
)


def angle_diff(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    return torch.atan2(torch.sin(a - b), torch.cos(a - b))


def nonlin_turn(u: torch.Tensor) -> torch.Tensor:
    """Fine micro-precision near 0, fast flick near +/-1 (exact mirror in dist/js/rnv1.js)."""
    return torch.sign(u) * (0.25 * u.abs() + 0.75 * u * u)


class HarborStudioGPU:
    """Vectorized GPU multi-agent Harbor Range tactical combat environment."""

    MAX_SHOTS = 16
    MAX_SMOKES = 4

    def __init__(
        self,
        num_envs: int,
        team_size: int = 3,
        max_steps: int = 1200,  # 60 seconds @ 20 Hz per episode
        device: Optional[torch.device] = None,
        harbor_map: Optional[HarborMapGPU] = None,
        seed: int = 2026,
    ) -> None:
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.B = int(num_envs)
        self.team_size = int(team_size)
        self.A = self.team_size * 2
        self.max_steps = int(max_steps)
        self.map = harbor_map or HarborMapGPU(self.device, build_lidar_lut=True)

        self.gen = torch.Generator(device=self.device)
        self.gen.manual_seed(seed)

        # Curriculum & reward shaping controls (updated dynamically by trainer)
        self.shaping_scale = 1.0
        self.skirmish_spawn_prob = 0.55
        self.enable_skills = True

        # Pre-upload constant weapon parameter tensors [NUM_WEAPONS]
        self.w_cap = torch.tensor([w["capacity"] for w in NPC_WEAPONS], dtype=torch.float32, device=self.device)
        self.w_dmg = torch.tensor([w["damage"] for w in NPC_WEAPONS], dtype=torch.float32, device=self.device)
        self.w_spd = torch.tensor([w["speed"] for w in NPC_WEAPONS], dtype=torch.float32, device=self.device)
        self.w_int = torch.tensor([w["interval"] for w in NPC_WEAPONS], dtype=torch.float32, device=self.device)
        self.w_burst = torch.tensor([w["burst"] for w in NPC_WEAPONS], dtype=torch.long, device=self.device)
        self.w_pellets = torch.tensor([w["pellets"] for w in NPC_WEAPONS], dtype=torch.long, device=self.device)
        self.w_reload = torch.tensor([w["reload"] for w in NPC_WEAPONS], dtype=torch.float32, device=self.device)
        self.w_auto = torch.tensor([1.0 if w["auto"] else 0.0 for w in NPC_WEAPONS], dtype=torch.float32, device=self.device)
        self.w_stock_cap = torch.tensor([w["stockCap"] for w in NPC_WEAPONS], dtype=torch.float32, device=self.device)
        self.w_stock_regen = torch.tensor([w["stockRegen"] for w in NPC_WEAPONS], dtype=torch.float32, device=self.device)
        self.w_wood_pen = torch.tensor([w["woodPen"] for w in NPC_WEAPONS], dtype=torch.float32, device=self.device)
        self.w_max_ric = torch.tensor([w["maxRic"] for w in NPC_WEAPONS], dtype=torch.long, device=self.device)

        # Lidar ray angle constants
        self.lidar_chest_rad = torch.tensor(LIDAR_CHEST_RAD, dtype=torch.float32, device=self.device)
        self.lidar_low_rad = torch.tensor(LIDAR_LOW_RAD, dtype=torch.float32, device=self.device)
        self.lidar_mat_rad = torch.tensor(LIDAR_MAT_RAD, dtype=torch.float32, device=self.device)

        # Precompute valid walkable skirmish anchor points across Harbor Range
        self._build_skirmish_anchors()

        # Constant team / slot indices
        self.team_id = torch.cat([
            torch.zeros(self.team_size, dtype=torch.long, device=self.device),
            torch.ones(self.team_size, dtype=torch.long, device=self.device),
        ])  # [A]
        self.team_sign = torch.where(self.team_id == 0, 1.0, -1.0)  # [A]
        self.enemy_mask = self.team_id[:, None] != self.team_id[None, :]  # [A, A]
        self.ally_mask = (self.team_id[:, None] == self.team_id[None, :]) & (~torch.eye(self.A, dtype=torch.bool, device=self.device))

        self._alloc_state()
        self.reset()

    def _build_skirmish_anchors(self) -> None:
        """Sample verified walkable spots in 3 sectors (South, Central, North) for high-density skirmish starts."""
        xs = torch.linspace(-20.0, 20.0, 21, device=self.device)
        zs = torch.linspace(-72.0, 72.0, 37, device=self.device)
        gx, gz = torch.meshgrid(xs, zs, indexing="ij")
        fx = gx.reshape(-1)
        fz = gz.reshape(-1)
        pen = self.map.penetration_depth(fx, fz, torch.zeros_like(fx), r=0.58)
        ok = pen <= 1e-5
        self.valid_pts_x = fx[ok]
        self.valid_pts_z = fz[ok]
        self.num_valid_pts = int(self.valid_pts_x.shape[0])

    def _alloc_state(self) -> None:
        B, A, S, M = self.B, self.A, self.MAX_SHOTS, self.MAX_SMOKES
        dev = self.device

        self.step_count = torch.zeros(B, dtype=torch.long, device=dev)
        self.sim_time = torch.zeros(B, dtype=torch.float32, device=dev)
        self.scores = torch.zeros((B, 2), dtype=torch.float32, device=dev)

        # Actor state [B, A]
        self.x = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.y = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.z = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.vx = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.vy = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.vz = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.yaw = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.pitch = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.crouch = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.lean = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.aim_pose = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.on_ground = torch.ones((B, A), dtype=torch.bool, device=dev)
        self.alive = torch.ones((B, A), dtype=torch.bool, device=dev)
        self.respawn = torch.zeros((B, A), dtype=torch.float32, device=dev)

        self.hp = torch.full((B, A), 100.0, dtype=torch.float32, device=dev)
        self.shield = torch.full((B, A), BASE_SHIELD_MAX, dtype=torch.float32, device=dev)
        self.shield_clock = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.baizer = torch.zeros((B, A), dtype=torch.float32, device=dev)

        self.weapon_id = torch.zeros((B, A), dtype=torch.long, device=dev)
        self.mag = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.stock = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.ammo_clock = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.ammo_rate = torch.ones((B, A), dtype=torch.float32, device=dev)
        self.cooldown = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.reload_t = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.burst_left = torch.zeros((B, A), dtype=torch.long, device=dev)
        self.next_burst = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.flash = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.jump_cd = torch.zeros((B, A), dtype=torch.float32, device=dev)

        # Skills & smoke
        self.skill_is_heal = torch.zeros((B, A), dtype=torch.bool, device=dev)
        self.skill_kills = torch.zeros((B, A), dtype=torch.long, device=dev)
        self.skill_charges = torch.zeros((B, A), dtype=torch.long, device=dev)
        self.shaffer_t = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.smoke_cd = torch.zeros((B, A), dtype=torch.float32, device=dev)

        # Combat sensory trackers [B, A]
        self.under_fire_at = torch.full((B, A), -10.0, dtype=torch.float32, device=dev)
        self.last_fire_at = torch.full((B, A), -10.0, dtype=torch.float32, device=dev)
        self.hit_dir_x = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.hit_dir_z = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.last_dmg_by = torch.full((B, A), -1, dtype=torch.long, device=dev)
        self.last_dmg_at = torch.full((B, A), -10.0, dtype=torch.float32, device=dev)
        self.kills = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.deaths = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.shots_fired = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.shots_hit = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.dmg_dealt = torch.zeros((B, A), dtype=torch.float32, device=dev)

        # Fair-play per-agent contact memory [B, A, 2]
        # Stores: pos_x, pos_z, pos_y, time, kind (1=visual, 2=acoustic, 3=radio)
        self.mem_x = torch.zeros((B, A, 2), dtype=torch.float32, device=dev)
        self.mem_y = torch.full((B, A, 2), 1.2, dtype=torch.float32, device=dev)
        self.mem_z = torch.zeros((B, A, 2), dtype=torch.float32, device=dev)
        self.mem_t = torch.full((B, A, 2), -20.0, dtype=torch.float32, device=dev)
        self.mem_kind = torch.zeros((B, A, 2), dtype=torch.long, device=dev)

        # Recently seen enemy tracker per pair [B, A, A] (for fair peripheral FOV persistence)
        self.last_seen_pair = torch.full((B, A, A), -10.0, dtype=torch.float32, device=dev)

        # Last computed visible enemy targets [B, A, 3, ...] for action aim-mode execution
        self.vis_valid = torch.zeros((B, A, 3), dtype=torch.bool, device=dev)
        self.vis_pos = torch.zeros((B, A, 3, 3), dtype=torch.float32, device=dev)
        self.vis_vel = torch.zeros((B, A, 3, 3), dtype=torch.float32, device=dev)
        self.vis_dist = torch.full((B, A, 3), 99.0, dtype=torch.float32, device=dev)
        self.mem_valid = torch.zeros((B, A, 2), dtype=torch.bool, device=dev)
        self.mem_pos_cur = torch.zeros((B, A, 2, 3), dtype=torch.float32, device=dev)

        # Pickups cooldowns
        self.tanker_cd = torch.zeros((B, 3), dtype=torch.float32, device=dev)
        self.baizer_cd = torch.zeros((B, 6), dtype=torch.float32, device=dev)

        # Active smoke clouds [B, M]
        self.smoke_x = torch.zeros((B, M), dtype=torch.float32, device=dev)
        self.smoke_z = torch.zeros((B, M), dtype=torch.float32, device=dev)
        self.smoke_life = torch.zeros((B, M), dtype=torch.float32, device=dev)
        self.smoke_ptr = torch.zeros(B, dtype=torch.long, device=dev)

        # Active projectiles [B, S]
        self.shot_alive = torch.zeros((B, S), dtype=torch.bool, device=dev)
        self.shot_pos = torch.zeros((B, S, 3), dtype=torch.float32, device=dev)
        self.shot_dir = torch.zeros((B, S, 3), dtype=torch.float32, device=dev)
        self.shot_spd = torch.zeros((B, S), dtype=torch.float32, device=dev)
        self.shot_dmg = torch.zeros((B, S), dtype=torch.float32, device=dev)
        self.shot_life = torch.zeros((B, S), dtype=torch.float32, device=dev)
        self.shot_age = torch.zeros((B, S), dtype=torch.float32, device=dev)
        self.shot_owner = torch.zeros((B, S), dtype=torch.long, device=dev)
        self.shot_team = torch.zeros((B, S), dtype=torch.long, device=dev)
        self.shot_wpn = torch.zeros((B, S), dtype=torch.long, device=dev)
        self.shot_ric = torch.zeros((B, S), dtype=torch.long, device=dev)
        self.shot_pen = torch.zeros((B, S), dtype=torch.long, device=dev)
        self.shot_ptr = torch.zeros(B, dtype=torch.long, device=dev)

        # Previous distance to nearest enemy (for gentle Stage-1 engagement shaping)
        self.prev_min_enemy_dist = torch.full((B, A), 100.0, dtype=torch.float32, device=dev)
        self.prev_x = torch.zeros((B, A), dtype=torch.float32, device=dev)
        self.prev_z = torch.zeros((B, A), dtype=torch.float32, device=dev)

        # Cached observation + global critic state + aux targets
        self.last_obs = torch.zeros((B, A, OBS_DIM), dtype=torch.float32, device=dev)
        self.last_global = torch.zeros((B, A, CRITIC_GLOBAL_DIM), dtype=torch.float32, device=dev)
        self.last_aux = torch.zeros((B, A, 4), dtype=torch.float32, device=dev)

        # Zero-sync GPU rollout/episode accumulators (popped once per PPO update)
        self.stat_buf = torch.zeros(7, dtype=torch.float32, device=dev)
        # [0]=t0_kills, [1]=t0_deaths, [2]=t0_shots, [3]=t0_hits, [4]=t0_wins, [5]=ep_done, [6]=t0_dmg
        self._prev_k = torch.zeros((B, self.team_size), dtype=torch.float32, device=dev)
        self._prev_d = torch.zeros((B, self.team_size), dtype=torch.float32, device=dev)
        self._prev_sh = torch.zeros((B, self.team_size), dtype=torch.float32, device=dev)
        self._prev_ht = torch.zeros((B, self.team_size), dtype=torch.float32, device=dev)
        self._prev_dmg = torch.zeros((B, self.team_size), dtype=torch.float32, device=dev)

    def pop_metrics(self) -> Dict[str, float]:
        """Read and reset GPU-accumulated combat metrics once per PPO update (single CPU sync)."""
        vals = self.stat_buf.cpu().tolist()
        self.stat_buf.zero_()
        k, d, sh, ht, wins, eps, dmg = vals
        return {
            "t0_kills": k,
            "t0_deaths": d,
            "t0_kd": k / max(1.0, d),
            "t0_acc": ht / max(1.0, sh),
            "t0_dmg": dmg,
            "t0_win_rate": wins / max(1.0, eps) if eps > 0.5 else -1.0,
            "episodes_done": int(round(eps)),
        }

    def _body_center_and_eye(self) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Return (eye [B,A,3], target [B,A,3], cx [B,A], cz [B,A])."""
        torso = 1.0 - self.crouch * 0.34
        cx = self.x + torch.cos(self.yaw) * self.lean
        cz = self.z + torch.sin(self.yaw) * self.lean
        eye = torch.stack([cx, self.y + 1.50 * torso, cz], dim=-1)
        tgt = torch.stack([cx, self.y + 1.23 * torso, cz], dim=-1)
        return eye, tgt, cx, cz

    def reset(self, env_mask: Optional[torch.Tensor] = None) -> Tuple[torch.Tensor, torch.Tensor]:
        """Reset all arenas or a boolean subset `env_mask [B]`."""
        if env_mask is None:
            env_mask = torch.ones(self.B, dtype=torch.bool, device=self.device)
        idx = torch.nonzero(env_mask, as_tuple=False).squeeze(-1)
        n = int(idx.shape[0])
        if n == 0:
            return self.last_obs, self.last_global

        dev = self.device
        self.step_count[idx] = 0
        self.sim_time[idx] = 0.0
        self.scores[idx] = 0.0
        self.tanker_cd[idx] = 0.0
        self.baizer_cd[idx] = 0.0
        self.smoke_life[idx] = 0.0
        self.smoke_ptr[idx] = 0
        self.shot_alive[idx] = False
        self.shot_ptr[idx] = 0

        # Choose authentic full-wharf vs hot-zone skirmish spawns per arena
        draw_sp = torch.rand(n, generator=self.gen, device=dev)
        use_duel = draw_sp < (self.skirmish_spawn_prob * 0.45)
        use_skirmish = (~use_duel) & (draw_sp < self.skirmish_spawn_prob)

        # Base authentic team spawns [n, A, 2]
        sp_a = self.map.spawns[0, : self.team_size]  # [T, 2]
        sp_b = self.map.spawns[1, : self.team_size]
        base_sp = torch.cat([sp_a, sp_b], dim=0)[None, :, :].expand(n, self.A, 2).clone()

        # Hot-zone container skirmish spawns (24-44m apart across Harbor sectors)
        if use_skirmish.any():
            n_sk = int(use_skirmish.sum().item())
            center_z = torch.rand(n_sk, generator=self.gen, device=dev) * 70.0 - 35.0
            sep_half = 12.0 + torch.rand(n_sk, generator=self.gen, device=dev) * 9.0
            sk_pos = torch.zeros((n_sk, self.A, 2), dtype=torch.float32, device=dev)
            for a_i in range(self.A):
                is_t0 = a_i < self.team_size
                target_z = center_z + (sep_half if is_t0 else -sep_half)
                cand_idx = torch.randint(0, self.num_valid_pts, (n_sk, 12), generator=self.gen, device=dev)
                cx = self.valid_pts_x[cand_idx]
                cz = self.valid_pts_z[cand_idx]
                err = (cz - target_z[:, None]).abs()
                best = err.argmin(dim=-1)
                ar = torch.arange(n_sk, device=dev)
                sk_pos[:, a_i, 0] = cx[ar, best]
                sk_pos[:, a_i, 1] = cz[ar, best]
            base_sp[use_skirmish] = sk_pos

        # Direct-LOS open-lane skirmish spawns (14-26m apart on verified clear harbor corridors — accelerates from-scratch aim 10x!)
        if use_duel.any():
            n_du = int(use_duel.sum().item())
            # Verified open corridor anchors [lane_x, center_z] across Harbor Range
            corridors = torch.tensor(
                [[-20.5, 10.0], [-20.5, -25.0], [-2.5, 40.0], [2.5, -18.0], [21.0, 28.0], [21.0, -25.0], [-2.0, -52.0], [4.0, 62.0]],
                dtype=torch.float32,
                device=dev,
            )
            c_pick = torch.randint(0, corridors.shape[0], (n_du,), generator=self.gen, device=dev)
            lane_x = corridors[c_pick, 0]
            lane_z = corridors[c_pick, 1]
            sep = 8.5 + torch.rand(n_du, generator=self.gen, device=dev) * 5.0
            du_pos = torch.zeros((n_du, self.A, 2), dtype=torch.float32, device=dev)
            for a_i in range(self.A):
                is_t0 = a_i < self.team_size
                slot_i = a_i if is_t0 else (a_i - self.team_size)
                lat = (slot_i - (self.team_size - 1) * 0.5) * 2.1
                px = torch.clamp(lane_x + lat, -23.0, 23.0)
                pz = torch.clamp(lane_z + (sep if is_t0 else -sep), -94.0, 94.0)
                # Ensure walkable (fallback to exact corridor centerline if lateral offset clips a box)
                pen = self.map.penetration_depth(px, pz, torch.zeros_like(px), r=0.52)
                px = torch.where(pen <= 1e-5, px, lane_x)
                du_pos[:, a_i, 0] = px
                du_pos[:, a_i, 1] = pz
            base_sp[use_duel] = du_pos

        self.x[idx] = base_sp[:, :, 0]
        self.z[idx] = base_sp[:, :, 1]
        self.y[idx] = 0.0
        self.vx[idx] = 0.0
        self.vy[idx] = 0.0
        self.vz[idx] = 0.0
        # Team 0 faces North (yaw=0 -> -z), Team 1 faces South (yaw=pi -> +z), with slight random jitter
        base_yaw = torch.where(self.team_id == 0, 0.0, math.pi)[None, :].expand(n, self.A)
        self.yaw[idx] = base_yaw + (torch.rand((n, self.A), generator=self.gen, device=dev) - 0.5) * 0.45
        self.pitch[idx] = 0.0
        self.crouch[idx] = 0.0
        self.lean[idx] = 0.0
        self.aim_pose[idx] = 0.0
        self.on_ground[idx] = True
        self.alive[idx] = True
        self.respawn[idx] = 0.0

        self.hp[idx] = 100.0
        self.shield[idx] = BASE_SHIELD_MAX
        self.shield_clock[idx] = 0.0
        self.baizer[idx] = 0.0

        # Randomize NPC weapons across all 7 authentic Harbor weapons so RNV1 masters every gun!
        w_ids = torch.randint(0, NUM_WEAPONS, (n, self.A), generator=self.gen, device=dev)
        self.weapon_id[idx] = w_ids
        self.mag[idx] = self.w_cap[w_ids]
        self.stock[idx] = self.w_stock_cap[w_ids]
        self.ammo_clock[idx] = 0.0
        self.ammo_rate[idx] = 1.0
        self.cooldown[idx] = 0.0
        self.reload_t[idx] = 0.0
        self.burst_left[idx] = 0
        self.next_burst[idx] = 0.0
        self.flash[idx] = 0.0
        self.jump_cd[idx] = 0.0

        self.skill_is_heal[idx] = torch.rand((n, self.A), generator=self.gen, device=dev) < 0.5
        self.skill_kills[idx] = 0
        self.skill_charges[idx] = 0
        self.shaffer_t[idx] = 0.0
        self.smoke_cd[idx] = 0.0

        self.under_fire_at[idx] = -10.0
        self.last_fire_at[idx] = -10.0
        self.hit_dir_x[idx] = 0.0
        self.hit_dir_z[idx] = 0.0
        self.last_dmg_by[idx] = -1
        self.last_dmg_at[idx] = -10.0
        self.kills[idx] = 0.0
        self.deaths[idx] = 0.0
        self.shots_fired[idx] = 0.0
        self.shots_hit[idx] = 0.0
        self.dmg_dealt[idx] = 0.0
        self._prev_k[idx] = 0.0
        self._prev_d[idx] = 0.0
        self._prev_sh[idx] = 0.0
        self._prev_ht[idx] = 0.0
        self._prev_dmg[idx] = 0.0

        self.mem_t[idx] = -20.0
        self.mem_kind[idx] = 0
        self.last_seen_pair[idx] = -10.0
        self.prev_x[idx] = self.x[idx]
        self.prev_z[idx] = self.z[idx]
        self.prev_min_enemy_dist[idx] = 80.0

        self._compute_observations()
        return self.last_obs, self.last_global

    def _respawn_dead_actors(self, mask: torch.Tensor) -> None:
        """Respawn actors where `mask [B, A]` is True at safest team spawn."""
        if not mask.any():
            return
        dev = self.device
        b_idx, a_idx = torch.nonzero(mask, as_tuple=True)
        k = int(b_idx.shape[0])
        t_id = self.team_id[a_idx]  # [k]
        # Candidate spawns for each actor's team: [k, 6, 2]
        cand = self.map.spawns[t_id]  # [k, 6, 2]
        # Pick spawn farthest from alive enemies + small random jitter
        ex = self.x[b_idx]  # [k, A]
        ez = self.z[b_idx]
        e_alive = self.alive[b_idx]
        is_enemy = (self.team_id[None, :] != t_id[:, None]) & e_alive  # [k, A]

        dx = cand[:, :, 0:1] - ex[:, None, :]  # [k, 6, A]
        dz = cand[:, :, 1:2] - ez[:, None, :]
        dist = torch.hypot(dx, dz)
        dist_e = torch.where(is_enemy[:, None, :], dist, torch.full_like(dist, 999.0))
        min_ed = torch.clamp(dist_e.min(dim=-1).values, max=65.0)  # [k, 6]
        score = min_ed + torch.rand((k, 6), generator=self.gen, device=dev) * 10.0
        best = score.argmax(dim=-1)
        ar = torch.arange(k, device=dev)
        px = cand[ar, best, 0]
        pz = cand[ar, best, 1]

        self.x[b_idx, a_idx] = px
        self.z[b_idx, a_idx] = pz
        self.y[b_idx, a_idx] = 0.0
        self.vx[b_idx, a_idx] = 0.0
        self.vy[b_idx, a_idx] = 0.0
        self.vz[b_idx, a_idx] = 0.0
        self.yaw[b_idx, a_idx] = torch.where(t_id == 0, 0.0, math.pi)
        self.pitch[b_idx, a_idx] = 0.0
        self.crouch[b_idx, a_idx] = 0.0
        self.lean[b_idx, a_idx] = 0.0
        self.aim_pose[b_idx, a_idx] = 0.0
        self.on_ground[b_idx, a_idx] = True
        self.alive[b_idx, a_idx] = True
        self.respawn[b_idx, a_idx] = 0.0
        self.hp[b_idx, a_idx] = 100.0
        self.shield[b_idx, a_idx] = BASE_SHIELD_MAX
        self.shield_clock[b_idx, a_idx] = 0.0
        self.baizer[b_idx, a_idx] = 0.0
        w = self.weapon_id[b_idx, a_idx]
        self.mag[b_idx, a_idx] = self.w_cap[w]
        self.stock[b_idx, a_idx] = self.w_stock_cap[w]
        self.ammo_clock[b_idx, a_idx] = 0.0
        self.ammo_rate[b_idx, a_idx] = 1.0
        self.cooldown[b_idx, a_idx] = 0.0
        self.reload_t[b_idx, a_idx] = 0.0
        self.burst_left[b_idx, a_idx] = 0
        self.flash[b_idx, a_idx] = 0.0
        self.shaffer_t[b_idx, a_idx] = 0.0
        self.smoke_cd[b_idx, a_idx] = 0.0
        self.under_fire_at[b_idx, a_idx] = -10.0
        self.last_dmg_by[b_idx, a_idx] = -1
        self.mem_t[b_idx, a_idx] = -20.0
        self.prev_x[b_idx, a_idx] = px
        self.prev_z[b_idx, a_idx] = pz

    def _record_memory(
        self,
        env_idx: torch.Tensor,
        actor_idx: torch.Tensor,
        px: torch.Tensor,
        py: torch.Tensor,
        pz: torch.Tensor,
        kind: int,
    ) -> None:
        """Insert a fair-play contact memory into slot 0 (shifting previous slot 0 to slot 1 if distinct)."""
        if env_idx.numel() == 0:
            return
        cur_x0 = self.mem_x[env_idx, actor_idx, 0]
        cur_z0 = self.mem_z[env_idx, actor_idx, 0]
        far = torch.hypot(px - cur_x0, pz - cur_z0) > 6.5
        # Shift slot 0 -> slot 1 when new contact is spatially distinct
        self.mem_x[env_idx, actor_idx, 1] = torch.where(far, cur_x0, self.mem_x[env_idx, actor_idx, 1])
        self.mem_y[env_idx, actor_idx, 1] = torch.where(far, self.mem_y[env_idx, actor_idx, 0], self.mem_y[env_idx, actor_idx, 1])
        self.mem_z[env_idx, actor_idx, 1] = torch.where(far, cur_z0, self.mem_z[env_idx, actor_idx, 1])
        self.mem_t[env_idx, actor_idx, 1] = torch.where(far, self.mem_t[env_idx, actor_idx, 0], self.mem_t[env_idx, actor_idx, 1])
        self.mem_kind[env_idx, actor_idx, 1] = torch.where(far, self.mem_kind[env_idx, actor_idx, 0], self.mem_kind[env_idx, actor_idx, 1])

        self.mem_x[env_idx, actor_idx, 0] = px
        self.mem_y[env_idx, actor_idx, 0] = py
        self.mem_z[env_idx, actor_idx, 0] = pz
        self.mem_t[env_idx, actor_idx, 0] = self.sim_time[env_idx]
        self.mem_kind[env_idx, actor_idx, 0] = kind

    def _spawn_shots(self, fire_mask: torch.Tensor) -> None:
        """Spawn projectiles for firing actors (multi-pellet salvo support + acoustic emission)."""
        if not fire_mask.any():
            return
        dev = self.device
        b_idx, a_idx = torch.nonzero(fire_mask, as_tuple=True)
        w = self.weapon_id[b_idx, a_idx]
        pellets = torch.minimum(self.w_pellets[w], self.mag[b_idx, a_idx].long())
        ok = pellets > 0
        if not ok.any():
            return
        b_idx, a_idx, w, pellets = b_idx[ok], a_idx[ok], w[ok], pellets[ok]

        self.mag[b_idx, a_idx] -= pellets.float()
        self.cooldown[b_idx, a_idx] = self.w_int[w]
        self.flash[b_idx, a_idx] = 0.105
        self.last_fire_at[b_idx, a_idx] = self.sim_time[b_idx]
        self.shots_fired[b_idx, a_idx] += pellets.float()

        # Eye origin & firing direction matching dist/js/geometry.js forward(yaw, pitch)
        torso = 1.0 - self.crouch[b_idx, a_idx] * 0.34
        yaw = self.yaw[b_idx, a_idx]
        pitch = self.pitch[b_idx, a_idx]
        cx = self.x[b_idx, a_idx] + torch.cos(yaw) * self.lean[b_idx, a_idx]
        cz = self.z[b_idx, a_idx] + torch.sin(yaw) * self.lean[b_idx, a_idx]
        ey = self.y[b_idx, a_idx] + 1.50 * torso

        cp = torch.cos(pitch)
        dx = torch.sin(yaw) * cp
        dy = torch.sin(pitch)
        dz = -torch.cos(yaw) * cp

        # Slight realistic movement spread when sprinting / airborne (encourages counter-strafe & crouch!)
        h_spd = torch.hypot(self.vx[b_idx, a_idx], self.vz[b_idx, a_idx])
        spread = 0.004 + 0.008 * torch.clamp((h_spd - 2.5) / 4.0, 0.0, 1.0) + torch.where(self.on_ground[b_idx, a_idx], 0.0, 0.024)
        spread = spread * (1.0 - 0.30 * self.crouch[b_idx, a_idx])

        # Handle up to 2 pellets (RD30 = 2 pellets, all other NPC guns = 1 pellet)
        max_p = int(pellets.max().item())
        for p_k in range(max_p):
            pm = pellets > p_k
            if not pm.any():
                continue
            pb, pa, pw = b_idx[pm], a_idx[pm], w[pm]
            sp = spread[pm]
            j_x = (torch.rand(pb.shape[0], generator=self.gen, device=dev) - 0.5) * 2.0 * sp
            j_y = (torch.rand(pb.shape[0], generator=self.gen, device=dev) - 0.5) * 2.0 * sp
            j_z = (torch.rand(pb.shape[0], generator=self.gen, device=dev) - 0.5) * 2.0 * sp
            sdir = torch.stack([dx[pm] + j_x, dy[pm] + j_y, dz[pm] + j_z], dim=-1)
            sdir = sdir / torch.clamp(sdir.norm(dim=-1, keepdim=True), min=1e-6)

            slot = self.shot_ptr[pb] % self.MAX_SHOTS
            self.shot_ptr[pb] = (self.shot_ptr[pb] + 1) % self.MAX_SHOTS

            self.shot_alive[pb, slot] = True
            self.shot_pos[pb, slot, 0] = cx[pm]
            self.shot_pos[pb, slot, 1] = ey[pm]
            self.shot_pos[pb, slot, 2] = cz[pm]
            self.shot_dir[pb, slot] = sdir
            self.shot_spd[pb, slot] = self.w_spd[pw]
            self.shot_dmg[pb, slot] = self.w_dmg[pw]
            self.shot_life[pb, slot] = 1.35
            self.shot_age[pb, slot] = 0.0
            self.shot_owner[pb, slot] = pa
            self.shot_team[pb, slot] = self.team_id[pa]
            self.shot_wpn[pb, slot] = pw
            self.shot_ric[pb, slot] = 0
            self.shot_pen[pb, slot] = 0

        # Acoustic gunshot emission (fair-play, skipped if shooter is Shaffer-cloaked!)
        audible_src = self.shaffer_t[b_idx, a_idx] <= 0.0
        if audible_src.any():
            ab = b_idx[audible_src]
            aa = a_idx[audible_src]
            sx = self.x[ab, aa]
            sz = self.z[ab, aa]
            s_team = self.team_id[aa]
            # Notify enemies within MAX_ACOUSTIC_RANGE with realistic acoustic jitter
            jitter_x = sx[:, None] + (torch.rand((ab.shape[0], self.A), generator=self.gen, device=dev) - 0.5) * 5.0
            jitter_z = sz[:, None] + (torch.rand((ab.shape[0], self.A), generator=self.gen, device=dev) - 0.5) * 5.0
            d_all = torch.hypot(self.x[ab] - sx[:, None], self.z[ab] - sz[:, None])
            hear = (self.team_id[None, :] != s_team[:, None]) & self.alive[ab] & (d_all < MAX_ACOUSTIC_RANGE)
            if hear.any():
                hb_local, ha = torch.nonzero(hear, as_tuple=True)
                hb = ab[hb_local]
                self._record_memory(
                    hb, ha,
                    jitter_x[hb_local, ha],
                    torch.full_like(jitter_x[hb_local, ha], 1.2),
                    jitter_z[hb_local, ha],
                    kind=2,
                )

    def _step_projectiles(self, dt: float, rew: torch.Tensor) -> None:
        """Advance all active projectiles with exact AABB raycast, BallisticCore-X pen/ricochet & capsule hit."""
        active = self.shot_alive
        if not active.any():
            return
        B, A = self.B, self.A
        dev = self.device
        b_idx, s_idx = torch.nonzero(active, as_tuple=True)
        K = int(b_idx.shape[0])

        a_pos = self.shot_pos[b_idx, s_idx]       # [K, 3]
        s_dir = self.shot_dir[b_idx, s_idx]       # [K, 3]
        s_spd = self.shot_spd[b_idx, s_idx]       # [K]
        s_life = self.shot_life[b_idx, s_idx]     # [K]
        s_team = self.shot_team[b_idx, s_idx]     # [K]
        s_owner = self.shot_owner[b_idx, s_idx]   # [K]
        s_dmg = self.shot_dmg[b_idx, s_idx]       # [K]
        s_wpn = self.shot_wpn[b_idx, s_idx]       # [K]

        travel = torch.clamp(s_life, max=dt)
        b_pos = a_pos + s_dir * (s_spd * travel)[:, None]

        # 1. Exact 3D AABB raycast against all 80 Harbor obstacles + deck
        wall_t, wall_exit, wall_mat, wall_nrm = self.map.raycast_segment_obstruction(a_pos, b_pos)

        # 2. Vectorized capsule hit check against all A actors in each shot's arena [K, A]
        ax = self.x[b_idx]
        ay = self.y[b_idx]
        az = self.z[b_idx]
        ayaw = self.yaw[b_idx]
        acrouch = self.crouch[b_idx]
        alean = self.lean[b_idx]
        aalive = self.alive[b_idx]
        avx = self.vx[b_idx]
        avz = self.vz[b_idx]

        # QuantumTick midpoint co-moving capsule approximation (matches sweptMovingBodyHit!)
        cx = ax + torch.cos(ayaw) * alean - avx * (0.5 * travel[:, None])
        cz = az + torch.sin(ayaw) * alean - avz * (0.5 * travel[:, None])
        torso = 1.0 - acrouch * 0.34
        lo = ay + 0.36
        hi = ay + 1.46 * torso
        rr = 0.41  # exact 0.39 capsule + slight swept tolerance

        # Segment a_pos -> b_pos vs vertical cylinder [K, A]
        d_seg = b_pos - a_pos  # [K, 3]
        dx = d_seg[:, 0:1]
        dy = d_seg[:, 1:2]
        dz = d_seg[:, 2:3]
        ox = a_pos[:, 0:1] - cx
        oz = a_pos[:, 2:3] - cz

        # Closest u along horizontal projection
        A_q = dx * dx + dz * dz
        B_q = ox * dx + oz * dz
        C_q = ox * ox + oz * oz - rr * rr
        disc = B_q * B_q - A_q * C_q
        safe_A = torch.where(A_q > 1e-10, A_q, torch.ones_like(A_q))
        u_hit = torch.where(
            (A_q > 1e-10) & (disc >= 0.0),
            (-B_q - torch.sqrt(torch.clamp(disc, min=0.0))) / safe_A,
            torch.full_like(disc, float("inf")),
        )
        u_hit = torch.where((C_q <= 0.0), torch.zeros_like(u_hit), u_hit)
        y_at = a_pos[:, 1:2] + dy * torch.clamp(u_hit, 0.0, 1.0)
        valid_body = (
            aalive
            & (self.team_id[None, :] != s_team[:, None])
            & (u_hit >= 0.0)
            & (u_hit <= 1.0)
            & (y_at >= lo - 0.25)
            & (y_at <= hi + 0.25)
        )
        t_body = torch.where(valid_body, u_hit, torch.full_like(u_hit, float("inf")))
        min_body_t, hit_actor = t_body.min(dim=-1)  # [K]

        hit_enemy = min_body_t < wall_t
        hit_wall = (~hit_enemy) & (wall_t <= 1.0)
        in_flight = (~hit_enemy) & (~hit_wall)

        # 3. Vectorized GPU enemy hits, damage layering (BAIZER -> Shield 25 -> HP 100), kills & trade rewards
        if hit_enemy.any():
            he_idx = torch.nonzero(hit_enemy, as_tuple=False).squeeze(-1)
            eb = b_idx[he_idx]
            es = s_idx[he_idx]
            ev = hit_actor[he_idx]
            eo = s_owner[he_idx]
            dmg = s_dmg[he_idx]
            sd = s_dir[he_idx]
            was_ric_or_pen = ((self.shot_ric[eb, es] > 0) | (self.shot_pen[eb, es] > 0)).float()

            self.shot_alive[eb, es] = False

            # Only apply hits to currently alive victims
            v_alive_m = self.alive[eb, ev]
            if v_alive_m.any():
                eb = eb[v_alive_m]
                ev = ev[v_alive_m]
                eo = eo[v_alive_m]
                dmg = dmg[v_alive_m]
                sd = sd[v_alive_m]
                was_ric_or_pen = was_ric_or_pen[v_alive_m]

                # Accumulate total incoming damage per victim [B, A]
                dmg_in = torch.zeros((B, A), dtype=torch.float32, device=dev)
                dmg_in.index_put_((eb, ev), dmg, accumulate=True)

                # Credit hits & damage dealt to shooters
                ones_k = torch.ones_like(dmg)
                self.shots_hit.index_put_((eb, eo), ones_k, accumulate=True)
                self.dmg_dealt.index_put_((eb, eo), dmg, accumulate=True)

                # Flanking & wallbang/ricochet bonuses per hit -> accumulated to attacker rewards
                v_yaw = self.yaw[eb, ev]
                to_ox = self.x[eb, eo] - self.x[eb, ev]
                to_oz = self.z[eb, eo] - self.z[eb, ev]
                f_dot = (torch.sin(v_yaw) * to_ox - torch.cos(v_yaw) * to_oz) / torch.clamp(torch.hypot(to_ox, to_oz), min=1e-4)
                flank_r = torch.where(f_dot < 0.2, 0.012 * dmg, torch.zeros_like(dmg))
                hit_rew = dmg * 0.028 + flank_r + was_ric_or_pen * (0.25 * self.shaping_scale)
                rew.index_put_((eb, eo), hit_rew, accumulate=True)

                # Record last attacker & hit direction on victims
                self.under_fire_at[eb, ev] = self.sim_time[eb]
                self.hit_dir_x[eb, ev] = -sd[:, 0]
                self.hit_dir_z[eb, ev] = -sd[:, 2]
                self.last_dmg_by[eb, ev] = eo
                self.last_dmg_at[eb, ev] = self.sim_time[eb]

                # Exact damage layering across all struck actors [B, A] in parallel
                struck = (dmg_in > 0.0) & self.alive
                bz_cur = self.baizer
                bz_abs = torch.minimum(bz_cur, dmg_in)
                new_bz = torch.clamp(bz_cur - bz_abs, min=0.0)
                rem1 = torch.clamp(dmg_in - bz_abs, min=0.0)

                sh_cur = self.shield
                sh_abs = torch.minimum(sh_cur, rem1)
                new_sh = torch.clamp(sh_cur - sh_abs, min=0.0)
                hp_loss = torch.clamp(rem1 - sh_abs, min=0.0)
                new_hp = torch.clamp(self.hp - hp_loss, min=0.0)

                sh_break = struck & (((sh_cur > 0.0) & (new_sh <= 0.0)) | ((bz_cur > 0.0) & (new_bz <= 0.0)))
                killed = struck & (new_hp <= 0.0)

                self.baizer = torch.where(struck, new_bz, self.baizer)
                self.shield = torch.where(struck, new_sh, self.shield)
                self.hp = torch.where(struck, new_hp, self.hp)
                rew -= torch.where(struck, dmg_in * 0.020, torch.zeros_like(rew))

                # Shield-break bonus to last attacker
                if sh_break.any():
                    sbb, sbv = torch.nonzero(sh_break, as_tuple=True)
                    sbo = self.last_dmg_by[sbb, sbv]
                    ok_o = sbo >= 0
                    if ok_o.any():
                        rew.index_put_((sbb[ok_o], sbo[ok_o]), torch.full((int(ok_o.sum().item()),), 0.18, device=dev), accumulate=True)

                # Kill resolution (100% vectorized across all simultaneous kills!)
                if killed.any():
                    kb, kv = torch.nonzero(killed, as_tuple=True)
                    ko = torch.clamp(self.last_dmg_by[kb, kv], min=0)
                    ko_team = self.team_id[ko]

                    self.alive[kb, kv] = False
                    self.respawn[kb, kv] = RESPAWN_DURATION
                    self.reload_t[kb, kv] = 0.0
                    self.burst_left[kb, kv] = 0
                    self.shaffer_t[kb, kv] = 0.0
                    self.baizer[kb, kv] = 0.0
                    self.deaths[kb, kv] += 1.0
                    self.kills.index_put_((kb, ko), torch.ones(kb.shape[0], device=dev), accumulate=True)
                    self.scores.index_put_((kb, ko_team), torch.ones(kb.shape[0], device=dev), accumulate=True)

                    # Skill charging every 5 kills
                    if self.enable_skills:
                        can_chg = self.skill_charges[kb, ko] < MAX_SKILL_CHARGES
                        if can_chg.any():
                            cb, co = kb[can_chg], ko[can_chg]
                            self.skill_kills.index_put_((cb, co), torch.ones(cb.shape[0], dtype=torch.long, device=dev), accumulate=True)
                            earned = self.skill_kills[cb, co] >= KILLS_PER_SKILL_CHARGE
                            if earned.any():
                                eb2, eo2 = cb[earned], co[earned]
                                self.skill_kills[eb2, eo2] -= KILLS_PER_SKILL_CHARGE
                                self.skill_charges[eb2, eo2] = torch.clamp(self.skill_charges[eb2, eo2] + 1, max=MAX_SKILL_CHARGES)

                    # Trade-kill detection: did victim kv damage a teammate of ko within last 3.0s?
                    mate_same = (self.team_id[None, :] == ko_team[:, None]) & (torch.arange(A, device=dev)[None, :] != ko[:, None])
                    damaged_by_kv = (self.last_dmg_by[kb] == kv[:, None]) & ((self.sim_time[kb, None] - self.last_dmg_at[kb]) < 3.0)
                    is_trade = (mate_same & damaged_by_kv).any(dim=-1).float()

                    rew.index_put_((kb, ko), 2.5 + is_trade * 0.65, accumulate=True)
                    rew[kb, kv] -= 2.2

                    # Shared team score signal (per-team kills in this substep -> teammate coordination reward!)
                    t0_k_step = (killed & (self.team_id[None, :] == 1)).float().sum(dim=-1, keepdim=True)  # Team 0 scored
                    t1_k_step = (killed & (self.team_id[None, :] == 0)).float().sum(dim=-1, keepdim=True)  # Team 1 scored
                    team_delta = torch.where(self.team_id[None, :] == 0, t0_k_step * 0.30 - t1_k_step * 0.22, t1_k_step * 0.30 - t0_k_step * 0.22)
                    rew += team_delta

        # 4. Handle wall impacts: BallisticCore-X Wood Wallbang & Steel/Concrete Ricochet!
        if hit_wall.any():
            hw = torch.nonzero(hit_wall, as_tuple=False).squeeze(-1)
            wb = b_idx[hw]
            ws = s_idx[hw]
            wt = wall_t[hw]
            wex = wall_exit[hw]
            wmat = wall_mat[hw]
            wnrm = wall_nrm[hw]
            wd = s_dir[hw]
            wspd = s_spd[hw]
            wdmg = s_dmg[hw]
            wwpn = s_wpn[hw]

            seg_len = (b_pos[hw] - a_pos[hw]).norm(dim=-1)
            hit_pt = a_pos[hw] + (b_pos[hw] - a_pos[hw]) * wt[:, None]
            dn = (wd * wnrm).sum(dim=-1)
            sin_g = dn.abs()

            # Check grazing ricochet (steel <= 0.41, concrete <= 0.28)
            crit = torch.where(wmat == MAT_STEEL, 0.41, torch.where(wmat == MAT_CONCRETE, 0.28, 0.0))
            can_ric = (dn < -1e-4) & (crit > 0.0) & (sin_g <= crit) & (self.shot_ric[wb, ws] < self.w_max_ric[wwpn]) & (wspd >= 140.0) & (wdmg >= 1.2)

            # Check wood-crate slab penetration
            thick = torch.where(torch.isfinite(wex), (wex - wt) * seg_len, torch.full_like(wt, 99.0))
            wood_budget = self.w_wood_pen[wwpn]
            can_pen = (~can_ric) & (wmat == MAT_WOOD) & (thick > 0.02) & (thick <= wood_budget) & (self.shot_pen[wb, ws] < 1) & (wspd >= 150.0)

            # Apply ricochet reflection
            if can_ric.any():
                rb, rs = wb[can_ric], ws[can_ric]
                r_dir = wd[can_ric] - 2.0 * dn[can_ric, None] * wnrm[can_ric]
                r_dir = r_dir / torch.clamp(r_dir.norm(dim=-1, keepdim=True), min=1e-6)
                is_st = wmat[can_ric] == MAT_STEEL
                self.shot_pos[rb, rs] = hit_pt[can_ric] + wnrm[can_ric] * 0.05
                self.shot_dir[rb, rs] = r_dir
                self.shot_spd[rb, rs] = wspd[can_ric] * torch.where(is_st, 0.80, 0.72)
                self.shot_dmg[rb, rs] = torch.clamp(wdmg[can_ric] * torch.where(is_st, 0.74, 0.65), min=1.0)
                self.shot_ric[rb, rs] += 1
                self.shot_life[rb, rs] -= travel[hw][can_ric]
                self.shot_age[rb, rs] += travel[hw][can_ric]

            # Apply wood penetration
            if can_pen.any():
                pb, ps = wb[can_pen], ws[can_pen]
                exit_pt = a_pos[hw][can_pen] + (b_pos[hw][can_pen] - a_pos[hw][can_pen]) * wex[can_pen, None] + wd[can_pen] * 0.06
                loss = torch.clamp(thick[can_pen] / wood_budget[can_pen], 0.08, 0.85)
                self.shot_pos[pb, ps] = exit_pt
                self.shot_spd[pb, ps] = wspd[can_pen] * torch.clamp(1.0 - loss * 0.36, 0.52, 0.92)
                self.shot_dmg[pb, ps] = torch.clamp(wdmg[can_pen] * torch.clamp(1.0 - loss * 0.56, 0.38, 0.90), min=1.2)
                self.shot_pen[pb, ps] += 1
                self.shot_life[pb, ps] -= travel[hw][can_pen]
                self.shot_age[pb, ps] += travel[hw][can_pen]

            # Stop all other wall hits
            stopped = ~(can_ric | can_pen)
            if stopped.any():
                self.shot_alive[wb[stopped], ws[stopped]] = False

        # 5. Advance unobstructed in-flight projectiles
        if in_flight.any():
            fb, fs = b_idx[in_flight], s_idx[in_flight]
            new_p = b_pos[in_flight]
            new_l = s_life[in_flight] - travel[in_flight]
            still_ok = (new_l > 0.0) & (new_p[:, 0].abs() < 120.0) & (new_p[:, 2].abs() < 200.0) & (new_p[:, 1] > -1.68)
            self.shot_pos[fb, fs] = new_p
            self.shot_life[fb, fs] = new_l
            self.shot_age[fb, fs] += travel[in_flight]
            self.shot_alive[fb, fs] = still_ok

    def _compute_observations(self) -> None:
        """Compute strictly 100% Fair-Play 144-dim obs + 64-dim Centralized Critic state + 4-dim Aux targets."""
        B, A = self.B, self.A
        dev = self.device
        obs = self.last_obs
        obs.zero_()

        eye, tgt, cx, cz = self._body_center_and_eye()  # [B, A, 3]
        sy = torch.sin(self.yaw)
        cy = torch.cos(self.yaw)
        local_fwd = self.vx * sy - self.vz * cy
        local_side = self.vx * cy + self.vz * sy
        w = self.weapon_id

        # ---- Block A: Ego Kinematics, Vitals & Weapon (0..34) ----
        obs[:, :, 0] = torch.clamp(self.x / FIELD_HALF_W, -1.0, 1.0)
        obs[:, :, 1] = torch.clamp(self.z / FIELD_HALF_L, -1.0, 1.0)
        obs[:, :, 2] = torch.clamp(self.y / 3.0, 0.0, 1.5)
        obs[:, :, 3] = self.team_sign[None, :]
        obs[:, :, 4] = sy
        obs[:, :, 5] = cy
        obs[:, :, 6] = torch.clamp(self.pitch / 1.2, -1.0, 1.0)
        obs[:, :, 7] = torch.clamp(local_fwd / 6.75, -1.0, 1.0)
        obs[:, :, 8] = torch.clamp(local_side / 6.75, -1.0, 1.0)
        obs[:, :, 9] = torch.clamp(self.vy / 6.5, -1.0, 1.0)
        obs[:, :, 10] = torch.clamp(self.crouch, 0.0, 1.0)
        obs[:, :, 11] = torch.clamp(self.lean / 0.32, -1.0, 1.0)
        obs[:, :, 12] = self.on_ground.float()
        obs[:, :, 13] = torch.clamp(self.aim_pose, 0.0, 1.0)
        obs[:, :, 14] = torch.clamp(self.hp / 100.0, 0.0, 1.0)
        obs[:, :, 15] = torch.clamp(self.shield / BASE_SHIELD_MAX, 0.0, 1.0)
        obs[:, :, 16] = torch.clamp(self.baizer / BAIZER_MAX_STACK, 0.0, 1.0)
        obs[:, :, 17] = torch.clamp(self.mag / self.w_cap[w], 0.0, 1.0)
        obs[:, :, 18] = torch.clamp(self.stock / 300.0, 0.0, 1.0)
        obs[:, :, 19] = torch.clamp(self.reload_t / self.w_reload[w], 0.0, 1.0)
        obs[:, :, 20] = torch.clamp(self.cooldown / self.w_int[w], 0.0, 1.0)

        obs[:, :, 21] = self.w_dmg[w] / 10.0
        obs[:, :, 22] = self.w_spd[w] / 650.0
        obs[:, :, 23] = self.w_int[w] / 0.30
        obs[:, :, 24] = self.w_burst[w].float() / 3.0
        obs[:, :, 25] = self.w_pellets[w].float() / 4.0
        obs[:, :, 26] = self.w_auto[w]
        obs[:, :, 27] = self.w_stock_regen[w] / 4.0

        obs[:, :, 28] = torch.clamp(self.shaffer_t / SHAFFER_DURATION, 0.0, 1.0)
        obs[:, :, 29] = (self.smoke_cd <= 0.01).float()
        obs[:, :, 30] = torch.clamp(self.skill_charges.float() / 3.0, 0.0, 1.0)
        obs[:, :, 31] = torch.where(self.skill_is_heal, 1.0, -1.0) if self.enable_skills else 0.0
        uf_decay = torch.clamp(1.0 - (self.sim_time[:, None] - self.under_fire_at) / 2.5, 0.0, 1.0)
        obs[:, :, 32] = uf_decay
        obs[:, :, 33] = (self.hit_dir_x * cy + self.hit_dir_z * sy) * uf_decay
        obs[:, :, 34] = (self.hit_dir_x * sy - self.hit_dir_z * cy) * uf_decay

        # ---- Block B: Egocentric Spatial & Cover Lidar (35..58) ----
        fx = self.x.reshape(-1)
        fz = self.z.reshape(-1)
        fyaw = self.yaw.reshape(-1)
        cd12, _, _, _ = self.map.sample_lidar_lut(fx, fz, fyaw, self.lidar_chest_rad)
        _, ld6, hd6, _ = self.map.sample_lidar_lut(fx, fz, fyaw, self.lidar_low_rad)
        _, _, _, cm4 = self.map.sample_lidar_lut(fx, fz, fyaw, self.lidar_mat_rad)

        cd12 = cd12.view(B, A, 12)
        obs[:, :, 35:47] = torch.clamp(cd12 / LIDAR_MAX_DIST, 0.0, 1.0)
        obs[:, :, 47:53] = torch.clamp((hd6.view(B, A, 6) - ld6.view(B, A, 6)) / LIDAR_MAX_DIST, 0.0, 1.0)
        cm4_v = cm4.view(B, A, 4)
        obs[:, :, 53:57] = torch.where(cm4_v == MAT_WOOD, 1.0, torch.where(cm4_v == MAT_STEEL, -1.0, 0.0))
        obs[:, :, 57] = (cd12.min(dim=-1).values < 2.4).float()
        obs[:, :, 58] = torch.clamp(self.y / 2.62, 0.0, 1.0)

        # ---- Block C: Fair-Play Visible Enemies (59..100, Top 3 x 14) ----
        # Pairwise vectors [B, A, A]
        dx_p = self.x[:, None, :] - self.x[:, :, None]  # [B, obs_actor, other_actor]
        dz_p = self.z[:, None, :] - self.z[:, :, None]
        dist_p = torch.hypot(dx_p, dz_p)
        bearing_p = torch.atan2(dx_p, -dz_p)
        rel_yaw_p = angle_diff(bearing_p, self.yaw[:, :, None])

        # Strict Fair-Play Visibility Pre-filter: alive, enemy, uncloaked, in range, in FOV
        recent_track = (self.sim_time[:, None, None] - self.last_seen_pair) < 1.2
        fov_lim = torch.where(recent_track, TRACK_FOV_HALF, NORMAL_FOV_HALF)
        in_fov = (rel_yaw_p.abs() <= fov_lim) | (dist_p <= PROXIMITY_SENSE_RANGE)
        cand_vis = (
            self.enemy_mask[None, :, :]
            & self.alive[:, :, None]
            & self.alive[:, None, :]
            & (self.shaffer_t[:, None, :] <= 0.0)
            & (dist_p <= MAX_VISION_RANGE)
            & in_fov
        )

        # Smoke occlusion check against active smoke clouds [B, M]
        if (self.smoke_life > 0.0).any():
            # Closest point on 2D segment (a -> e) to each active smoke center
            ax_s = self.x[:, :, None, None]
            az_s = self.z[:, :, None, None]
            dx_s = dx_p[:, :, :, None]
            dz_s = dz_p[:, :, :, None]
            sx_s = self.smoke_x[:, None, None, :]
            sz_s = self.smoke_z[:, None, None, :]
            ab2 = dx_s * dx_s + dz_s * dz_s + 1e-6
            u_s = torch.clamp(((sx_s - ax_s) * dx_s + (sz_s - az_s) * dz_s) / ab2, 0.0, 1.0)
            px_s = ax_s + dx_s * u_s
            pz_s = az_s + dz_s * u_s
            d_smoke = torch.hypot(px_s - sx_s, pz_s - sz_s)
            smoke_block = ((self.smoke_life[:, None, None, :] > 0.0) & (d_smoke < SMOKE_RADIUS)).any(dim=-1)
            cand_vis = cand_vis & (~smoke_block)

        # Exact 3D AABB LOS raycast ONLY on candidate visible pairs!
        vis_mat = torch.zeros((B, A, A), dtype=torch.bool, device=dev)
        if cand_vis.any():
            vb, va, ve = torch.nonzero(cand_vis, as_tuple=True)
            t_obs, _, _, _ = self.map.raycast_segment_obstruction(eye[vb, va], tgt[vb, ve])
            vis_mat[vb, va, ve] = t_obs > 1.0

        # Update last_seen_pair and push sightings into memory / ally radio
        self.last_seen_pair = torch.where(vis_mat, self.sim_time[:, None, None], self.last_seen_pair)

        # Priority score for visible enemy slots (lower = higher priority)
        prio = dist_p * (0.65 + 0.35 * (self.hp[:, None, :] / 100.0))
        prio = torch.where(vis_mat, prio, torch.full_like(prio, 1e6))
        k_vis = min(3, self.team_size)
        top_p, top_e = torch.topk(prio, k=k_vis, dim=-1, largest=False)  # [B, A, k_vis]

        self.vis_valid.zero_()
        self.vis_pos.zero_()
        self.vis_vel.zero_()
        self.vis_dist.fill_(99.0)

        ar_b = torch.arange(B, device=dev)[:, None]
        ar_a = torch.arange(A, device=dev)[None, :]
        for k in range(k_vis):
            e_id = top_e[:, :, k]  # [B, A]
            valid = top_p[:, :, k] < 1e5
            self.vis_valid[:, :, k] = valid

            ex = self.x[ar_b, e_id]
            ey_t = tgt[ar_b, e_id, 1]
            ez = self.z[ar_b, e_id]
            evx = self.vx[ar_b, e_id]
            evy = self.vy[ar_b, e_id]
            evz = self.vz[ar_b, e_id]
            ecrouch = self.crouch[ar_b, e_id]
            eground = self.on_ground[ar_b, e_id].float()
            eyaw = self.yaw[ar_b, e_id]
            earmor = torch.clamp((self.shield[ar_b, e_id] + self.baizer[ar_b, e_id]) / 125.0, 0.0, 1.0)
            eflash = (self.flash[ar_b, e_id] > 0.005).float()
            ereload = (self.reload_t[ar_b, e_id] > 0.0).float()

            self.vis_pos[:, :, k, 0] = ex
            self.vis_pos[:, :, k, 1] = ey_t
            self.vis_pos[:, :, k, 2] = ez
            self.vis_vel[:, :, k, 0] = evx
            self.vis_vel[:, :, k, 1] = evy
            self.vis_vel[:, :, k, 2] = evz

            ddx = ex - self.x
            ddz = ez - self.z
            hd = torch.clamp(torch.hypot(ddx, ddz), min=1e-4)
            self.vis_dist[:, :, k] = torch.where(valid, hd, torch.full_like(hd, 99.0))
            ry = angle_diff(torch.atan2(ddx, -ddz), self.yaw)
            rp = torch.atan2(ey_t - eye[:, :, 1], hd) - self.pitch

            rel_vx_loc = evx * cy + evz * sy
            rel_vz_loc = evx * sy - evz * cy
            e_face = (torch.sin(eyaw) * (-ddx) - torch.cos(eyaw) * (-ddz)) / hd

            vf = valid.float()
            base = 59 + k * 14
            obs[:, :, base + 0] = vf
            obs[:, :, base + 1] = torch.sin(ry) * vf
            obs[:, :, base + 2] = torch.cos(ry) * vf
            obs[:, :, base + 3] = torch.clamp(rp / 1.2, -1.0, 1.0) * vf
            obs[:, :, base + 4] = torch.clamp(hd / MAX_VISION_RANGE, 0.0, 1.0) * vf
            obs[:, :, base + 5] = (1.0 / (1.0 + hd / 12.0)) * vf
            obs[:, :, base + 6] = torch.clamp(rel_vx_loc / 7.0, -1.0, 1.0) * vf
            obs[:, :, base + 7] = torch.clamp(rel_vz_loc / 7.0, -1.0, 1.0) * vf
            obs[:, :, base + 8] = ecrouch * vf
            obs[:, :, base + 9] = eground * vf
            obs[:, :, base + 10] = e_face * vf
            obs[:, :, base + 11] = earmor * vf
            obs[:, :, base + 12] = eflash * vf
            obs[:, :, base + 13] = ereload * vf

            # Persist primary sighting into fair-play visual memory + share with teammates (radio!)
            if k == 0 and valid.any():
                sb, sa = torch.nonzero(valid, as_tuple=True)
                self._record_memory(sb, sa, ex[sb, sa], ey_t[sb, sa], ez[sb, sa], kind=1)
                # Share primary sighting to teammates who don't currently see an enemy
                if self.team_size > 1:
                    s_team = self.team_id[sa]
                    # Broadcast to teammates in same arena
                    for offset in range(1, self.team_size):
                        mate_a = torch.where(
                            s_team == 0,
                            (sa + offset) % self.team_size,
                            self.team_size + ((sa - self.team_size + offset) % self.team_size),
                        )
                        mate_ok = self.alive[sb, mate_a] & (~self.vis_valid[sb, mate_a, 0])
                        if mate_ok.any():
                            mb = sb[mate_ok]
                            ma = mate_a[mate_ok]
                            # Only update radio memory every ~0.35s so it's realistic fair-play radio
                            old_enough = (self.sim_time[mb] - self.mem_t[mb, ma, 0]) > RADIO_DELAY
                            if old_enough.any():
                                self._record_memory(
                                    mb[old_enough], ma[old_enough],
                                    ex[sb[mate_ok][old_enough], sa[mate_ok][old_enough]],
                                    ey_t[sb[mate_ok][old_enough], sa[mate_ok][old_enough]],
                                    ez[sb[mate_ok][old_enough], sa[mate_ok][old_enough]],
                                    kind=3,
                                )

        # ---- Block D: Fair-Play Memory / Acoustic / Radio Contacts (101..118, 2 x 9) ----
        self.mem_valid.zero_()
        self.mem_pos_cur.zero_()
        for m in range(2):
            age = self.sim_time[:, None] - self.mem_t[:, :, m]
            mk = self.mem_kind[:, :, m]
            ttl = torch.where(mk == 1, MEMORY_TTL, ACOUSTIC_TTL)
            mx = self.mem_x[:, :, m]
            my = self.mem_y[:, :, m]
            mz = self.mem_z[:, :, m]
            mdx = mx - self.x
            mdz = mz - self.z
            mdist = torch.hypot(mdx, mdz)
            # Exclude memory if practically identical to currently visible primary target
            dup_vis = self.vis_valid[:, :, 0] & (torch.hypot(mx - self.vis_pos[:, :, 0, 0], mz - self.vis_pos[:, :, 0, 2]) < 3.0)
            mvalid = (mk > 0) & (age >= 0.0) & (age < ttl) & (mdist > 1.0) & (~dup_vis)
            self.mem_valid[:, :, m] = mvalid
            self.mem_pos_cur[:, :, m, 0] = mx
            self.mem_pos_cur[:, :, m, 1] = my
            self.mem_pos_cur[:, :, m, 2] = mz

            mry = angle_diff(torch.atan2(mdx, -mdz), self.yaw)
            mf = mvalid.float()
            base = 101 + m * 9
            obs[:, :, base + 0] = mf
            obs[:, :, base + 1] = torch.sin(mry) * mf
            obs[:, :, base + 2] = torch.cos(mry) * mf
            obs[:, :, base + 3] = torch.clamp(mdist / MAX_VISION_RANGE, 0.0, 1.0) * mf
            obs[:, :, base + 4] = torch.clamp(1.0 - age / MEMORY_TTL, 0.0, 1.0) * mf
            obs[:, :, base + 5] = ((mk == 1) & mvalid).float()
            obs[:, :, base + 6] = ((mk == 2) & mvalid).float()
            obs[:, :, base + 7] = ((mk == 3) & mvalid).float()
            # Wood-wallbang indicator along memory bearing (uses fast chest lidar mat on ray 0 when roughly aligned)
            obs[:, :, base + 8] = (((cm4_v[:, :, 0] == MAT_WOOD) & (mry.abs() < 0.35) & mvalid)).float()

        # ---- Block E: Teammates, BAIZER, Tankers, Incoming Shots & Match Context (119..143) ----
        if self.team_size > 1:
            ally_d = torch.where(
                self.ally_mask[None, :, :] & self.alive[:, None, :],
                dist_p,
                torch.full_like(dist_p, 1e6),
            )
            k_al = min(2, self.team_size - 1)
            top_ad, top_ai = torch.topk(ally_d, k=k_al, dim=-1, largest=False)
            for j in range(k_al):
                ai = top_ai[:, :, j]
                av = top_ad[:, :, j] < 1e5
                af = av.float()
                adx = self.x[ar_b, ai] - self.x
                adz = self.z[ar_b, ai] - self.z
                ad = torch.hypot(adx, adz)
                ary = angle_diff(torch.atan2(adx, -adz), self.yaw)
                ahp = torch.clamp(self.hp[ar_b, ai] / 100.0, 0.0, 1.0)
                acmb = (
                    ((self.sim_time[:, None] - self.last_fire_at[ar_b, ai]) < 1.5)
                    | ((self.sim_time[:, None] - self.under_fire_at[ar_b, ai]) < 1.5)
                ).float()
                base = 119 + j * 6
                obs[:, :, base + 0] = af
                obs[:, :, base + 1] = torch.sin(ary) * af
                obs[:, :, base + 2] = torch.cos(ary) * af
                obs[:, :, base + 3] = torch.clamp(ad / 80.0, 0.0, 1.0) * af
                obs[:, :, base + 4] = ahp * af
                obs[:, :, base + 5] = acmb * af

        # Nearest ready BAIZER pickup (131..134)
        bz_dx = self.map.baizer_pos[None, None, :, 0] - self.x[:, :, None]  # [B, A, 6]
        bz_dz = self.map.baizer_pos[None, None, :, 1] - self.z[:, :, None]
        bz_d = torch.hypot(bz_dx, bz_dz)
        bz_ok = (self.baizer_cd[:, None, :] <= 0.0) & (self.baizer[:, :, None] < BAIZER_MAX_STACK)
        bz_score = torch.where(bz_ok, bz_d, torch.full_like(bz_d, 1e6))
        bz_min, bz_idx = bz_score.min(dim=-1)
        bz_v = (bz_min < 1e5).float()
        bz_ry = angle_diff(torch.atan2(self.map.baizer_pos[bz_idx, 0] - self.x, -(self.map.baizer_pos[bz_idx, 1] - self.z)), self.yaw)
        obs[:, :, 131] = bz_v
        obs[:, :, 132] = torch.sin(bz_ry) * bz_v
        obs[:, :, 133] = torch.cos(bz_ry) * bz_v
        obs[:, :, 134] = torch.clamp(bz_min / 60.0, 0.0, 1.0) * bz_v

        # Nearest ready Tanker resupply (135..138)
        tk_dx = self.map.tanker_pos[None, None, :, 0] - self.x[:, :, None]  # [B, A, 3]
        tk_dz = self.map.tanker_pos[None, None, :, 1] - self.z[:, :, None]
        tk_d = torch.hypot(tk_dx, tk_dz)
        tk_ok = self.tanker_cd[:, None, :] <= 0.0
        tk_score = torch.where(tk_ok, tk_d, torch.full_like(tk_d, 1e6))
        tk_min, tk_idx = tk_score.min(dim=-1)
        tk_v = (tk_min < 1e5).float()
        tk_ry = angle_diff(torch.atan2(self.map.tanker_pos[tk_idx, 0] - self.x, -(self.map.tanker_pos[tk_idx, 1] - self.z)), self.yaw)
        obs[:, :, 135] = tk_v
        obs[:, :, 136] = torch.sin(tk_ry) * tk_v
        obs[:, :, 137] = torch.cos(tk_ry) * tk_v
        obs[:, :, 138] = torch.clamp(tk_min / 80.0, 0.0, 1.0) * tk_v

        # Fair-Play Visible Incoming Projectile Warning (139..141)
        if self.shot_alive.any():
            # [B, A, S]
            sdx = self.x[:, :, None] - self.shot_pos[:, None, :, 0]
            sdz = self.z[:, :, None] - self.shot_pos[:, None, :, 2]
            sdist = torch.hypot(sdx, sdz)
            s_vx = self.shot_dir[:, None, :, 0]
            s_vz = self.shot_dir[:, None, :, 2]
            proj = sdx * s_vx + sdz * s_vz  # >0 means heading toward actor
            perp = (sdx * s_vz - sdz * s_vx).abs()
            threat_shot = (
                self.shot_alive[:, None, :]
                & (self.shot_team[:, None, :] != self.team_id[None, :, None])
                & (self.shot_age[:, None, :] >= INCOMING_MIN_AGE)
                & (sdist < INCOMING_RANGE)
                & (sdist > 1.5)
                & (proj > 0.0)
                & (perp < 2.1)
            )
            ts_d = torch.where(threat_shot, sdist, torch.full_like(sdist, 1e6))
            ts_min, ts_i = ts_d.min(dim=-1)
            has_inc = (ts_min < 1e5).float()
            # Perpendicular escape vector in world XZ -> local frame
            svx_c = self.shot_dir[ar_b, ts_i, 0]
            svz_c = self.shot_dir[ar_b, ts_i, 2]
            # Escape toward side opposite to bullet offset
            side_sign = torch.where((self.x - self.shot_pos[ar_b, ts_i, 0]) * svz_c - (self.z - self.shot_pos[ar_b, ts_i, 2]) * svx_c >= 0.0, 1.0, -1.0)
            esc_wx = svz_c * side_sign
            esc_wz = -svx_c * side_sign
            obs[:, :, 139] = has_inc
            obs[:, :, 140] = (esc_wx * cy + esc_wz * sy) * has_inc
            obs[:, :, 141] = (esc_wx * sy - esc_wz * cy) * has_inc

        # Match & Squad Balance (142..143)
        alive_t0 = (self.alive[:, : self.team_size]).float().sum(dim=-1, keepdim=True)
        alive_t1 = (self.alive[:, self.team_size :]).float().sum(dim=-1, keepdim=True)
        alive_diff = torch.where(self.team_id[None, :] == 0, alive_t0 - alive_t1, alive_t1 - alive_t0)
        sc_diff = torch.where(self.team_id[None, :] == 0, self.scores[:, 0:1] - self.scores[:, 1:2], self.scores[:, 1:2] - self.scores[:, 0:1])
        obs[:, :, 142] = torch.clamp(alive_diff / 5.0, -1.0, 1.0)
        obs[:, :, 143] = torch.clamp(sc_diff / 10.0, -1.0, 1.0)

        # ---- Privileged Centralized Critic State [B, A, 64] + Aux Targets [B, A, 4] ----
        self._compute_critic_and_aux(dist_p, rel_yaw_p, vis_mat)

    def _compute_critic_and_aux(
        self,
        dist_p: torch.Tensor,
        rel_yaw_p: torch.Tensor,
        vis_mat: torch.Tensor,
    ) -> None:
        """Privileged global state for CTDE MAPPO Critic ONLY (NEVER passed to RNV1Actor!)."""
        B, A = self.B, self.A
        g = self.last_global
        g.zero_()
        ar_b = torch.arange(B, device=self.device)[:, None]

        # True distances & bearings to up to 5 enemies (5 x 8 = 40 dims)
        e_d = torch.where(self.enemy_mask[None, :, :] & self.alive[:, None, :], dist_p, torch.full_like(dist_p, 1e6))
        k_e = min(5, self.team_size)
        top_ed, top_ei = torch.topk(e_d, k=k_e, dim=-1, largest=False)
        for k in range(k_e):
            ei = top_ei[:, :, k]
            ev = (top_ed[:, :, k] < 1e5).float()
            edx = self.x[ar_b, ei] - self.x
            edz = self.z[ar_b, ei] - self.z
            ery = angle_diff(torch.atan2(edx, -edz), self.yaw)
            base = k * 8
            g[:, :, base + 0] = ev
            g[:, :, base + 1] = torch.clamp(top_ed[:, :, k] / 120.0, 0.0, 1.0) * ev
            g[:, :, base + 2] = torch.sin(ery) * ev
            g[:, :, base + 3] = torch.cos(ery) * ev
            g[:, :, base + 4] = torch.clamp(self.hp[ar_b, ei] / 100.0, 0.0, 1.0) * ev
            g[:, :, base + 5] = torch.clamp((self.shield[ar_b, ei] + self.baizer[ar_b, ei]) / 125.0, 0.0, 1.0) * ev
            g[:, :, base + 6] = (self.shaffer_t[ar_b, ei] > 0.0).float() * ev
            g[:, :, base + 7] = vis_mat[ar_b, torch.arange(A, device=self.device)[None, :], ei].float()

        # Global team totals & episode progress (indices 40..63)
        t0_hp = (self.hp[:, : self.team_size] * self.alive[:, : self.team_size].float()).sum(dim=-1, keepdim=True) / (100.0 * self.team_size)
        t1_hp = (self.hp[:, self.team_size :] * self.alive[:, self.team_size :].float()).sum(dim=-1, keepdim=True) / (100.0 * self.team_size)
        g[:, :, 40] = torch.where(self.team_id[None, :] == 0, t0_hp, t1_hp)
        g[:, :, 41] = torch.where(self.team_id[None, :] == 0, t1_hp, t0_hp)
        g[:, :, 42] = self.step_count[:, None].float() / float(self.max_steps)
        g[:, :, 43] = torch.clamp(self.scores[:, 0:1] / 15.0, 0.0, 1.0)
        g[:, :, 44] = torch.clamp(self.scores[:, 1:2] / 15.0, 0.0, 1.0)
        # How many enemies currently have direct LOS on me (true exposure risk!)
        enemy_sees_me = (vis_mat.transpose(1, 2)).float().sum(dim=-1)
        g[:, :, 45] = torch.clamp(enemy_sees_me / 3.0, 0.0, 1.0)
        g[:, :, 46] = (self.vis_valid.any(dim=-1)).float()
        g[:, :, 47] = self.shaping_scale

        # Auxiliary self-supervised targets [B, A, 4] for GRU representation enrichment:
        min_ed = top_ed[:, :, 0]
        self.last_aux[:, :, 0] = torch.clamp(min_ed / 90.0, 0.0, 1.0)
        self.last_aux[:, :, 1] = (min_ed < 22.0).float()
        self.last_aux[:, :, 2] = (enemy_sees_me > 0.5).float()
        # Flank opportunity: closest enemy's back/side is turned toward us
        e0 = top_ei[:, :, 0]
        e0_yaw = self.yaw[ar_b, e0]
        to_me_x = self.x - self.x[ar_b, e0]
        to_me_z = self.z - self.z[ar_b, e0]
        f_dot = (torch.sin(e0_yaw) * to_me_x - torch.cos(e0_yaw) * to_me_z) / torch.clamp(torch.hypot(to_me_x, to_me_z), min=1e-4)
        self.last_aux[:, :, 3] = ((top_ed[:, :, 0] < 45.0) & (f_dot < 0.0)).float()

    def step(
        self,
        actions: Dict[str, torch.Tensor],
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, Dict[str, float]]:
        """Step all B arenas by 1 policy tick (0.05s = 3 x 1/60s substeps).

        Args:
            actions: dict with tensors shaped [B, A, ...]
                cont: [B, A, 5] in [-1, 1] -> [fwd, side, yawCmd, pitchCmd, leanCmd]
                aim:  [B, A]    long in 0..5 -> [FREE, VIS0, VIS1, VIS2, MEM0, MEM1]
                bin:  [B, A, 5] float 0/1  -> [fire, sprint, crouch, jump, reload]
                util: [B, A]    long in 0..2 -> [NONE, SMOKE, SKILL]

        Returns:
            obs:         [B, A, 144]
            global_st:   [B, A, 64]
            rewards:     [B, A]
            dones:       [B] (episode timeout/score-cap reset mask)
            info:        scalar stats dict
        """
        B, A = self.B, self.A
        dev = self.device
        rew = torch.zeros((B, A), dtype=torch.float32, device=dev)

        a_cont = torch.clamp(actions["cont"].float(), -1.0, 1.0)
        a_aim = actions["aim"].long()
        a_bin = actions["bin"].float() > 0.5
        a_util = actions["util"].long()

        cmd_fwd = a_cont[:, :, 0]
        cmd_side = a_cont[:, :, 1]
        cmd_yaw = a_cont[:, :, 2]
        cmd_pitch = a_cont[:, :, 3]
        cmd_lean = a_cont[:, :, 4] * 0.32

        want_fire = a_bin[:, :, 0]
        want_sprint = a_bin[:, :, 1]
        want_crouch = a_bin[:, :, 2]
        want_jump = a_bin[:, :, 3]
        want_reload = a_bin[:, :, 4]

        # ---- Utility actions (Smoke / Skill) ----
        want_smoke = (a_util == 1) & self.alive & (self.smoke_cd <= 0.01)
        if want_smoke.any():
            sb, sa = torch.nonzero(want_smoke, as_tuple=True)
            sx = torch.clamp(self.x[sb, sa] + torch.sin(self.yaw[sb, sa]) * 3.2, -24.0, 24.0)
            sz = torch.clamp(self.z[sb, sa] - torch.cos(self.yaw[sb, sa]) * 3.2, -98.0, 98.0)
            sm_slot = self.smoke_ptr[sb] % self.MAX_SMOKES
            self.smoke_ptr[sb] = (self.smoke_ptr[sb] + 1) % self.MAX_SMOKES
            self.smoke_x[sb, sm_slot] = sx
            self.smoke_z[sb, sm_slot] = sz
            self.smoke_life[sb, sm_slot] = SMOKE_DURATION
            self.smoke_cd[sb, sa] = SMOKE_COOLDOWN
            # Smart defensive smoke reward when under fire or low HP
            smart_sm = (self.hp[sb, sa] < 65.0) | ((self.sim_time[sb] - self.under_fire_at[sb, sa]) < 1.5)
            rew[sb, sa] += torch.where(smart_sm, 0.14 * self.shaping_scale, -0.02)

        if self.enable_skills:
            want_skill = (a_util == 2) & self.alive & (self.skill_charges > 0)
            if want_skill.any():
                # Heal skill
                use_heal = want_skill & self.skill_is_heal & (self.hp < 99.0)
                if use_heal.any():
                    healed = 100.0 - self.hp[use_heal]
                    self.hp[use_heal] = 100.0
                    self.skill_charges[use_heal] -= 1
                    rew[use_heal] += torch.clamp(healed / 100.0, 0.0, 1.0) * 0.45
                # Shaffer cloak skill
                use_shaf = want_skill & (~self.skill_is_heal) & (self.shaffer_t <= 0.0)
                if use_shaf.any():
                    self.shaffer_t[use_shaf] = SHAFFER_DURATION
                    self.skill_charges[use_shaf] -= 1
                    rew[use_shaf] += 0.25

        # ---- Manual reload ----
        w = self.weapon_id
        can_manual_rel = want_reload & self.alive & (self.reload_t <= 0.0) & (self.burst_left == 0) & (self.mag < self.w_cap[w]) & (self.stock > 0.0)
        if can_manual_rel.any():
            self.reload_t = torch.where(can_manual_rel, self.w_reload[w], self.reload_t)
            # Mild penalty for reloading while >70% full in front of an enemy
            bad_rel = can_manual_rel & (self.mag > self.w_cap[w] * 0.70) & self.vis_valid[:, :, 0]
            rew -= bad_rel.float() * 0.06

        # ---- Precompute target desired aim angle for TRACK_VIS / PREAIM_MEM ----
        eye, _, _, _ = self._body_center_and_eye()
        desired_yaw = self.yaw.clone()
        desired_pitch = torch.clamp(cmd_pitch * 0.55, -MAX_PITCH, MAX_PITCH)
        using_target_slew = torch.zeros((B, A), dtype=torch.bool, device=dev)

        for slot_i in range(3):
            sel = (a_aim == (slot_i + 1)) & self.vis_valid[:, :, slot_i]
            if sel.any():
                tpos = self.vis_pos[:, :, slot_i]
                tvel = self.vis_vel[:, :, slot_i]
                dist = self.vis_dist[:, :, slot_i]
                lead_t = torch.clamp(dist / self.w_spd[w], 0.0, 0.45)
                px = tpos[:, :, 0] + tvel[:, :, 0] * lead_t - self.x
                py = tpos[:, :, 1] + tvel[:, :, 1] * lead_t * 0.5 - eye[:, :, 1]
                pz = tpos[:, :, 2] + tvel[:, :, 2] * lead_t - self.z
                base_y = torch.atan2(px, -pz)
                base_p = torch.atan2(py, torch.clamp(torch.hypot(px, pz), min=0.25))
                desired_yaw = torch.where(sel, base_y + cmd_yaw * VIS_RESIDUAL_YAW, desired_yaw)
                desired_pitch = torch.where(sel, torch.clamp(base_p + cmd_pitch * VIS_RESIDUAL_PITCH, -MAX_PITCH, MAX_PITCH), desired_pitch)
                using_target_slew = using_target_slew | sel

        for mem_i in range(2):
            sel = (a_aim == (mem_i + 4)) & self.mem_valid[:, :, mem_i]
            if sel.any():
                mpos = self.mem_pos_cur[:, :, mem_i]
                px = mpos[:, :, 0] - self.x
                py = mpos[:, :, 1] - eye[:, :, 1]
                pz = mpos[:, :, 2] - self.z
                base_y = torch.atan2(px, -pz)
                base_p = torch.atan2(py, torch.clamp(torch.hypot(px, pz), min=0.25))
                desired_yaw = torch.where(sel, base_y + cmd_yaw * MEM_RESIDUAL_YAW, desired_yaw)
                desired_pitch = torch.where(sel, torch.clamp(base_p + cmd_pitch * MEM_RESIDUAL_PITCH, -MAX_PITCH, MAX_PITCH), desired_pitch)
                using_target_slew = using_target_slew | sel

        free_yaw_rate = nonlin_turn(cmd_yaw) * MAX_FREE_YAW_RATE

        # ---- 3x 60 Hz Physics Substeps ----
        for sub_i in range(SIM_SUBSTEPS):
            dt = SUBSTEP_DT
            self.sim_time += dt

            # Respawn timers
            dead = ~self.alive
            if dead.any():
                self.respawn = torch.where(dead, self.respawn - dt, self.respawn)
                ready_sp = dead & (self.respawn <= 1e-6)
                if ready_sp.any():
                    self._respawn_dead_actors(ready_sp)

            al = self.alive
            # Timers decay
            self.flash = torch.clamp(self.flash - dt, min=0.0)
            self.cooldown = torch.clamp(self.cooldown - dt, min=0.0)
            self.smoke_cd = torch.clamp(self.smoke_cd - dt, min=0.0)
            self.shaffer_t = torch.clamp(self.shaffer_t - dt, min=0.0)
            self.jump_cd = torch.clamp(self.jump_cd - dt, min=0.0)
            self.smoke_life = torch.clamp(self.smoke_life - dt, min=0.0)
            self.tanker_cd = torch.clamp(self.tanker_cd - dt, min=0.0)
            self.baizer_cd = torch.clamp(self.baizer_cd - dt, min=0.0)

            # Shield regen (1 per 5s up to 25)
            need_sh = al & (self.shield < BASE_SHIELD_MAX)
            self.shield_clock = torch.where(need_sh, self.shield_clock + dt, torch.zeros_like(self.shield_clock))
            sh_tick = need_sh & (self.shield_clock >= 5.0)
            if sh_tick.any():
                self.shield = torch.where(sh_tick, torch.clamp(self.shield + 1.0, max=BASE_SHIELD_MAX), self.shield)
                self.shield_clock = torch.where(sh_tick, self.shield_clock - 5.0, self.shield_clock)

            # Stock regen
            need_st = al & (self.stock < self.w_stock_cap[w])
            self.ammo_clock = torch.where(need_st, self.ammo_clock + dt * self.w_stock_regen[w] * self.ammo_rate, torch.zeros_like(self.ammo_clock))
            st_tick = need_st & (self.ammo_clock >= 1.0)
            if st_tick.any():
                gain = torch.floor(self.ammo_clock)
                self.stock = torch.where(st_tick, torch.minimum(self.w_stock_cap[w], self.stock + gain), self.stock)
                self.ammo_clock = torch.where(st_tick, self.ammo_clock - gain, self.ammo_clock)

            # Auto-reload when mag == 0 & reload completion
            auto_rel = al & (self.mag <= 0.0) & (self.burst_left == 0) & (self.reload_t <= 0.0) & (self.stock > 0.0)
            if auto_rel.any():
                self.reload_t = torch.where(auto_rel, self.w_reload[w], self.reload_t)
            reloading = al & (self.reload_t > 0.0)
            if reloading.any():
                self.reload_t = torch.where(reloading, self.reload_t - dt, self.reload_t)
                done_rel = reloading & (self.reload_t <= 1e-6)
                if done_rel.any():
                    take = torch.minimum(self.w_cap[w] - self.mag, self.stock)
                    self.stock = torch.where(done_rel, self.stock - take, self.stock)
                    self.mag = torch.where(done_rel, self.mag + take, self.mag)
                    self.reload_t = torch.where(done_rel, torch.zeros_like(self.reload_t), self.reload_t)

            # Aim slewing (bounded physical angular velocity!)
            max_dy = MAX_TRACK_YAW_RATE * dt
            max_dp = MAX_TRACK_PITCH_RATE * dt
            dy_track = torch.clamp(angle_diff(desired_yaw, self.yaw), -max_dy, max_dy)
            new_yaw = torch.where(using_target_slew, self.yaw + dy_track, self.yaw + free_yaw_rate * dt)
            new_yaw = torch.atan2(torch.sin(new_yaw), torch.cos(new_yaw))
            dp = torch.clamp(desired_pitch - self.pitch, -max_dp, max_dp)
            self.yaw = torch.where(al, new_yaw, self.yaw)
            self.pitch = torch.where(al, torch.clamp(self.pitch + dp, -MAX_PITCH, MAX_PITCH), self.pitch)

            # Posture smoothing (matches dist/js/posture.js `postureStep`)
            k_p = 1.0 - math.exp(-7.0 * dt)
            crouch_t = (want_crouch & self.on_ground).float()
            ads_t = (using_target_slew & (~want_sprint)).float()
            self.crouch = torch.where(al, self.crouch + (crouch_t - self.crouch) * k_p, self.crouch)
            self.lean = torch.where(al, self.lean + (cmd_lean - self.lean) * k_p, self.lean)
            self.aim_pose = torch.where(al, self.aim_pose + (ads_t - self.aim_pose) * k_p, self.aim_pose)

            # Kinematics & exact Harbor obstacle sliding (matches dist/js/match.js + yard.js)
            sy = torch.sin(self.yaw)
            cy = torch.cos(self.yaw)
            norm = torch.clamp(torch.hypot(cmd_fwd, cmd_side), min=1.0)
            sprinting = want_sprint & (~want_fire) & (self.crouch < 0.25)
            spd = torch.where(sprinting, SPRINT_SPEED, WALK_SPEED) * (1.0 - self.crouch * CROUCH_SPEED_LOSS) * (1.0 - self.aim_pose * 0.14)
            tvx = (cy * cmd_side + sy * cmd_fwd) / norm * spd
            tvz = (sy * cmd_side - cy * cmd_fwd) / norm * spd
            k_v = torch.where(self.on_ground, 1.0 - math.exp(-14.0 * dt), 1.0 - math.exp(-4.5 * dt))
            self.vx = torch.where(al, self.vx + (tvx - self.vx) * k_v, torch.zeros_like(self.vx))
            self.vz = torch.where(al, self.vz + (tvz - self.vz) * k_v, torch.zeros_like(self.vz))

            nx, nz, nvx, nvz = self.map.move_actors(self.x, self.y, self.z, self.vx, self.vz, self.vx * dt, self.vz * dt, ACTOR_RADIUS)
            self.x = torch.where(al, nx, self.x)
            self.z = torch.where(al, nz, self.z)
            self.vx = torch.where(al, nvx, self.vx)
            self.vz = torch.where(al, nvz, self.vz)

            # Jump & Vertical Gravity (exact match to dist/js/posture.js `vertical`)
            do_jump = al & want_jump & self.on_ground & (self.jump_cd <= 0.0) & (sub_i == 0)
            self.vy = torch.where(do_jump, torch.full_like(self.vy, JUMP_VY), self.vy)
            self.on_ground = torch.where(do_jump, torch.zeros_like(self.on_ground), self.on_ground)
            self.jump_cd = torch.where(do_jump, torch.full_like(self.jump_cd, 0.75), self.jump_cd)

            old_y = self.y
            self.vy = torch.where(al, self.vy - GRAVITY * dt, torch.zeros_like(self.vy))
            next_y = old_y + self.vy * dt
            fl = torch.where(self.vy <= 0.0, self.map.floor_at(self.x, self.z, old_y), torch.full_like(old_y, -1e4))
            landed = next_y <= fl
            self.y = torch.where(al, torch.where(landed, fl, next_y), self.y)
            self.vy = torch.where(al & landed, torch.zeros_like(self.vy), self.vy)
            self.on_ground = torch.where(al, landed, self.on_ground)

            # Burst continuation & new trigger pulls
            cont_burst = al & (self.burst_left > 0) & (self.reload_t <= 0.0)
            if cont_burst.any():
                self.next_burst = torch.where(cont_burst, self.next_burst - dt, self.next_burst)
                fire_burst = cont_burst & (self.next_burst <= 1e-6)
                if fire_burst.any():
                    self._spawn_shots(fire_burst)
                    self.burst_left = torch.where(fire_burst, torch.clamp(self.burst_left - 1, min=0), self.burst_left)
                    self.next_burst = torch.where(fire_burst, self.next_burst + self.w_int[w], self.next_burst)

            can_trig = al & want_fire & (self.cooldown <= 1e-6) & (self.reload_t <= 0.0) & (self.burst_left == 0) & (self.mag > 0.0)
            if can_trig.any():
                self._spawn_shots(can_trig)
                rem_b = torch.clamp(torch.minimum(self.w_burst[w], self.mag.long() + 1) - 1, min=0)
                self.burst_left = torch.where(can_trig, rem_b, self.burst_left)
                self.next_burst = torch.where(can_trig, self.w_int[w], self.next_burst)

            # Advance projectiles + resolve damage/kills/ricochets/wallbangs
            self._step_projectiles(dt, rew)

        # ---- BAIZER & Tanker Pickups ----
        # BAIZER pickups [B, A, 6]
        bz_d = torch.hypot(self.x[:, :, None] - self.map.baizer_pos[None, None, :, 0], self.z[:, :, None] - self.map.baizer_pos[None, None, :, 1])
        bz_pick = (self.baizer_cd[:, None, :] <= 0.0) & self.alive[:, :, None] & (self.y[:, :, None] <= 1.2) & (self.baizer[:, :, None] < BAIZER_MAX_STACK) & (bz_d <= 1.95)
        if bz_pick.any():
            # Pick first actor per pickup in each arena
            for p_i in range(6):
                pm = bz_pick[:, :, p_i]  # [B, A]
                has_p = pm.any(dim=-1)
                if has_p.any():
                    pb = torch.nonzero(has_p, as_tuple=False).squeeze(-1)
                    pa = pm[pb].float().argmax(dim=-1)
                    before = self.baizer[pb, pa]
                    after = torch.clamp(before + self.map.baizer_amt[p_i], max=BAIZER_MAX_STACK)
                    gained = after - before
                    self.baizer[pb, pa] = after
                    self.baizer_cd[pb, p_i] = 24.0
                    rew[pb, pa] += (gained / 40.0) * 0.35

        # Tanker resupply [B, A, 3]
        tk_d = torch.hypot(self.x[:, :, None] - self.map.tanker_pos[None, None, :, 0], self.z[:, :, None] - self.map.tanker_pos[None, None, :, 1])
        tk_pick = (self.tanker_cd[:, None, :] <= 0.0) & self.alive[:, :, None] & (self.y[:, :, None] <= 1.2) & (tk_d <= self.map.tanker_rad[None, None, :])
        if tk_pick.any():
            for t_i in range(3):
                tm = tk_pick[:, :, t_i]
                has_t = tm.any(dim=-1)
                if has_t.any():
                    tb = torch.nonzero(has_t, as_tuple=False).squeeze(-1)
                    ta = tm[tb].float().argmax(dim=-1)
                    needed = (self.stock[tb, ta] < 70.0) | (self.ammo_rate[tb, ta] < 1.4)
                    self.stock[tb, ta] += 100.0
                    self.ammo_rate[tb, ta] = 1.5
                    self.tanker_cd[tb, t_i] = 25.0
                    rew[tb, ta] += torch.where(needed, 0.25, 0.05)

        # ---- Refresh Observations BEFORE Shaping & Episode Termination ----
        self._compute_observations()

        # ---- Annealed Stage-1/2 Dense Tactical Shaping (fades smoothly to near-0 in Stage 3!) ----
        if self.shaping_scale > 0.01:
            sh = self.shaping_scale
            al_f = self.alive.float()
            # 1. Anti-camping / active map exploration & lane advancement when no enemy visible
            moved_step = torch.hypot(self.x - self.prev_x, self.z - self.prev_z)
            # Potential-based closing distance to nearest alive enemy (breaks initial 160m exploration deadlock!)
            min_ed = self.last_aux[:, :, 0] * 90.0
            delta_d = torch.clamp(self.prev_min_enemy_dist - min_ed, -1.5, 1.5)
            no_vis = (~self.vis_valid[:, :, 0]) & self.alive
            rew += torch.where(no_vis & (min_ed > 18.0), delta_d * 0.014 * sh, torch.zeros_like(rew))
            # Mild anti-wall-stuck nudge
            rew += torch.where(no_vis & (moved_step < 0.04), torch.full_like(rew, -0.004 * sh), torch.zeros_like(rew))

            # 2. Fair-play visual crosshair alignment, target-lock & aligned-fire shaping (accelerates from-scratch aim 10x!)
            has_v0 = self.vis_valid[:, :, 0] & self.alive
            if has_v0.any():
                # cos(relYaw) is obs[..., 61] in [-1, 1]
                align = torch.clamp(self.last_obs[:, :, 61], 0.0, 1.0)
                rew += torch.where(has_v0, (align ** 4) * 0.015 * sh, torch.zeros_like(rew))
                # Reward engaging target tracking (aimMode in 1..3) and pulling trigger while aligned
                locked_vis = (a_aim >= 1) & (a_aim <= 3)
                rew += torch.where(has_v0 & locked_vis, torch.full_like(rew, 0.018 * sh), torch.zeros_like(rew))
                aligned_fire = has_v0 & want_fire & (align > 0.94)
                rew += torch.where(aligned_fire, torch.full_like(rew, 0.030 * sh), torch.zeros_like(rew))
                # Cover-use combat bonus (peeking/leaning near cover while fighting!)
                in_cov = (self.last_obs[:, :, 57] > 0.5) & ((self.crouch > 0.2) | (self.lean.abs() > 0.1))
                rew += torch.where(has_v0 & in_cov, torch.full_like(rew, 0.008 * sh), torch.zeros_like(rew))

            # 3. Trigger discipline: tiny penalty for firing blindly into nothing with no visible/memory target
            blind_fire = want_fire & self.alive & (~self.vis_valid[:, :, 0]) & (~self.mem_valid[:, :, 0])
            rew -= blind_fire.float() * (0.008 * sh)

            self.prev_min_enemy_dist = torch.where(self.alive, min_ed, self.prev_min_enemy_dist)

        self.prev_x.copy_(self.x)
        self.prev_z.copy_(self.z)

        # ---- Episode Termination (Win Goal or Time Limit) ----
        self.step_count += 1
        win_goal = float(self.team_size * 5)  # exact Result default: team_size * 5 kills!
        t0_won = self.scores[:, 0] >= win_goal
        t1_won = self.scores[:, 1] >= win_goal
        timeout = self.step_count >= self.max_steps
        dones = t0_won | t1_won | timeout

        # Accumulate exact 50/50 side-balanced learner delta combat metrics purely on GPU (zero CUDA syncs!)
        ts = self.team_size
        half = B // 2
        if half > 0 and half < B:
            k_cur = torch.cat([self.kills[:half, :ts], self.kills[half:, ts:]], dim=0)
            d_cur = torch.cat([self.deaths[:half, :ts], self.deaths[half:, ts:]], dim=0)
            sh_cur = torch.cat([self.shots_fired[:half, :ts], self.shots_fired[half:, ts:]], dim=0)
            ht_cur = torch.cat([self.shots_hit[:half, :ts], self.shots_hit[half:, ts:]], dim=0)
            dmg_cur = torch.cat([self.dmg_dealt[:half, :ts], self.dmg_dealt[half:, ts:]], dim=0)
        else:
            k_cur = self.kills[:, :ts]
            d_cur = self.deaths[:, :ts]
            sh_cur = self.shots_fired[:, :ts]
            ht_cur = self.shots_hit[:, :ts]
            dmg_cur = self.dmg_dealt[:, :ts]
        self.stat_buf[0] += (k_cur - self._prev_k).sum()
        self.stat_buf[1] += (d_cur - self._prev_d).sum()
        self.stat_buf[2] += (sh_cur - self._prev_sh).sum()
        self.stat_buf[3] += (ht_cur - self._prev_ht).sum()
        self.stat_buf[6] += (dmg_cur - self._prev_dmg).sum()
        self._prev_k.copy_(k_cur)
        self._prev_d.copy_(d_cur)
        self._prev_sh.copy_(sh_cur)
        self._prev_ht.copy_(ht_cur)
        self._prev_dmg.copy_(dmg_cur)

        if dones.any():
            d_idx = torch.nonzero(dones, as_tuple=False).squeeze(-1)
            s0 = self.scores[d_idx, 0]
            s1 = self.scores[d_idx, 1]
            win0 = (s0 > s1).float() - (s1 > s0).float()  # +1 if Team 0 won, -1 if Team 1 won, 0 draw
            team_outcome = torch.where(self.team_id[None, :] == 0, win0[:, None], -win0[:, None])
            rew[d_idx] += team_outcome * 3.0
            # Side-balanced learner win count (Team 0 on [0:half], Team 1 on [half:])
            l_won = torch.where(d_idx < half, s0 > s1, s1 > s0) if (half > 0 and half < B) else (s0 > s1)
            self.stat_buf[4] += l_won.float().sum()
            self.stat_buf[5] += float(d_idx.shape[0])
            self.reset(dones)

        return self.last_obs, self.last_global, rew, dones, {}


@torch.no_grad()
def gpu_sparring_policy(obs: torch.Tensor, rng_gen: Optional[torch.Generator] = None) -> Dict[str, torch.Tensor]:
    """Fast 100% vectorized GPU heuristic sparring opponent (fair-play only, reads ONLY 144-dim obs!).

    Provides strong combat signal from step 0 so from-scratch RNV1 agents rapidly master
    aiming, dodging, peeking, BAIZER routing, and squad fights before dominating in PFSP self-play.
    """
    shape = obs.shape[:-1]  # [B, A_sub] or [N]
    dev = obs.device

    cont = torch.zeros((*shape, ACT_CONT_DIM), dtype=torch.float32, device=dev)
    aim = torch.zeros(shape, dtype=torch.long, device=dev)
    b_act = torch.zeros((*shape, ACT_BIN_DIM), dtype=torch.float32, device=dev)
    util = torch.zeros(shape, dtype=torch.long, device=dev)

    has_v0 = obs[..., 59] > 0.5
    v0_sin = obs[..., 60]
    v0_cos = obs[..., 61]
    v0_dist = obs[..., 63] * 92.0

    has_m0 = obs[..., 101] > 0.5
    m0_sin = obs[..., 102]

    x_norm = obs[..., 0]
    z_norm = obs[..., 1]
    team_sgn = obs[..., 3]  # +1 Team 0 (advance toward -z), -1 Team 1 (advance toward +z)
    sy = obs[..., 4]
    cy = obs[..., 5]
    yaw_cur = torch.atan2(sy, cy)

    hp = obs[..., 14]
    mag = obs[..., 17]
    lidar_f = obs[..., 35]   # 0 deg chest dist / 25
    lidar_r = obs[..., 36]   # +20 deg
    lidar_l = obs[..., 37]   # -20 deg
    lidar_r45 = obs[..., 38] # +45 deg
    lidar_l45 = obs[..., 39] # -45 deg
    has_inc = obs[..., 139] > 0.5
    inc_side = obs[..., 140]
    has_bz = obs[..., 131] > 0.5
    bz_sin = obs[..., 132]
    bz_d = obs[..., 134] * 60.0

    # Aim mode: Track visible enemy 0 -> Preaim memory 0 -> Free look
    aim = torch.where(has_v0, torch.ones_like(aim), torch.where(has_m0, torch.full_like(aim, 4), aim))

    # Goal-directed territory patrol when no enemy/memory seen: advance toward central/enemy half around obstacles
    goal_z = -team_sgn * 0.42
    goal_x = -x_norm * 0.35
    goal_yaw = torch.atan2(goal_x - x_norm, -(goal_z - z_norm))
    goal_turn = torch.clamp(angle_diff(goal_yaw, yaw_cur) * 1.15, -1.0, 1.0)
    open_r = lidar_r + lidar_r45
    open_l = lidar_l + lidar_l45
    avoid_turn = torch.where(open_r > open_l, 0.92, -0.92)
    steer_nav = torch.where(lidar_f < 0.24, avoid_turn, torch.clamp(goal_turn * 0.75 + (open_r - open_l) * 0.45, -1.0, 1.0))

    turn_m = torch.clamp(m0_sin * 1.4, -1.0, 1.0)
    turn_bz = torch.clamp(bz_sin * 1.3, -1.0, 1.0)
    go_bz = (~has_v0) & (~has_m0) & has_bz & (bz_d < 22.0)

    jitter = (torch.rand(shape, generator=rng_gen, device=dev) - 0.5) * 2.0
    strafe_fight = torch.where(has_inc, inc_side, torch.sign(jitter))

    cont[..., 0] = torch.where(
        has_v0,
        torch.where(hp < 0.35, -0.85, torch.where(v0_dist > 26.0, 0.75, torch.where(v0_dist < 9.0, -0.55, 0.10))),
        torch.where(lidar_f < 0.12, -0.35, 0.95),
    )
    cont[..., 1] = torch.where(
        has_v0,
        strafe_fight * 0.82,
        torch.where(go_bz, bz_sin * 0.65, torch.where(lidar_f < 0.22, avoid_turn * 0.75, steer_nav * 0.40)),
    )
    cont[..., 2] = torch.where(
        has_v0,
        jitter * 0.12,
        torch.where(has_m0, turn_m, torch.where(go_bz, turn_bz, steer_nav)),
    )
    cont[..., 4] = torch.where(has_v0, strafe_fight * 0.55, torch.zeros_like(hp))

    # Binary actions: fire when aligned, sprint when navigating, crouch under fire or low cover, reload when low
    fire_ok = has_v0 & (v0_cos > 0.94) & (v0_sin.abs() < 0.28)
    b_act[..., 0] = fire_ok.float()
    b_act[..., 1] = ((~has_v0) & (lidar_f > 0.24)).float()
    b_act[..., 2] = ((has_v0 & (hp < 0.55)) | has_inc).float()
    b_act[..., 3] = ((~has_v0) & (lidar_f < 0.12) & (obs[..., 47] > 0.18)).float()
    b_act[..., 4] = ((~has_v0) & (mag < 0.35)).float()

    # Utility: smoke when low HP under fire, heal/shaffer when charged
    want_sm = (obs[..., 29] > 0.5) & (hp < 0.45) & (obs[..., 32] > 0.4)
    want_sk = (obs[..., 30] > 0.1) & ((hp < 0.55) | has_v0)
    util = torch.where(want_sk, torch.full_like(util, 2), torch.where(want_sm, torch.ones_like(util), util))

    return {"cont": cont, "aim": aim, "bin": b_act, "util": util}
