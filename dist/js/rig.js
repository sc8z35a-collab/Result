// 16-Joint Anatomical Humanoid Forward/Inverse Kinematics Rig (Shared across WebGL2 World, Shadow Flame 1.0 Flash/Pro, & Software fallback).
//
// Bone IDs (encoded in aKind = baseKind + boneId * 10.0 for character meshes only):
//   0: Pelvis / Hip Belt / Hip Sockets
//   1: Lumbar Waist / Abdomen
//   2: Thoracic Chest / Armor Rig / Tactical Backpack
//   3: Cervical Neck / Throat Guard
//   4: Head / Visor Helmet
//   5: Left Clavicle Pauldron + Upper Arm (Humerus, IK-driven)
//   6: Left Elbow + Forearm + Wrist + Support Glove (Radius/Ulna, IK-driven)
//   7: Right Clavicle Pauldron + Upper Arm (Humerus, IK-driven)
//   8: Right Elbow + Forearm + Wrist + Trigger Glove (Radius/Ulna, IK-driven)
//   9: Left Thigh (Femur) + Hip Cap + Holster
//  10: Left Knee Joint + Knee Pad + Shin (Tibia) + Calf Armor
//  11: Left Ankle + Heel + Midfoot + Articulated Toe Box
//  12: Right Thigh (Femur) + Hip Cap + Utility Pouch
//  13: Right Knee Joint + Knee Pad + Shin (Tibia) + Calf Armor
//  14: Right Ankle + Heel + Midfoot + Articulated Toe Box
//  15: Weapon Assembly (tracks AimPitch, ADS cheek-weld, Sprint Low-Ready, Recoil & Reload Tilt)

export const BONE = {
  PELVIS: 0,
  LUMBAR: 1,
  CHEST: 2,
  NECK: 3,
  HEAD: 4,
  ARM_UL: 5,
  ARM_FL: 6,
  ARM_UR: 7,
  ARM_FR: 8,
  THIGH_L: 9,
  SHIN_L: 10,
  FOOT_L: 11,
  THIGH_R: 12,
  SHIN_R: 13,
  FOOT_R: 14,
  WEAPON: 15
};

