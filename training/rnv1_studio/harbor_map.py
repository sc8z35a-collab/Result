"""Exact 50 x 200 m Harbor Range geometry matching dist/js/yard.js + GPU acceleration grids."""

from __future__ import annotations

import math
from typing import Tuple

import numpy as np
import torch

from .spec import LIDAR_MAX_DIST, MAT_CONCRETE, MAT_NONE, MAT_STEEL, MAT_WOOD

FIELD_HALF_W = 25.0
FIELD_HALF_L = 100.0
ACTOR_RADIUS = 0.40
WALK_CLAMP_X = 24.58
WALK_CLAMP_Z = 99.58

# Exact cargo containers from dist/js/yard.js: (x, z, w, d, y, color, label)
CARGO = [
    (-12, 78, 2.65, 12, 0),
    (-12, 78, 2.65, 12, 2.62),
    (-5, 71, 6.1, 2.55, 0),
    (9, 77, 3, 12.2, 0),
    (12.1, 77, 3, 12.2, 0),
    (12.1, 77, 3, 12.2, 2.62),
    (15.25, 77, 3, 12.2, 0),
    (15.25, 77, 3, 12.2, 2.62),
    (18.4, 77, 3, 12.2, 0),
    (18.4, 77, 3, 12.2, 2.62),
    (-12, 54, 6.1, 2.6, 0),
    (-7.5, 46, 2.6, 12.2, 0),
    (-7.5, 46, 2.6, 12.2, 2.62),
    (8.3, 48, 12.2, 2.65, 0),
    (8.3, 48, 12.2, 2.65, 2.62),
    (16.5, 42, 2.65, 6.1, 0),
    (-17, 26, 2.65, 6.1, 0),
    (1.7, 30, 6.1, 2.65, 0),
    (1.7, 30, 6.1, 2.65, 2.62),
    (11.4, 18, 2.65, 12.2, 0),
    (14.2, 18, 2.65, 12.2, 0),
    (14.2, 18, 2.65, 12.2, 2.62),
    (-7.8, 8, 12.2, 2.65, 0),
    (-7.8, 8, 12.2, 2.65, 2.62),
    (-15.4, -10, 2.65, 12.2, 0),
    (5.5, -8, 6.1, 2.65, 0),
    (9, -23, 12.2, 2.65, 0),
    (9, -23, 12.2, 2.65, 2.62),
    (-7, -32, 2.65, 12.2, 0),
    (-1, -42, 6.1, 2.65, 0),
    (-1, -42, 6.1, 2.65, 2.62),
    (14, -47, 2.65, 12.2, 0),
    (17, -47, 2.65, 12.2, 0),
    (17, -47, 2.65, 12.2, 2.62),
    (-11.5, -61, 12.2, 2.65, 0),
    (-11.5, -61, 12.2, 2.65, 2.62),
    (5.3, -65, 2.65, 6.1, 0),
    (12, -78, 12.2, 2.65, 0),
    (12, -78, 12.2, 2.65, 2.62),
    (-10, -83, 2.65, 12.2, 0),
]

# Exact props from dist/js/yard.js: (kind, x, z, w, h, d)
PROPS = [
    ("crates", -16, 68, 2.8, 2.2, 2.8),
    ("crates", 2.6, 61, 2.6, 2.6, 1.5),
    ("barrier", -3, 56, 5, 0.86, 0.8),
    ("spool", -15, 40, 2.2, 1.9, 2.2),
    ("crates", 0, 23, 2.6, 2.3, 2.0),
    ("barrier", -2, 16, 3.8, 0.92, 0.8),
    ("lift", 18, 2, 2.2, 2.7, 3.7),
    ("spool", -17, -1, 2.3, 2.0, 2.3),
    ("barrier", -4, -16, 0.85, 0.93, 4),
    ("crates", 13, -10, 2.6, 2.1, 2.5),
    ("crates", -11, -26, 2.2, 2.4, 2),
    ("barrier", 1, -31, 4, 0.9, 0.8),
    ("spool", -16, -45, 2.2, 2, 2.2),
    ("crates", 6, -54, 2.6, 2.5, 2.4),
    ("barrier", -2, -70, 4, 0.9, 0.8),
    ("crates", -16, -77, 2.4, 2.4, 2.4),
    ("barrier", 8, 90, 4.5, 0.8, 0.8),
    ("spool", 17, 60, 2.4, 1.95, 2.4),
]

