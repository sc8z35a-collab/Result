"""Canonical NV 3 Sentient Human Architecture Specification (shared bit-for-bit with dist/js/nv3.js)."""

from __future__ import annotations

import math

NV3_VERSION = "NV 3"
NV3_SCHEMA = 1

# Structured Fair-Play Perception Dimensions (A100 Tensor Core aligned multiples of 16)
EGO_OBS_DIM = 112        # 36 kinematics/weapon + 8 emotions + 4 somatic + 16 DNA + 48 spatial/Friston/match
NUM_ENTITIES = 12        # 4 vis enemies + 3 fair-play mem/acoustic/radio + 3 allies + 1 pickup + 1 incoming hazard
ENTITY_DIM = 16
CRITIC_GLOBAL_DIM = 96   # Privileged global state for A100 CTDE Critic ONLY (never exported)

NUM_EMOTIONS = 8
NUM_SOMATIC = 4
DNA_DIM = 16
NUM_SECTORS = 6          # Harbor 6 tactical macro-sectors (SW, SE, CW, CE, NW, NE)

EMOTION_NAMES = (
    "composure",            # 冷静・平常心
    "fear_dread",           # 恐怖・危機感
    "courage_resolve",      # 勇気・覚悟（クラッチ闘志）
    "focus_flow",           # 極限集中・ゾーン
    "frustration_tilt",     # 焦り・苛立ち
    "trust_bond",           # 仲間への信頼・連帯感
    "curiosity_suspicion",  # 違和感・警戒心
    "relief_triumph",       # 安堵・達成感
)

SOMATIC_NAMES = (
    "heart_rate_norm",      # 70..185 BPM normalized
    "stamina_fatigue",      # Allostatic / sprint fatigue
    "self_vulnerability",   # Subjective exposure / killability awareness
    "ego_confidence",       # Self-efficacy from recent combat
)

DNA_NAMES = (
    "bravery", "caution", "empathy", "aggression",
    "patience", "curiosity", "tilt_resist", "flank_creativity",
    "clutch_composure", "trigger_discipline", "cover_affinity", "sound_sensitivity",
    "risk_appetite", "bait_cunning", "vocal_expressive", "rhythm_variance",
)

# Factored Hierarchical Human-Embodied Action Space
ACT_INTENT_DIM = 8
INTENT_NAMES = (
    "ENGAGE_DUEL",       # 正面交戦
    "COVER_PEEK",        # 遮蔽ピーク・様子見
    "FLANK_WRAP",        # 裏取り・側面展開
    "FALLBACK_REGROUP",  # 戦術退避・立て直し
    "SAVE_ALLY_TRADE",   # 仲間援護・トレード突入
    "AMBUSH_BAIT",       # 待ち伏せ・負傷ベイト罠
    "OBJECTIVE_RUN",     # BAIZER/タンカー確保
    "CALM_BREATH_RESET", # 深呼吸リセット（焦り・心拍鎮静）
)

ACT_SOCIAL_DIM = 6
SOCIAL_NAMES = (
    "NONE",
    "WAVE_SWING",        # 同期突入ハンドサイン + 無線
    "HOLD_TRAP",         # ベイト待機サイン + 囁き
    "POINT_CONTACT",     # 敵視認指差し + 接敵無線
    "NEED_COVER",        # リロード/負傷援護要請
    "BREATH_RESET",      # 深呼吸吐息 + 肩脱力
)

ACT_AIM_DIM = 9          # [FREE_LOOK, VIS_0..3, MEM_0..2, ALLY_GLANCE]
ACT_MOVE_DIM = 3         # [moveFwd, moveSide, leanCmd] in [-1, 1]
ACT_AIM_RES_DIM = 2      # [yawCmd, pitchCmd] in [-1, 1]
ACT_BIN_DIM = 5          # [fire, sprint, crouch, jump, reload]
ACT_UTIL_DIM = 3         # [NONE, SMOKE, SKILL]

# Canonical Callsign 16-D Human Personality DNA Archetypes (exact mirror in dist/js/nv3.js)
CALLSIGN_DNA = {
    "NAGI": [0.35, 0.55, 0.78, 0.15, 0.68, 0.62, 0.80, 0.45, 0.85, 0.82, 0.72, 0.70, 0.10, 0.65, 0.45, 0.55],
    "KAI":  [0.82, -0.15, 0.72, 0.75, -0.10, 0.58, 0.25, 0.72, 0.60, 0.35, 0.20, 0.55, 0.68, 0.30, 0.82, 0.75],
    "RIN":  [0.20, 0.65, 0.48, 0.10, 0.85, 0.75, 0.65, 0.90, 0.70, 0.88, 0.82, 0.88, 0.15, 0.92, 0.25, 0.82],
    "SORA": [0.45, 0.72, 0.85, -0.10, 0.78, 0.45, 0.92, 0.25, 0.90, 0.85, 0.90, 0.65, -0.25, 0.55, 0.55, 0.35],
    "AO":   [0.90, -0.35, 0.40, 0.88, -0.35, 0.65, -0.15, 0.60, 0.55, 0.20, 0.10, 0.50, 0.85, 0.40, 0.75, 0.88],
    "HARU": [0.55, 0.25, 0.80, 0.42, 0.40, 0.70, 0.55, 0.60, 0.68, 0.60, 0.55, 0.72, 0.35, 0.50, 0.65, 0.60],
    "MIKO": [0.40, 0.45, 0.65, 0.30, 0.58, 0.82, 0.60, 0.80, 0.62, 0.74, 0.65, 0.80, 0.28, 0.75, 0.50, 0.78],
}

# Lidar ray layouts (exact mirror in dist/js/nv3.js)
NV3_LIDAR_CHEST_DEG = tuple(i * 22.5 for i in range(16))  # 16 rays every 22.5 deg around 360 deg
NV3_LIDAR_LOW_DEG = (0.0, 30.0, -30.0, 60.0, -60.0, 120.0, -120.0, 180.0)
NV3_LIDAR_MAT_DEG = (0.0, 20.0, -20.0, 40.0)
NV3_LIDAR_CHEST_RAD = tuple(math.radians(d) for d in NV3_LIDAR_CHEST_DEG)
NV3_LIDAR_LOW_RAD = tuple(math.radians(d) for d in NV3_LIDAR_LOW_DEG)
NV3_LIDAR_MAT_RAD = tuple(math.radians(d) for d in NV3_LIDAR_MAT_DEG)
NV3_LIDAR_MAX_DIST = 25.0

# 6 Harbor macro-sector centers (SW, SE, CW, CE, NW, NE) matching NV2.5/2.6 Active Inference zones
SECTOR_CENTERS = (
    (-11.0, 56.0),
    (11.0, 56.0),
    (-11.0, 0.0),
    (11.0, 0.0),
    (-11.0, -56.0),
    (11.0, -56.0),
)

# Browser distillation core dimensions (~480k params -> ~500 KB Int8 JSON -> <0.10ms/tick @ 360Hz)
BROWSER_EGO_DIM = 192
BROWSER_ENT_DIM = 128
BROWSER_GRU_DIM = 256
BROWSER_ATTN_HEADS = 4

# A100 Omega Teacher dimensions (~3.1M params -> saturates A100 Tensor Cores in BF16!)
OMEGA_D_MODEL = 256
OMEGA_ATTN_HEADS = 4
OMEGA_ATTN_LAYERS = 2
OMEGA_GRU_DIM = 384
OMEGA_GRU_LAYERS = 2
OMEGA_CRITIC_DIM = 512
