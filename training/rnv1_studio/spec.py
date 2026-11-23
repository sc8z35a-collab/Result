"""Canonical RNV1 specification shared bit-for-bit with dist/js/rnv1.js."""

from __future__ import annotations

import math

RNV1_VERSION = "RNV1"
RNV1_SCHEMA = 1

# Exact observation & network dimensions (multiples of 16 for A100 Tensor Cores)
OBS_DIM = 144
CRITIC_GLOBAL_DIM = 64
DEFAULT_HIDDEN_DIM = 192

# Hybrid action space dimensions
ACT_CONT_DIM = 5   # [moveFwd, moveSide, yawCmd, pitchCmd, leanCmd] in [-1, 1]
ACT_AIM_MODES = 6  # [FREE_LOOK, VIS_0, VIS_1, VIS_2, MEM_0, MEM_1]
ACT_BIN_DIM = 5    # [fire, sprint, crouch, jump, reload]
ACT_UTIL_DIM = 3   # [NONE, SMOKE, SKILL]

# Decision & physics cadences
POLICY_HZ = 20.0
POLICY_DT = 1.0 / POLICY_HZ  # 0.05 s
SIM_SUBSTEPS = 3
SUBSTEP_DT = POLICY_DT / SIM_SUBSTEPS  # 1/60 s

# Kinematics & fair-play sensory bounds (strictly matching dist/js/match.js & dist/js/rnv1.js)
WALK_SPEED = 4.68
SPRINT_SPEED = 5.85
CROUCH_SPEED_LOSS = 0.46
JUMP_VY = 5.35
GRAVITY = 14.0
BASE_SHIELD_MAX = 25.0
BAIZER_MAX_STACK = 100.0
SHAFFER_DURATION = 12.0
KILLS_PER_SKILL_CHARGE = 5
MAX_SKILL_CHARGES = 3
RESPAWN_DURATION = 3.0
SMOKE_COOLDOWN = 14.0
SMOKE_DURATION = 11.0
SMOKE_RADIUS = 5.4

# Angular slewing limits (fair human/tactical bounds — zero instant teleport snap)
MAX_FREE_YAW_RATE = 6.2     # rad/s in FREE_LOOK
MAX_TRACK_YAW_RATE = 9.5    # rad/s when tracking/pre-aiming
MAX_TRACK_PITCH_RATE = 6.8  # rad/s vertical slew
VIS_RESIDUAL_YAW = 0.14     # rad learned residual offset on TRACK_VIS
VIS_RESIDUAL_PITCH = 0.11   # rad learned vertical offset on TRACK_VIS
MEM_RESIDUAL_YAW = 0.25     # rad learned corner-lead offset on PREAIM_MEM
MEM_RESIDUAL_PITCH = 0.12
MAX_PITCH = 1.15

# Fair-play perception bounds
MAX_VISION_RANGE = 92.0
NORMAL_FOV_HALF = 1.26      # ~72 deg half-angle
TRACK_FOV_HALF = 1.65       # ~94.5 deg while actively tracking
PROXIMITY_SENSE_RANGE = 5.5
MAX_ACOUSTIC_RANGE = 48.0
MEMORY_TTL = 6.0
ACOUSTIC_TTL = 4.5
RADIO_DELAY = 0.25
INCOMING_RANGE = 24.0
INCOMING_MIN_AGE = 0.03

# Exact Lidar azimuth offsets in degrees (must match dist/js/rnv1.js exactly!)
LIDAR_CHEST_DEG = (0.0, 20.0, -20.0, 45.0, -45.0, 75.0, -75.0, 110.0, -110.0, 145.0, -145.0, 180.0)
LIDAR_LOW_DEG = (0.0, 25.0, -25.0, 55.0, -55.0, 180.0)
LIDAR_MAT_DEG = (0.0, 15.0, -15.0, 35.0)
LIDAR_MAX_DIST = 25.0