CRANE_SITES = [
    {"x": -18.0, "z": 37.0, "scale": 1.0},
    {"x": -18.0, "z": -66.0, "scale": 0.95},
]

TANKERS = [
    {"id": 0, "x": 10.0, "z": 62.0, "w": 2.4, "h": 2.85, "d": 5.6, "radius": 4.6},
    {"id": 1, "x": -6.5, "z": -5.0, "w": 2.4, "h": 2.85, "d": 5.6, "radius": 4.6},
    {"id": 2, "x": 12.0, "z": -58.0, "w": 2.4, "h": 2.85, "d": 5.6, "radius": 4.6},
]

BAIZER_PICKUPS = [
    {"id": 0, "amount": 20.0, "x": -1.5, "z": 68.0},
    {"id": 1, "amount": 40.0, "x": 4.2, "z": 38.0},
    {"id": 2, "amount": 20.0, "x": -10.0, "z": 20.0},
    {"id": 3, "amount": 40.0, "x": 1.5, "z": -2.0},
    {"id": 4, "amount": 20.0, "x": 11.0, "z": -35.0},
    {"id": 5, "amount": 40.0, "x": -4.5, "z": -66.0},
]

TEAM_SPAWNS = [
    [(1.0, 84.0), (-16.0, 85.0), (6.0, 70.0), (-18.0, 56.0), (19.0, 61.0), (-2.0, 89.0)],
    [(0.0, -84.0), (18.0, -85.0), (-17.0, -73.0), (18.0, -61.0), (-3.0, -77.0), (4.0, -91.0)],
]


def build_obstacles_numpy() -> Tuple[np.ndarray, np.ndarray]:
    """Build exact (N, 6) AABB boxes [x0, x1, z0, z1, y0, y1] and (N,) material codes."""
    boxes = []
    mats = []

    def add_box(x: float, z: float, w: float, d: float, y0: float, y1: float, mat: int) -> None:
        boxes.append([x - w * 0.5, x + w * 0.5, z - d * 0.5, z + d * 0.5, y0, y1])
        mats.append(mat)

    for x, z, w, d, y in CARGO:
        add_box(x, z, w, d, y, y + 2.62, MAT_STEEL)
    for kind, x, z, w, h, d in PROPS:
        mat = MAT_CONCRETE if kind == "barrier" else MAT_STEEL if kind == "lift" else MAT_WOOD
        add_box(x, z, w, d, 0.0, h, mat)
    for tk in TANKERS:
        add_box(tk["x"], tk["z"], tk["w"], tk["d"], 0.0, tk["h"], MAT_STEEL)
    for c in CRANE_SITES:
        sc = c["scale"]
        for dx in (-4.4, 4.4):
            for dz in (-8.0, 8.0):
                add_box(c["x"] + dx * sc, c["z"] + dz * sc, 1.6 * sc, 2.9 * sc, 0.0, 8.0 * sc, MAT_STEEL)
    for z in range(-94, 97, 19):
        add_box(-23.7, float(z), 0.9, 1.2, 0.0, 0.86, MAT_CONCRETE)

    return np.asarray(boxes, dtype=np.float32), np.asarray(mats, dtype=np.int32)