// Shared GLSL Rig Module — included verbatim in both worldVS (shaders.js) and sfShadowVS (shadowflame.js)
// so animated limbs, crouching knees, jump tucks, and reloading arms cast 100% pixel-identical shadows!
export const ARTICULATED_RIG_GLSL = `
// Coordinate convention: +X = Right, +Y = Up, -Z = Forward.
// Positive rigRotX swings downward limbs (-Y) FORWARD (-Z) and tilts forward vectors (-Z) UP (+Y).
vec3 rigRotX(vec3 v, float a){
  float c=cos(a), s=sin(a);
  return vec3(v.x, v.y*c - v.z*s, v.y*s + v.z*c);
}
// Positive rigRotY rotates forward (-Z) toward RIGHT (+X).
vec3 rigRotY(vec3 v, float a){
  float c=cos(a), s=sin(a);
  return vec3(v.x*c - v.z*s, v.y, v.x*s + v.z*c);
}
// Positive rigRotZ tilts +Y toward RIGHT (+X).
vec3 rigRotZ(vec3 v, float a){
  float c=cos(a), s=sin(a);
  return vec3(v.x*c + v.y*s, -v.x*s + v.y*c, v.z);
}
vec3 rigEuler(vec3 v, vec3 e){
  return rigRotY(rigRotZ(rigRotX(v, e.x), e.z), e.y);
}

// Closed-form 2-Bone Analytical Arm Inverse Kinematics (zero detachment, exact anatomical elbow flexion!)
vec3 rigSolveElbow(vec3 sh, vec3 hand, float L1, float L2, vec3 poleDir){
  vec3 diff = hand - sh;
  float rawD = length(diff);
  float dist = clamp(rawD, abs(L1 - L2) + 0.025, L1 + L2 - 0.008);
  vec3 dir = diff / max(rawD, 1e-4);
  float x = (L1*L1 - L2*L2 + dist*dist) / (2.0 * dist);
  float h = sqrt(max(0.0, L1*L1 - x*x));
  vec3 bend = poleDir - dir * dot(poleDir, dir);
  float bl = length(bend);
  bend = bl > 1e-4 ? bend / bl : vec3(0.0, -1.0, 0.0);
  return sh + dir * x + bend * h;
}

// Rigid orthonormal segment-to-segment transform (preserves 100% bone thickness, zero shear, exact normals!)
void rigOrientSegment(inout vec3 p, inout vec3 n, vec3 a0, vec3 b0, vec3 pole0, vec3 a1, vec3 b1, vec3 pole1){
  vec3 u0 = normalize(b0 - a0);
  vec3 w0 = normalize(cross(u0, pole0));
  vec3 v0 = cross(w0, u0);
  vec3 d = p - a0;
  vec3 loc = vec3(dot(d, u0), dot(d, v0), dot(d, w0));
  vec3 nloc = vec3(dot(n, u0), dot(n, v0), dot(n, w0));
  vec3 u1 = normalize(b1 - a1);
  vec3 c1 = cross(u1, pole1);
  float cl = length(c1);
  vec3 w1 = cl > 1e-4 ? c1 / cl : w0;
  vec3 v1 = cross(w1, u1);
  p = a1 + u1 * loc.x + v1 * loc.y + w1 * loc.z;
  n = normalize(u1 * nloc.x + v1 * nloc.y + w1 * nloc.z);
}

// Biomechanical 3-joint leg angles (Hip pitch/yaw/roll, Knee flexion <= 0, Ankle pitch, Toe bend)
struct LegAngles {
  vec3 hip;
  float knee;
  float ankle;
  float toe;
};

LegAngles rigLegKinematics(float side, float phase, float moveAmt, float fwdVel, float sideVel, float sprint, float crouch, float air, float land, float timeSec){
  float ph = phase + (side > 0.0 ? 3.14159265 : 0.0);
  float dirSign = fwdVel < -0.15 ? -1.0 : 1.0;
  float walkBlend = moveAmt * (1.0 - crouch * 0.55) * (1.0 - air);

  // Idle natural athletic combat stance (slight staggered feet & relaxed micro-bend, subtle breathing weight shift)
  float breathShift = sin(timeSec * 1.8) * 0.025 * (1.0 - moveAmt);
  float idleHipP = side < 0.0 ? 0.09 : -0.10;
  float idleKnee = -0.13 - abs(breathShift) * 0.5;
  float idleAnk  = -idleHipP - idleKnee;

  // Authentic human mocap Fourier gait cycle (heel-strike -> stance roll -> toe push-off -> high-knee swing!)
  float hipAmp = mix(0.48, 0.90, sprint);
  float walkHipP = dirSign * (hipAmp * sin(ph) + 0.16 * sprint * (1.0 - cos(2.0 * ph)));
  // Knee bends strictly backward (<= 0): deep athletic flexion during swing + soft shock-absorption at heel-strike
  float swingPhase = max(0.0, sin(ph * dirSign + 0.62));
  float absorbPhase = max(0.0, sin(ph * dirSign - 1.38)) * 0.24;
  float walkKnee = -(mix(0.84, 1.52, sprint) * pow(swingPhase, 1.30) + absorbPhase);
  // Ankle: toe push-off plantarflexion + swing dorsiflexion for clean heel-strike
  float walkAnk = (0.30 * sin(ph * dirSign - 0.42) - 0.38 * max(0.0, -sin(ph * dirSign + 0.35)));
  float walkToe = max(0.0, -sin(ph * dirSign + 0.40)) * (0.45 + 0.35 * sprint);

  // Directional strafe footwork (outer leg abducts & steps cleanly without crossing!)
  float strafeAmt = clamp(abs(sideVel), 0.0, 1.2) * (1.0 - air);
  float hipRoll = sideVel * sin(ph) * 0.28 + side * (0.04 + 0.06 * crouch);
  float hipYaw  = -sideVel * 0.22 * moveAmt + side * 0.07;

  float hipP = mix(idleHipP, walkHipP, walkBlend);
  float knee = mix(idleKnee, walkKnee, walkBlend);
  float ank  = mix(idleAnk, walkAnk, walkBlend);
  float toe  = walkToe * walkBlend;

  // Tactical staggered combat crouch (100% rigid limb length — ZERO squashing!)
  if(crouch > 0.001){
    float cHipP = side < 0.0 ? 1.24 : 0.04;
    float cKnee = side < 0.0 ? -1.58 : -1.46;
    float cAnk  = side < 0.0 ? 0.34 : 0.88;
    float cToe  = side < 0.0 ? 0.04 : 0.62;
    float cWalk = moveAmt * 0.26 * sin(ph);
    hipP = mix(hipP, cHipP + cWalk, crouch);
    knee = mix(knee, cKnee - max(0.0, sin(ph + 0.6)) * 0.22 * moveAmt, crouch);
    ank  = mix(ank,  cAnk, crouch);
    toe  = mix(toe,  cToe, crouch);
    hipRoll = mix(hipRoll, side * 0.14, crouch);
  }

  // Landing shock absorption (both knees flex cleanly on touchdown)
  if(land > 0.001){
    hipP += 0.42 * land;
    knee -= 0.88 * land;
    ank  += 0.46 * land;
  }

  // Airborne athletic split-knee jump tuck
  if(air > 0.001){
    float aHipP = side < 0.0 ? 0.82 : -0.24;
    float aKnee = side < 0.0 ? -1.28 : -0.78;
    float aAnk  = side < 0.0 ? -0.18 : -0.42;
    hipP = mix(hipP, aHipP, air);
    knee = mix(knee, aKnee, air);
    ank  = mix(ank,  aAnk, air);
    toe  = mix(toe,  0.0, air);
  }

  return LegAngles(vec3(hipP, hipYaw, hipRoll), clamp(knee, -2.05, -0.04), clamp(ank, -0.85, 0.95), clamp(toe, 0.0, 0.85));
}

// Evaluate a single leg's exact posed joint positions (Hip -> Knee -> Ankle -> Sole Bottom Y)
void rigEvalLegJoints(float side, vec3 pelPos, vec3 pelRot, LegAngles la, out vec3 hipP, out vec3 kneeP, out vec3 ankP, out float soleY){
  vec3 J_PEL  = vec3(0.0, 0.900, 0.010);
  vec3 bHip   = vec3(side * 0.122, 0.895, 0.012);
  vec3 bKnee  = vec3(side * 0.130, 0.500, 0.006);
  vec3 bAnk   = vec3(side * 0.130, 0.115, 0.014);

  hipP = pelPos + rigEuler(bHip - J_PEL, pelRot);
  vec3 thighDir = rigEuler(bKnee - bHip, la.hip);
  kneeP = hipP + rigEuler(thighDir, pelRot);

  // Shin inherits thigh orientation + pure anatomical knee hinge around local X
  vec3 shinLocal = rigRotX(bAnk - bKnee, la.knee);
  vec3 shinDir = rigEuler(shinLocal, la.hip);
  ankP = kneeP + rigEuler(shinDir, pelRot);

  // Compute lowest point of heel and ball of foot for millimeter-exact ground contact!
  vec3 heelLocal = rigRotX(vec3(0.0, -0.115, 0.045), la.ankle);
  vec3 ballLocal = rigRotX(vec3(0.0, -0.115, -0.085), la.ankle);
  vec3 heelW = ankP + rigEuler(rigEuler(rigRotX(heelLocal, la.knee), la.hip), pelRot);
  vec3 ballW = ankP + rigEuler(rigEuler(rigRotX(ballLocal, la.knee), la.hip), pelRot);
  soleY = min(heelW.y, ballW.y);
}

void rigApplyCharacter(inout vec3 p, inout vec3 n, int boneId, vec2 gait, vec3 pose, vec3 hit, vec2 recoil, vec4 anim, vec4 anim2, vec4 expr){
  float phase   = gait.x;
  float moveAmt = clamp(gait.y, 0.0, 1.2);
  float crouch  = clamp(pose.x, 0.0, 1.0);
  float lean    = pose.y;
  float aimPose = clamp(pose.z, 0.0, 1.0);
  float fwdVel  = anim.x;
  float sideVel = anim.y;
  float air     = clamp(anim.z, 0.0, 1.0);
  float land    = clamp(anim.w, 0.0, 1.0);
  float aimPitch= clamp(anim2.x, -0.82, 0.82);
  float timeSec = anim2.y;
  float sprint  = clamp(anim2.z, 0.0, 1.0) * (1.0 - crouch) * (1.0 - air);
  float reloadF = clamp(anim2.w, 0.0, 1.0);

  // NV2.6 Force Kinetic Embodiment channels:
  //   expr.x = decoupled cervical headYaw (-0.9..+0.9 rad)
  //   expr.y = encoded gesture + blend:
  //            +0..+1 WAVE_SWING | +1..+2 HOLD_TRAP | +2..+3 POINT_CONTACT
  //            -0..-1 STARTLE_JOLT | -1..-2 BREATH_SLUMP
  //   expr.z = somatic cardiac tension (0..1)
  //   expr.w = cardiac-coupled breath wave (-1..+1)
  float headYawOff = clamp(expr.x, -0.92, 0.92);
  float gCode      = expr.y;
  float tension    = clamp(expr.z, 0.0, 1.0);
  float waveSwingB = (gCode >  0.001 && gCode <= 1.001) ? clamp(gCode, 0.0, 1.0) : 0.0;
  float holdTrapB  = (gCode >  1.001 && gCode <= 2.001) ? clamp(gCode - 1.0, 0.0, 1.0) : 0.0;
  float pointContB = (gCode >  2.001)                   ? clamp(gCode - 2.0, 0.0, 1.0) : 0.0;
  float startleB   = (gCode < -0.001 && gCode >= -1.001) ? clamp(-gCode, 0.0, 1.0) : 0.0;
  float slumpB     = (gCode < -1.001)                    ? clamp(-gCode - 1.0, 0.0, 1.0) : 0.0;

  // 1. Pelvis kinematic base (vertical stride bounce, Trendelenburg hip drop, hip counter-yaw, strafe bank)
  vec3 J_PEL = vec3(0.0, 0.900, 0.010);
  float runFactor = moveAmt * (1.0 - crouch * 0.55) * (1.0 - air);
  float pelYaw   = sin(phase) * mix(0.11, 0.24, sprint) * runFactor * (1.0 - aimPose * 0.55);
  float pelRoll  = cos(phase) * mix(0.045, 0.085, sprint) * runFactor + sideVel * 0.075 * (1.0 - crouch);
  float pelPitch = -0.05 - 0.11 * sprint - 0.10 * crouch - 0.08 * land - 0.06 * holdTrapB + 0.09 * startleB;
  vec3 pelRot = vec3(pelPitch, pelYaw, pelRoll);

  float pelDrop = -0.032 * runFactor - 0.05 * sprint + cos(phase * 2.0) * (0.022 + 0.018 * sprint) * runFactor
                  - 0.36 * crouch - 0.14 * land + 0.08 * air - 0.045 * startleB - 0.03 * holdTrapB;
  float pelLat  = -cos(phase) * 0.024 * runFactor;
  vec3 pelPos = J_PEL + vec3(pelLat, pelDrop, 0.04 * crouch + 0.035 * startleB);

  // 2. Solve BOTH legs first so we know exact lowest sole height -> millimeter-exact ground contact (zero floating/sinking!)
  LegAngles laL = rigLegKinematics(-1.0, phase, moveAmt, fwdVel, sideVel, sprint, crouch, air, land, timeSec);
  LegAngles laR = rigLegKinematics( 1.0, phase, moveAmt, fwdVel, sideVel, sprint, crouch, air, land, timeSec);
  vec3 hipL, kneeL, ankL, hipR, kneeR, ankR;
  float soleL, soleR;
  rigEvalLegJoints(-1.0, pelPos, pelRot, laL, hipL, kneeL, ankL, soleL);
  rigEvalLegJoints( 1.0, pelPos, pelRot, laR, hipR, kneeR, ankR, soleR);
  float groundFix = -min(soleL, soleR) * (1.0 - air);
  pelPos.y += groundFix;
  hipL.y += groundFix; kneeL.y += groundFix; ankL.y += groundFix;
  hipR.y += groundFix; kneeR.y += groundFix; ankR.y += groundFix;

  // 3. Lower body bones (Pelvis + Left/Right Thigh, Shin, Foot + Articulated Toe Box)
  if(boneId == 0){
    p = pelPos + rigEuler(p - J_PEL, pelRot);
    n = normalize(rigEuler(n, pelRot));
    return;
  }
  if(boneId >= 9 && boneId <= 14){
    bool isR = boneId >= 12;
    float s = isR ? 1.0 : -1.0;
    LegAngles la;
    if(isR){ la = laR; } else { la = laL; }
    vec3 hipP  = isR ? hipR  : hipL;
    vec3 kneeP = isR ? kneeR : kneeL;
    vec3 ankP  = isR ? ankR  : ankL;
    vec3 bHip  = vec3(s * 0.122, 0.895, 0.012);
    vec3 bKnee = vec3(s * 0.130, 0.500, 0.006);
    vec3 bAnk  = vec3(s * 0.130, 0.115, 0.014);
    int part = isR ? (boneId - 12) : (boneId - 9);
    if(part == 0){
      vec3 d = rigEuler(p - bHip, la.hip);
      p = hipP + rigEuler(d, pelRot);
      n = normalize(rigEuler(rigEuler(n, la.hip), pelRot));
    } else if(part == 1){
      vec3 loc = p - bKnee;
      float isPatella = smoothstep(0.068, 0.048, abs(loc.y)) * smoothstep(-0.048, -0.080, loc.z);
      float kAng = mix(la.knee, la.knee * 0.52, isPatella);
      vec3 d = rigRotX(loc, kAng);
      p = kneeP + rigEuler(rigEuler(d, la.hip), pelRot);
      n = normalize(rigEuler(rigEuler(rigRotX(n, kAng), la.hip), pelRot));
    } else {
      vec3 loc = p - bAnk;
      vec3 nloc = n;
      if(loc.z < -0.055 && la.toe > 0.005){
        float wToe = smoothstep(-0.055, -0.095, loc.z);
        vec3 ballPivot = vec3(0.0, -0.092, -0.055);
        loc = ballPivot + rigRotX(loc - ballPivot, la.toe * wToe);
        nloc = rigRotX(nloc, la.toe * wToe);
      }
      vec3 d = rigRotX(loc, la.ankle);
      d = rigRotX(d, la.knee);
      p = ankP + rigEuler(rigEuler(d, la.hip), pelRot);
      n = normalize(rigEuler(rigEuler(rigRotX(rigRotX(nloc, la.ankle), la.knee), la.hip), pelRot));
    }
    return;
  }

  // 4. Upper Body Hierarchical Chain: Pelvis -> Lumbar Spine -> Thoracic Chest -> Neck -> Head
  float flinch = hit.x > 0.001 ? sin(hit.x * 3.14159265) * hit.x : 0.0;
  // Cardiac-coupled breathing (falls back cleanly to natural 2.55 rad/s wave when expr.w == 0)
  float breathRaw = abs(expr.w) > 0.001 ? expr.w : sin(timeSec * 2.55);
  float breath = breathRaw * (0.016 + 0.012 * sprint + 0.014 * tension + 0.016 * slumpB);

  vec3 J_LUM = vec3(0.0, 0.970, 0.010);
  vec3 J_CHS = vec3(0.0, 1.150, 0.010);
  vec3 J_NCK = vec3(0.0, 1.440, 0.000);
  vec3 J_HED = vec3(0.0, 1.535, -0.008);

  // Lumbar spine absorbs counter-twist, tactical lean, sprint drive, hit stagger & NV2.6 startle/slump!
  vec3 lumRot = vec3(
    -0.06 - 0.14 * sprint - 0.14 * crouch + flinch * hit.z * 0.28 + breath * 0.4 + startleB * 0.22 - slumpB * 0.12 - holdTrapB * 0.08,
    -pelYaw * 0.52 + flinch * hit.y * 0.24 + headYawOff * 0.08,
    lean * 0.42 - pelRoll * 0.45 + flinch * hit.y * 0.12 + waveSwingB * 0.06
  );
  vec3 lumPos = pelPos + rigEuler(J_LUM - J_PEL, pelRot);
  vec3 lumTotalRot = pelRot + lumRot;

  if(boneId == 1){
    p = lumPos + rigEuler(p - J_LUM, lumTotalRot);
    n = normalize(rigEuler(n, lumTotalRot));
    return;
  }

  // Thoracic chest completes counter-rotation so shoulders square cleanly toward aim line!
  vec3 chsRot = vec3(
    aimPitch * 0.34 - 0.05 * aimPose + recoil.x * 0.045 + flinch * hit.z * 0.22 + breath + startleB * 0.16 - slumpB * 0.10,
    -pelYaw * 0.48 + 0.14 * (1.0 - sprint) + flinch * hit.y * 0.18 + headYawOff * 0.10,
    lean * 0.26 - pelRoll * 0.40 - pointContB * 0.06
  );
  vec3 chsPos = lumPos + rigEuler(J_CHS - J_LUM, lumTotalRot);
  vec3 chsTotalRot = lumTotalRot + chsRot;

  if(boneId == 2){
    vec3 rel = p - J_CHS;
    rel.z *= 1.0 + breath * 1.25;
    rel.y += startleB * 0.014 - slumpB * 0.012;
    p = chsPos + rigEuler(rel, chsTotalRot);
    n = normalize(rigEuler(n, chsTotalRot));
    return;
  }

  // Cervical Neck & Decoupled Visor Head: head turns BEFORE torso toward eyes, sounds, allies & ambush threats!
  vec3 nckPos = chsPos + rigEuler(J_NCK - J_CHS, chsTotalRot);
  vec3 nckRot = vec3(
    aimPitch * 0.28 - chsTotalRot.x * 0.35 + flinch * 0.18 + startleB * 0.14 - slumpB * 0.08,
    -chsTotalRot.y * 0.45 + headYawOff * 0.36,
    -chsTotalRot.z * 0.35 - headYawOff * 0.08
  );
  vec3 nckTotal = chsTotalRot + nckRot;
  if(boneId == 3){
    p = nckPos + rigEuler(p - J_NCK, nckTotal);
    n = normalize(rigEuler(n, nckTotal));
    return;
  }

  vec3 hedPos = nckPos + rigEuler(J_HED - J_NCK, nckTotal);
  vec3 hedRot = vec3(
    aimPitch * 0.38 - nckTotal.x * 0.45 + flinch * 0.24 + startleB * 0.18 - slumpB * 0.10,
    -nckTotal.y * 0.55 + headYawOff * 0.64,
    aimPose * 0.12 - nckTotal.z * 0.45 - headYawOff * 0.12
  );
  vec3 hedTotal = nckTotal + hedRot;
  if(boneId == 4){
    p = hedPos + rigEuler(p - J_HED, hedTotal);
    n = normalize(rigEuler(n, hedTotal));
    return;
  }

  // 5. Weapon & Closed-Form 2-Bone IK Arms (Bones 5, 6, 7, 8, 15) — All computed cleanly in Chest Space!
  vec3 bGun   = vec3(0.072, 1.245, -0.255);
  vec3 bShL   = vec3(-0.225, 1.400, 0.000);
  vec3 bElL   = vec3(-0.210, 1.160, -0.165);
  vec3 bHandL = vec3( 0.035, 1.205, -0.395);
  vec3 bShR   = vec3( 0.225, 1.400, 0.000);
  vec3 bElR   = vec3( 0.265, 1.145, -0.065);
  vec3 bHandR = vec3( 0.072, 1.170, -0.240);

  // Weapon local animation relative to Chest: ADS cheek-weld, Sprint Low-Ready, Recoil, Reload, Startle Jolt & Trap Cant!
  float lowReady = sprint * (1.0 - aimPose) * (1.0 - clamp(recoil.x * 2.5, 0.0, 1.0));
  float pump = sin(phase) * lowReady;
  float relTilt = sin(reloadF * 3.14159265);
  float relSlam = (reloadF > 0.58 && reloadF < 0.78) ? sin((reloadF - 0.58) / 0.20 * 3.14159265) : 0.0;
  float handSignaling = clamp(waveSwingB + holdTrapB + pointContB, 0.0, 1.0);

  vec3 gunOffset = vec3(
    -0.032 * aimPose - 0.045 * lowReady + pump * 0.025 + 0.035 * handSignaling + 0.022 * startleB,
     0.058 * aimPose - 0.055 * lowReady + recoil.x * 0.016 - relTilt * 0.045 + relSlam * 0.025 + 0.036 * startleB - 0.022 * slumpB,
    -0.018 * aimPose + 0.030 * lowReady + recoil.x * 0.048 + 0.035 * startleB
  );
  vec3 gunRot = vec3(
    aimPitch * 0.66 - 0.28 * lowReady + recoil.x * 0.14 - relTilt * 0.24 + relSlam * 0.10 + 0.24 * startleB - 0.12 * slumpB,
    -0.36 * lowReady + pump * 0.10 + recoil.y * recoil.x * 0.035 - 0.14 * handSignaling,
    0.08 * aimPose - 0.34 * lowReady + relTilt * 0.42 + 0.16 * holdTrapB - 0.18 * startleB
  );

  vec3 gunPivot = chsPos + rigEuler((bGun + gunOffset) - J_CHS, chsTotalRot);

  if(boneId == 15){
    vec3 relG = rigEuler(p - bGun, gunRot);
    p = gunPivot + rigEuler(relG, chsTotalRot);
    n = normalize(rigEuler(rigEuler(n, gunRot), chsTotalRot));
    return;
  }

  // Exact hand IK targets attached directly to the weapon's posed grip & forend!
  vec3 handR_gun = bGun + gunOffset + rigEuler(bHandR - bGun, gunRot);
  vec3 handL_gun = bGun + gunOffset + rigEuler(bHandL - bGun, gunRot);

  // Dynamic Left-Hand Choreography: Reload OR NV2.6 Force Tactical Hand Signals!
  if(reloadF > 0.005){
    vec3 pouchPos = vec3(-0.14, 1.05, -0.18);
    vec3 magwellPos = bGun + gunOffset + rigEuler(vec3(0.0, -0.11, -0.12), gunRot);
    vec3 boltPos = bGun + gunOffset + rigEuler(vec3(-0.04, 0.05, -0.05), gunRot);
    if(reloadF < 0.32){
      float u = smoothstep(0.0, 0.32, reloadF);
      handL_gun = mix(handL_gun, pouchPos, u);
    } else if(reloadF < 0.66){
      float u = smoothstep(0.32, 0.66, reloadF);
      handL_gun = mix(pouchPos, magwellPos, u);
    } else if(reloadF < 0.84){
      float u = smoothstep(0.66, 0.84, reloadF);
      handL_gun = mix(magwellPos, boltPos, u);
    } else {
      float u = smoothstep(0.84, 1.0, reloadF);
      handL_gun = mix(boltPos, handL_gun, u);
    }
  } else if(waveSwingB > 0.005){
    // Tactical "ADVANCE / SYNC SWING!" overhead-to-forward arm sweep via 2-bone IK!
    float sweep = sin(timeSec * 11.5);
    vec3 wavePos = vec3(-0.34, 1.56 + sweep * 0.08, -0.22 - max(0.0, sweep) * 0.24);
    handL_gun = mix(handL_gun, wavePos, waveSwingB);
  } else if(holdTrapB > 0.005){
    // Tactical "HOLD / BAIT TRAP" low open-palm freeze gesture beside chest!
    vec3 holdPos = vec3(-0.36, 1.24 + sin(timeSec * 4.0) * 0.018, -0.20);
    handL_gun = mix(handL_gun, holdPos, holdTrapB);
  } else if(pointContB > 0.005){
    // Tactical "CONTACT!" forward-left threat-pointing gesture!
    vec3 pointPos = vec3(-0.24, 1.38, -0.56);
    handL_gun = mix(handL_gun, pointPos, pointContB);
  }

  // Solve 2-Bone Analytical Arm IK in Chest-Local Space, then lift into final Thoracic Chest transform!
  bool isRightArm = (boneId == 7 || boneId == 8);
  vec3 shBind   = isRightArm ? bShR   : bShL;
  vec3 elBind   = isRightArm ? bElR   : bElL;
  vec3 hnBind   = isRightArm ? bHandR : bHandL;
  vec3 hnTarget = isRightArm ? handR_gun : handL_gun;

  // Natural clavicle shoulder elevation/retraction (aiming, recoil, startle hunch & deep-breath shoulder drop!)
  vec3 shPosed = shBind + vec3(0.0, 0.015 * aimPose + recoil.x * 0.008 + startleB * 0.042 - slumpB * 0.024, recoil.x * 0.015 - startleB * 0.020);
  float L1 = length(elBind - shBind);
  float L2 = length(hnBind - elBind);
  vec3 poleBind = isRightArm ? vec3(0.82, -0.58, 0.32) : vec3(-0.82, -0.62, 0.24);
  vec3 polePose = isRightArm
    ? normalize(vec3(0.84 - 0.14 * aimPose, -0.56 - 0.12 * aimPose, 0.34 + 0.12 * lowReady))
    : normalize(vec3(-0.76 + 0.10 * aimPose - 0.18 * waveSwingB, -0.68 + 0.42 * waveSwingB + 0.18 * pointContB, 0.22 + 0.15 * relTilt));
  vec3 elPosed = rigSolveElbow(shPosed, hnTarget, L1, L2, polePose);

  vec3 pLocal = p, nLocal = n;
  if(boneId == 5 || boneId == 7){
    rigOrientSegment(pLocal, nLocal, shBind, elBind, poleBind, shPosed, elPosed, polePose);
  } else {
    rigOrientSegment(pLocal, nLocal, elBind, hnBind, poleBind, elPosed, hnTarget, polePose);
  }

  p = chsPos + rigEuler(pLocal - J_CHS, chsTotalRot);
  n = normalize(rigEuler(nLocal, chsTotalRot));
}
`;