LIDAR_CHEST_RAD = tuple(math.radians(d) for d in LIDAR_CHEST_DEG)
LIDAR_LOW_RAD = tuple(math.radians(d) for d in LIDAR_LOW_DEG)
LIDAR_MAT_RAD = tuple(math.radians(d) for d in LIDAR_MAT_DEG)

# Material codes matching harbor_map & BallisticCore-X
MAT_NONE = 0
MAT_STEEL = 1
MAT_CONCRETE = 2
MAT_WOOD = 3

# Exact NPC weapon roster from dist/js/match.js & dist/js/ballistics.js
BASE_SPEED = 360.0
BASE_INTERVAL = 0.24

NPC_WEAPONS = [
    {
        "name": "SW T",
        "capacity": 10,
        "damage": 9.0,
        "speed": BASE_SPEED * 1.0,
        "interval": BASE_INTERVAL,
        "burst": 1,
        "pellets": 1,
        "reload": 1.40,
        "auto": False,
        "stockCap": 100,
        "stockRegen": 1.0,
        "woodPen": 3.0,
        "steelPen": 0.32,
        "maxRic": 2,
    },
    {
        "name": "SRA",
        "capacity": 30,
        "damage": 6.0,
        "speed": BASE_SPEED * 0.8,
        "interval": BASE_INTERVAL / 1.2,
        "burst": 1,
        "pellets": 1,
        "reload": 1.65,
        "auto": False,
        "stockCap": 100,
        "stockRegen": 1.0,
        "woodPen": 2.2,
        "steelPen": 0.18,
        "maxRic": 1,
    },
    {
        "name": "D1",
        "capacity": 40,
        "damage": 5.0,
        "speed": BASE_SPEED * 0.6,
        "interval": BASE_INTERVAL,
        "burst": 2,
        "pellets": 1,
        "reload": 1.85,
        "auto": False,
        "stockCap": 100,
        "stockRegen": 1.0,
        "woodPen": 1.7,
        "steelPen": 0.12,
        "maxRic": 1,
    },
    {
        "name": "MS10",
        "capacity": 24,
        "damage": 9.0,
        "speed": BASE_SPEED * 1.8,
        "interval": BASE_INTERVAL / 1.3,
        "burst": 1,
        "pellets": 1,
        "reload": 1.55,
        "auto": True,
        "stockCap": 100,
        "stockRegen": 1.0,
        "woodPen": 3.6,
        "steelPen": 0.44,
        "maxRic": 2,
    },
    {
        "name": "RD20",
        "capacity": 20,
        "damage": 6.0,
        "speed": BASE_SPEED * 0.7,
        "interval": BASE_INTERVAL / 1.1,
        "burst": 1,
        "pellets": 1,
        "reload": 1.55,
        "auto": True,
        "stockCap": 100,
        "stockRegen": 1.0,
        "woodPen": 1.9,
        "steelPen": 0.14,
        "maxRic": 1,
    },
    {
        "name": "RD30",
        "capacity": 80,
        "damage": 3.0,
        "speed": BASE_SPEED * 1.0,
        "interval": BASE_INTERVAL,
        "burst": 1,
        "pellets": 2,
        "reload": 1.75,
        "auto": True,
        "stockCap": 100,
        "stockRegen": 1.0,
        "woodPen": 2.4,
        "steelPen": 0.22,
        "maxRic": 2,
    },
    {
        "name": "RD 50",
        "capacity": 50,
        "damage": 7.2,
        "speed": BASE_SPEED * 0.65,
        "interval": BASE_INTERVAL / 1.1,
        "burst": 1,
        "pellets": 1,
        "reload": 1.70,
        "auto": True,
        "stockCap": 300,
        "stockRegen": 3.2,
        "woodPen": 2.35,
        "steelPen": 0.19,
        "maxRic": 1,
    },
]

NUM_WEAPONS = len(NPC_WEAPONS)