class HarborMapGPU:
    """GPU-resident exact Harbor Range obstacles, spatial cell index, and O(1) static Lidar LUT."""

    def __init__(self, device: torch.device, build_lidar_lut: bool = True) -> None:
        self.device = device
        boxes_np, mats_np = build_obstacles_numpy()
        self.num_obstacles = int(boxes_np.shape[0])  # 80 exact

        # [N, 6]: x0, x1, z0, z1, y0, y1
        self.boxes = torch.tensor(boxes_np, dtype=torch.float32, device=device)
        self.mats = torch.tensor(mats_np, dtype=torch.int32, device=device)

        # Convenience sliced views [1, N] for vectorized broadcasting
        self.x0 = self.boxes[:, 0].contiguous()
        self.x1 = self.boxes[:, 1].contiguous()
        self.z0 = self.boxes[:, 2].contiguous()
        self.z1 = self.boxes[:, 3].contiguous()
        self.y0 = self.boxes[:, 4].contiguous()
        self.y1 = self.boxes[:, 5].contiguous()

        # Ground-level (y0 < 1.7) obstacle mask for fast horizontal collision & cover
        self.ground_obs_idx = torch.nonzero(self.y0 < 1.7, as_tuple=False).squeeze(-1)

        # Objectives & spawns
        self.tanker_pos = torch.tensor([[t["x"], t["z"]] for t in TANKERS], dtype=torch.float32, device=device)
        self.tanker_rad = torch.tensor([t["radius"] for t in TANKERS], dtype=torch.float32, device=device)
        self.baizer_pos = torch.tensor([[b["x"], b["z"]] for b in BAIZER_PICKUPS], dtype=torch.float32, device=device)
        self.baizer_amt = torch.tensor([b["amount"] for b in BAIZER_PICKUPS], dtype=torch.float32, device=device)
        self.spawns = torch.tensor(TEAM_SPAWNS, dtype=torch.float32, device=device)  # [2, 6, 2]

        # Build exact 2m x 2m spatial cell index for O(1) collision / floorAt queries
        self._build_spatial_hash(boxes_np)

        # Build high-resolution O(1) ground-level static lidar LUT (0.5m grid x 72 azimuths)
        self.has_lidar_lut = False
        if build_lidar_lut:
            self._build_lidar_lut()

    def _build_spatial_hash(self, boxes_np: np.ndarray) -> None:
        self.cell_size = 2.0
        self.grid_nx = 25   # [-25, 25] -> 25 cells
        self.grid_nz = 100  # [-100, 100] -> 100 cells
        pad = 1.0  # generous margin for actor radius + step displacement
        cell_lists = [[[] for _ in range(self.grid_nz)] for _ in range(self.grid_nx)]
        max_k = 1
        for idx, b in enumerate(boxes_np):
            ix0 = max(0, int(math.floor((b[0] - pad + FIELD_HALF_W) / self.cell_size)))
            ix1 = min(self.grid_nx - 1, int(math.floor((b[1] + pad + FIELD_HALF_W) / self.cell_size)))
            iz0 = max(0, int(math.floor((b[2] - pad + FIELD_HALF_L) / self.cell_size)))
            iz1 = min(self.grid_nz - 1, int(math.floor((b[3] + pad + FIELD_HALF_L) / self.cell_size)))
            for ix in range(ix0, ix1 + 1):
                for iz in range(iz0, iz1 + 1):
                    cell_lists[ix][iz].append(idx)
                    if len(cell_lists[ix][iz]) > max_k:
                        max_k = len(cell_lists[ix][iz])

        self.max_cell_obs = max_k
        arr = np.full((self.grid_nx * self.grid_nz, max_k), -1, dtype=np.int64)
        for ix in range(self.grid_nx):
            for iz in range(self.grid_nz):
                cid = ix * self.grid_nz + iz
                lst = cell_lists[ix][iz]
                arr[cid, : len(lst)] = lst
        self.cell_obs = torch.tensor(arr, dtype=torch.long, device=self.device)

    @torch.no_grad()
    def _build_lidar_lut(self) -> None:
        """Precompute ground-level (y=0) static 2D raycast distances & hit materials on GPU/CPU.

        Grid: 100 (x in [-25, 25], 0.5m) x 400 (z in [-100, 100], 0.5m) x 72 angles (every 5 deg).
        Memory on GPU: ~34 MB (chest dist fp16, low dist fp16, upper dist fp16, mat uint8).
        Built once at studio startup (~0.15s on A100, ~1.5s on CPU).
        """
        if self.device.type == "cuda":
            self.lut_nx = 100
            self.lut_nz = 400
            self.lut_na = 72
            self.lut_step = 0.5
        else:
            self.lut_nx = 50
            self.lut_nz = 200
            self.lut_na = 36
            self.lut_step = 1.0

        xs = torch.linspace(-FIELD_HALF_W + self.lut_step * 0.5, FIELD_HALF_W - self.lut_step * 0.5, self.lut_nx, device=self.device)
        zs = torch.linspace(-FIELD_HALF_L + self.lut_step * 0.5, FIELD_HALF_L - self.lut_step * 0.5, self.lut_nz, device=self.device)
        gx, gz = torch.meshgrid(xs, zs, indexing="ij")  # [100, 400]
        pts_x = gx.reshape(-1)  # [40000]
        pts_z = gz.reshape(-1)

        angles = torch.arange(self.lut_na, device=self.device, dtype=torch.float32) * (2.0 * math.pi / self.lut_na)
        # Matching yard/geometry forward(yaw, 0) = [sin(yaw), 0, -cos(yaw)]
        dir_x = torch.sin(angles)   # [72]
        dir_z = -torch.cos(angles)  # [72]

        n_pts = pts_x.shape[0]
        chest_d = torch.empty((n_pts, self.lut_na), dtype=torch.float16, device=self.device)
        low_d = torch.empty((n_pts, self.lut_na), dtype=torch.float16, device=self.device)
        high_d = torch.empty((n_pts, self.lut_na), dtype=torch.float16, device=self.device)
        chest_m = torch.empty((n_pts, self.lut_na), dtype=torch.uint8, device=self.device)

        # Pre-filter obstacles crossing each horizontal slice height
        m_low = (self.y0 <= 0.55) & (self.y1 >= 0.55)
        m_chest = (self.y0 <= 1.25) & (self.y1 >= 1.25)
        m_high = (self.y0 <= 1.45) & (self.y1 >= 1.45)

        b_low = self.boxes[m_low]
        b_chest = self.boxes[m_chest]
        mat_chest = self.mats[m_chest].to(torch.uint8)
        b_high = self.boxes[m_high]

        chunk = 2000 if self.device.type == "cuda" else 500
        for s in range(0, n_pts, chunk):
            e = min(n_pts, s + chunk)
            ox = pts_x[s:e, None]  # [C, 1]
            oz = pts_z[s:e, None]
            cd, cm = self._raycast_2d_batch(ox, oz, dir_x, dir_z, b_chest, mat_chest, LIDAR_MAX_DIST)
            ld, _ = self._raycast_2d_batch(ox, oz, dir_x, dir_z, b_low, None, LIDAR_MAX_DIST)
            hd, _ = self._raycast_2d_batch(ox, oz, dir_x, dir_z, b_high, None, LIDAR_MAX_DIST)
            chest_d[s:e] = cd.to(torch.float16)
            low_d[s:e] = ld.to(torch.float16)
            high_d[s:e] = hd.to(torch.float16)
            chest_m[s:e] = cm

        self.lut_chest_d = chest_d.view(self.lut_nx, self.lut_nz, self.lut_na).contiguous()
        self.lut_low_d = low_d.view(self.lut_nx, self.lut_nz, self.lut_na).contiguous()
        self.lut_high_d = high_d.view(self.lut_nx, self.lut_nz, self.lut_na).contiguous()
        self.lut_chest_m = chest_m.view(self.lut_nx, self.lut_nz, self.lut_na).contiguous()
        self.has_lidar_lut = True

    def _raycast_2d_batch(
        self,
        ox: torch.Tensor,
        oz: torch.Tensor,
        dx: torch.Tensor,
        dz: torch.Tensor,
        boxes: torch.Tensor,
        mats: torch.Tensor | None,
        max_dist: float,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """Exact 2D slab raycast against horizontal slice boxes + wharf perimeter."""
        # ox, oz: [C, 1]; dx, dz: [A] -> broadcast to [C, A, 1] vs [1, 1, M]
        ox3 = ox[:, :, None]  # [C, 1, 1]
        oz3 = oz[:, :, None]
        dx3 = dx[None, :, None]  # [1, A, 1]
        dz3 = dz[None, :, None]

        # Distance to outer wharf boundary ([-25, 25] x [-100, 100])
        tx_b = torch.where(
            dx3.abs() > 1e-6,
            torch.where(dx3 > 0, (FIELD_HALF_W - ox3) / dx3, (-FIELD_HALF_W - ox3) / dx3),
            torch.full_like(ox3 + dx3, max_dist),
        )
        tz_b = torch.where(
            dz3.abs() > 1e-6,
            torch.where(dz3 > 0, (FIELD_HALF_L - oz3) / dz3, (-FIELD_HALF_L - oz3) / dz3),
            torch.full_like(oz3 + dz3, max_dist),
        )
        best_t = torch.clamp(torch.minimum(tx_b, tz_b).squeeze(-1), 0.0, max_dist)  # [C, A]
        best_m = torch.zeros_like(best_t, dtype=torch.uint8)

        if boxes.shape[0] == 0:
            return best_t, best_m

        bx0 = boxes[:, 0][None, None, :]
        bx1 = boxes[:, 1][None, None, :]
        bz0 = boxes[:, 2][None, None, :]
        bz1 = boxes[:, 3][None, None, :]

        inv_dx = torch.where(dx3.abs() > 1e-7, 1.0 / torch.where(dx3.abs() > 1e-7, dx3, torch.ones_like(dx3)), torch.zeros_like(dx3))
        inv_dz = torch.where(dz3.abs() > 1e-7, 1.0 / torch.where(dz3.abs() > 1e-7, dz3, torch.ones_like(dz3)), torch.zeros_like(dz3))

        tx1 = (bx0 - ox3) * inv_dx
        tx2 = (bx1 - ox3) * inv_dx
        tmin_x = torch.where(dx3.abs() > 1e-7, torch.minimum(tx1, tx2), torch.where((ox3 >= bx0) & (ox3 <= bx1), -1e9, 1e9))
        tmax_x = torch.where(dx3.abs() > 1e-7, torch.maximum(tx1, tx2), torch.where((ox3 >= bx0) & (ox3 <= bx1), 1e9, -1e9))

        tz1 = (bz0 - oz3) * inv_dz
        tz2 = (bz1 - oz3) * inv_dz
        tmin_z = torch.where(dz3.abs() > 1e-7, torch.minimum(tz1, tz2), torch.where((oz3 >= bz0) & (oz3 <= bz1), -1e9, 1e9))
        tmax_z = torch.where(dz3.abs() > 1e-7, torch.maximum(tz1, tz2), torch.where((oz3 >= bz0) & (oz3 <= bz1), 1e9, -1e9))

        t_enter = torch.maximum(tmin_x, tmin_z)
        t_exit = torch.minimum(tmax_x, tmax_z)
        hit = (t_exit > 0.0) & (t_enter <= t_exit) & (t_enter <= max_dist)
        t_hit = torch.where(hit, torch.clamp(t_enter, min=0.0), torch.full_like(t_enter, max_dist + 1.0))

        min_t, min_idx = t_hit.min(dim=-1)  # [C, A]
        closer = min_t < best_t
        best_t = torch.where(closer, min_t, best_t)
        if mats is not None:
            hit_mat = mats[min_idx]
            best_m = torch.where(closer, hit_mat, best_m)
        return best_t, best_m

    def sample_lidar_lut(
        self,
        x: torch.Tensor,
        z: torch.Tensor,
        yaw: torch.Tensor,
        offsets_rad: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """O(1) GPU gather of chest, low, high distances & chest material for [N] actors x [R] rays."""
        ix = torch.clamp(((x + FIELD_HALF_W) / self.lut_step).long(), 0, self.lut_nx - 1)
        iz = torch.clamp(((z + FIELD_HALF_L) / self.lut_step).long(), 0, self.lut_nz - 1)
        # Angle index modulo 72
        ang = yaw[:, None] + offsets_rad[None, :]  # [N, R]
        ia = torch.remainder(torch.round(ang * (self.lut_na / (2.0 * math.pi))).long(), self.lut_na)
        ix_e = ix[:, None].expand_as(ia)
        iz_e = iz[:, None].expand_as(ia)
        cd = self.lut_chest_d[ix_e, iz_e, ia].float()
        ld = self.lut_low_d[ix_e, iz_e, ia].float()
        hd = self.lut_high_d[ix_e, iz_e, ia].float()
        cm = self.lut_chest_m[ix_e, iz_e, ia]
        return cd, ld, hd, cm

    def raycast_segment_obstruction(
        self,
        a: torch.Tensor,
        b: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Exact 3D slab raycast matching dist/js/yard.js `raycastMaterial` / `obstruction`.

        Args:
            a: [..., 3] start points
            b: [..., 3] end points

        Returns:
            t_enter: [...] in [0, 1] or inf if unobstructed
            t_exit:  [...] exit fraction along segment
            hit_mat: [...] int32 material code (0=none, 1=steel, 2=concrete, 3=wood)
            hit_nrm: [..., 3] outward face normal of struck box
        """
        orig_shape = a.shape[:-1]
        a_f = a.reshape(-1, 3)  # [R, 3]
        b_f = b.reshape(-1, 3)
        d = b_f - a_f  # [R, 3]
        R = a_f.shape[0]
        if R == 0:
            empty = torch.empty(orig_shape, dtype=torch.float32, device=self.device)
            return (
                empty,
                empty.clone(),
                torch.empty(orig_shape, dtype=torch.int32, device=self.device),
                torch.empty((*orig_shape, 3), dtype=torch.float32, device=self.device),
            )

        # Broadcast [R, 1] vs [1, N]
        ax, ay, az = a_f[:, 0:1], a_f[:, 1:2], a_f[:, 2:3]
        dx, dy, dz = d[:, 0:1], d[:, 1:2], d[:, 2:3]

        bx0, bx1 = self.x0[None, :], self.x1[None, :]
        bz0, bz1 = self.z0[None, :], self.z1[None, :]
        by0, by1 = self.y0[None, :], self.y1[None, :]

        def slab(o: torch.Tensor, v: torch.Tensor, lo: torch.Tensor, hi: torch.Tensor):
            nz = v.abs() >= 1e-8
            safe_v = torch.where(nz, v, torch.ones_like(v))
            p = torch.where(v > 0, (lo - o) / safe_v, (hi - o) / safe_v)
            q = torch.where(v > 0, (hi - o) / safe_v, (lo - o) / safe_v)
            inside = (o >= lo) & (o <= hi)
            p = torch.where(nz, p, torch.where(inside, torch.full_like(p, -1e9), torch.full_like(p, 1e9)))
            q = torch.where(nz, q, torch.where(inside, torch.full_like(q, 1e9), torch.full_like(q, -1e9)))
            return p, q

        px, qx = slab(ax, dx, bx0, bx1)
        py, qy = slab(ay, dy, by0, by1)
        pz, qz = slab(az, dz, bz0, bz1)

        enter = torch.maximum(torch.maximum(px, py), pz)
        exit_t = torch.minimum(torch.minimum(qx, qy), qz)
        valid = (exit_t > 0.0) & (enter <= exit_t) & (enter <= 1.0)
        enter_c = torch.where(valid, torch.clamp(enter, min=0.0), torch.full_like(enter, float("inf")))

        min_t, min_i = enter_c.min(dim=-1)  # [R]
        has_hit = torch.isfinite(min_t)
        safe_i = torch.where(has_hit, min_i, torch.zeros_like(min_i))
        ar = torch.arange(R, device=self.device)
        out_exit = torch.where(has_hit, exit_t[ar, safe_i], torch.full_like(min_t, float("inf")))
        out_mat = torch.where(has_hit, self.mats[safe_i], torch.zeros_like(safe_i, dtype=torch.int32))

        # Face normal of winning entry slab
        w_px = px[ar, safe_i]
        w_py = py[ar, safe_i]
        w_pz = pz[ar, safe_i]
        is_x = (w_px >= w_py) & (w_px >= w_pz)
        is_y = (~is_x) & (w_py >= w_pz)
        is_z = (~is_x) & (~is_y)
        nx = torch.where(is_x, -torch.sign(d[:, 0]), torch.zeros_like(min_t))
        ny = torch.where(is_y, -torch.sign(d[:, 1]), torch.zeros_like(min_t))
        nz_v = torch.where(is_z, -torch.sign(d[:, 2]), torch.zeros_like(min_t))
        # Fix zero-normal fallback (origin inside box)
        nrm = torch.stack([nx, ny, nz_v], dim=-1)
        nrm = torch.where(has_hit[:, None], nrm, torch.tensor([0.0, 1.0, 0.0], device=self.device))

        # Check concrete deck plane (y <= 0 inside [-25,25]x[-100,100])
        deck_cross = (a_f[:, 1] >= 0.0) & (b_f[:, 1] < 0.0) & (d[:, 1].abs() > 1e-8)
        t_deck = torch.where(deck_cross, (0.0 - a_f[:, 1]) / torch.where(deck_cross, d[:, 1], -torch.ones_like(d[:, 1])), torch.full_like(min_t, float("inf")))
        dx_p = a_f[:, 0] + d[:, 0] * torch.clamp(t_deck, 0.0, 1.0)
        dz_p = a_f[:, 2] + d[:, 2] * torch.clamp(t_deck, 0.0, 1.0)
        deck_hit = deck_cross & (t_deck >= 0.0) & (t_deck <= 1.0) & (dx_p.abs() <= FIELD_HALF_W) & (dz_p.abs() <= FIELD_HALF_L) & (t_deck < min_t)
        min_t = torch.where(deck_hit, t_deck, min_t)
        out_exit = torch.where(deck_hit, torch.full_like(out_exit, float("inf")), out_exit)
        out_mat = torch.where(deck_hit, torch.full_like(out_mat, MAT_CONCRETE), out_mat)
        nrm = torch.where(deck_hit[:, None], torch.tensor([0.0, 1.0, 0.0], device=self.device), nrm)

        return (
            min_t.view(orig_shape),
            out_exit.view(orig_shape),
            out_mat.view(orig_shape),
            nrm.view(*orig_shape, 3),
        )

    def _local_boxes(self, x: torch.Tensor, z: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Gather local obstacle boxes [..., K, 6] and valid mask [..., K] via O(1) spatial hash."""
        ix = torch.clamp(((x + FIELD_HALF_W) / self.cell_size).long(), 0, self.grid_nx - 1)
        iz = torch.clamp(((z + FIELD_HALF_L) / self.cell_size).long(), 0, self.grid_nz - 1)
        cid = ix * self.grid_nz + iz
        obs_ids = self.cell_obs[cid]  # [..., K]
        valid = obs_ids >= 0
        safe_ids = torch.clamp(obs_ids, min=0)
        local_b = self.boxes[safe_ids]  # [..., K, 6]
        return local_b, valid

    def penetration_depth(
        self,
        x: torch.Tensor,
        z: torch.Tensor,
        feet: torch.Tensor,
        r: float = ACTOR_RADIUS,
    ) -> torch.Tensor:
        """Exact match to dist/js/yard.js `penetrationDepth` using local spatial hash."""
        depth = torch.clamp(x.abs() - (FIELD_HALF_W - r), min=0.0) + torch.clamp(z.abs() - (FIELD_HALF_L - r), min=0.0)
        lb, valid = self._local_boxes(x, z)  # [..., K, 6]
        active = valid & (feet[..., None] < lb[..., 5] - 0.018) & (feet[..., None] + 1.7 > lb[..., 4])
        cx = torch.clamp(x[..., None], lb[..., 0], lb[..., 1])
        cz = torch.clamp(z[..., None], lb[..., 2], lb[..., 3])
        dist = torch.hypot(x[..., None] - cx, z[..., None] - cz)
        pen = torch.where(active & (dist < r), r - dist, torch.zeros_like(dist))
        return depth + pen.sum(dim=-1)

    def move_actors(
        self,
        x: torch.Tensor,
        y: torch.Tensor,
        z: torch.Tensor,
        vx: torch.Tensor,
        vz: torch.Tensor,
        dx: torch.Tensor,
        dz: torch.Tensor,
        r: float = ACTOR_RADIUS,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Exact vectorized match to dist/js/yard.js `moveActor` (axis-separated slide + clamp)."""
        tx = torch.clamp(x + dx, -WALK_CLAMP_X, WALK_CLAMP_X)
        tz = torch.clamp(z + dz, -WALK_CLAMP_Z, WALK_CLAMP_Z)

        pen_cur = self.penetration_depth(x, z, y, r)
        pen_x = self.penetration_depth(tx, z, y, r)
        ok_x = (pen_x <= 1e-6) | ((pen_cur > 1e-6) & (pen_x < pen_cur - 1e-6))
        new_x = torch.where(ok_x, tx, x)
        clamped_x = (new_x == x) & (dx.abs() > 1e-7)
        new_vx = torch.where(ok_x & (~clamped_x), vx, torch.zeros_like(vx))

        pen_cur2 = self.penetration_depth(new_x, z, y, r)
        pen_z = self.penetration_depth(new_x, tz, y, r)
        ok_z = (pen_z <= 1e-6) | ((pen_cur2 > 1e-6) & (pen_z < pen_cur2 - 1e-6))
        new_z = torch.where(ok_z, tz, z)
        clamped_z = (new_z == z) & (dz.abs() > 1e-7)
        new_vz = torch.where(ok_z & (~clamped_z), vz, torch.zeros_like(vz))

        return new_x, new_z, new_vx, new_vz

    def floor_at(self, x: torch.Tensor, z: torch.Tensor, old_y: torch.Tensor) -> torch.Tensor:
        """Exact vectorized match to dist/js/yard.js `floorAt`."""
        lb, valid = self._local_boxes(x, z)
        cx = torch.clamp(x[..., None], lb[..., 0], lb[..., 1])
        cz = torch.clamp(z[..., None], lb[..., 2], lb[..., 3])
        d2 = (x[..., None] - cx) ** 2 + (z[..., None] - cz) ** 2
        ok = valid & (lb[..., 5] <= old_y[..., None] + 0.04) & (d2 <= 0.24 * 0.24)
        cand = torch.where(ok, lb[..., 5], torch.zeros_like(lb[..., 5]))
        return torch.clamp(cand.max(dim=-1).values, min=0.0)
