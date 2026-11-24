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
  float p = ph * dirSign;
  float walkBlend = clamp(moveAmt, 0.0, 1.0) * (1.0 - crouch * 0.55) * (1.0 - air);

  // Natural athletic idle combat stance (subtle staggered feet, relaxed micro-bend, gentle breathing shift)
  float breathShift = sin(timeSec * 1.7) * 0.018 * (1.0 - walkBlend);
  float idleHipP = side < 0.0 ? 0.07 : -0.08;
  float idleKnee = -0.11 - abs(breathShift) * 0.4;
  float idleAnk  = -idleHipP - idleKnee;

  // Authentic human biomechanical gait cycle:
  //   p = 0        : Heel-strike / initial contact (hip forward, knee near-straight, toes slightly up)
  //   p = 0.85     : Loading response / mid-stance (soft knee shock-absorption, flat planted foot)
  //   p = PI       : Toe-off / push-off (hip extended back, ankle plantarflexing, toe hinged)
  //   p = 4.18     : Mid-swing recovery (deep backward knee flexion lifting heel cleanly behind glutes)
  //   p = 5.5->2PI : Terminal swing (knee smoothly extends forward into next contact)
  float fwdMix = clamp(abs(fwdVel) / max(0.25, abs(fwdVel) + abs(sideVel) * 0.75), 0.35, 1.0);
  float hipFwd = mix(0.35, 0.56, sprint) * fwdMix;
  float hipBack = mix(0.27, 0.44, sprint) * fwdMix;
  float cp = cos(p);
  float walkHipP = (cp >= 0.0 ? cp * hipFwd : cp * hipBack) - 0.042 * sin(2.0 * p) * fwdMix;

  // Biphasic human knee curve: gentle weight-acceptance bend + deep post-toe-off swing tuck (ZERO stork-bend!)
  float loadBell  = pow(0.5 + 0.5 * cos(p - 0.85), 3.2);
  float swingBell = pow(0.5 + 0.5 * cos(p - 4.18), 2.3);
  float walkKnee  = -(0.08 + mix(0.16, 0.28, sprint) * loadBell + mix(0.74, 1.30, sprint) * swingBell);

  // Natural ankle roll: heel-strike dorsiflexion -> flat stance -> toe push-off plantarflexion -> swing clearance
  float strikeBell = pow(0.5 + 0.5 * cos(p - 0.05), 3.0);
  float pushBell   = pow(0.5 + 0.5 * cos(p - 3.25), 3.0);
  float swingClear = pow(0.5 + 0.5 * cos(p - 4.45), 2.4);
  float stanceFlat = (-walkHipP - walkKnee) * pow(0.5 + 0.5 * cos(p - 1.20), 2.6);
  float walkAnk    = stanceFlat * 0.72 + 0.12 * strikeBell + 0.10 * swingClear - mix(0.32, 0.48, sprint) * pushBell;
  float walkToe    = pushBell * (0.40 + 0.30 * sprint);

  // Restrained strafe footwork (knees track forward over toes — ZERO duck waddle!)
  float hipRoll = sideVel * sin(ph) * 0.13 * (1.0 - air) + side * (0.024 + 0.045 * crouch);
  float hipYaw  = -sideVel * 0.07 * walkBlend + side * 0.035;

  float hipP = mix(idleHipP, walkHipP, walkBlend);
  float knee = mix(idleKnee, walkKnee, walkBlend);
  float ank  = mix(idleAnk, walkAnk, walkBlend);
  float toe  = walkToe * walkBlend;

  // Tactical staggered combat crouch (100% rigid limb length — ZERO squashing!)
  if(crouch > 0.001){
    float cHipP = side < 0.0 ? 1.18 : 0.06;
    float cKnee = side < 0.0 ? -1.52 : -1.42;
    float cAnk  = side < 0.0 ? 0.34 : 0.84;
    float cToe  = side < 0.0 ? 0.04 : 0.56;
    float cWalk = clamp(moveAmt, 0.0, 1.0) * 0.24 * cos(p);
    hipP = mix(hipP, cHipP + cWalk, crouch);
    knee = mix(knee, cKnee - swingBell * 0.24 * clamp(moveAmt, 0.0, 1.0), crouch);
    ank  = mix(ank,  cAnk, crouch);
    toe  = mix(toe,  cToe, crouch);
    hipRoll = mix(hipRoll, side * 0.10, crouch);
  }

  // Landing shock absorption (both knees flex cleanly on touchdown)
  if(land > 0.001){
    hipP += 0.36 * land;
    knee -= 0.76 * land;
    ank  += 0.40 * land;
  }

  // Airborne athletic split-knee jump tuck
  if(air > 0.001){
    float aHipP = side < 0.0 ? 0.72 : -0.22;
    float aKnee = side < 0.0 ? -1.16 : -0.72;
    float aAnk  = side < 0.0 ? -0.14 : -0.34;
    hipP = mix(hipP, aHipP, air);
    knee = mix(knee, aKnee, air);
    ank  = mix(ank,  aAnk, air);
    toe  = mix(toe,  0.0, air);
  }

  return LegAngles(vec3(hipP, hipYaw, hipRoll), clamp(knee, -1.95, -0.05), clamp(ank, -0.78, 0.88), clamp(toe, 0.0, 0.80));
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
  float moveAmt = clamp(gait.y, 0.0, 1.15);
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

  // Natural head-look & cardiac breathing only (all NPC-to-NPC order hand gestures handled internally)
  float headYawOff = clamp(expr.x, -0.82, 0.82);
  float tension    = clamp(expr.z, 0.0, 1.0);

  // 1. Pelvis kinematic base: smooth athletic stride arc, subtle Trendelenburg hip drop, natural hip counter-yaw
  vec3 J_PEL = vec3(0.0, 0.900, 0.010);
  float runFactor = clamp(moveAmt, 0.0, 1.0) * (1.0 - crouch * 0.55) * (1.0 - air);
  float pelYaw   = -cos(phase) * mix(0.055, 0.115, sprint) * runFactor * (1.0 - aimPose * 0.55);
  float pelRoll  = -cos(phase) * mix(0.020, 0.038, sprint) * runFactor + sideVel * 0.042 * (1.0 - crouch);
  float pelPitch = -0.030 - 0.072 * sprint - 0.08 * crouch - 0.06 * land;
  vec3 pelRot = vec3(pelPitch, pelYaw, pelRoll);

  // Natural double-frequency vertical running arc: lowest in mid-stance loading (p=0.85), highest in push-off float (p=2.45)
  float pelBounce = -cos(phase * 2.0 - 1.70) * mix(0.014, 0.034, sprint) * runFactor;
  float pelDrop = -0.016 * runFactor - 0.028 * sprint + pelBounce - 0.35 * crouch - 0.12 * land + 0.08 * air;
  float pelLat  = cos(phase) * 0.014 * runFactor;
  vec3 pelPos = J_PEL + vec3(pelLat, pelDrop, 0.035 * crouch);

  // 2. Solve BOTH legs first -> smooth anti-sink ground contact (zero floor clipping, zero abrupt pogo snap!)
  LegAngles laL = rigLegKinematics(-1.0, phase, moveAmt, fwdVel, sideVel, sprint, crouch, air, land, timeSec);
  LegAngles laR = rigLegKinematics( 1.0, phase, moveAmt, fwdVel, sideVel, sprint, crouch, air, land, timeSec);
  vec3 hipL, kneeL, ankL, hipR, kneeR, ankR;
  float soleL, soleR;
  rigEvalLegJoints(-1.0, pelPos, pelRot, laL, hipL, kneeL, ankL, soleL);
  rigEvalLegJoints( 1.0, pelPos, pelRot, laR, hipR, kneeR, ankR, soleR);
  float lowestSole = min(soleL, soleR);
  float groundFix = clamp(-lowestSole, -0.026 * sprint, 0.14) * (1.0 - air);
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
  float breathRaw = abs(expr.w) > 0.001 ? expr.w : sin(timeSec * 2.55);
  float breath = breathRaw * (0.014 + 0.010 * sprint + 0.010 * tension);

  vec3 J_LUM = vec3(0.0, 0.970, 0.010);
  vec3 J_CHS = vec3(0.0, 1.150, 0.010);
  vec3 J_NCK = vec3(0.0, 1.440, 0.000);
  vec3 J_HED = vec3(0.0, 1.535, -0.008);

  // Lumbar spine absorbs counter-twist, tactical lean, balanced sprint lean & hit stagger
  vec3 lumRot = vec3(
    -0.025 - 0.062 * sprint - 0.10 * crouch + flinch * hit.z * 0.24 + breath * 0.35,
    -pelYaw * 0.55 + flinch * hit.y * 0.20 + headYawOff * 0.06,
    lean * 0.40 - pelRoll * 0.45 + flinch * hit.y * 0.10
  );
  vec3 lumPos = pelPos + rigEuler(J_LUM - J_PEL, pelRot);
  vec3 lumTotalRot = pelRot + lumRot;

  if(boneId == 1){
    p = lumPos + rigEuler(p - J_LUM, lumTotalRot);
    n = normalize(rigEuler(n, lumTotalRot));
    return;
  }

  // Thoracic chest completes counter-rotation so shoulders stay athletic & squared cleanly toward aim line!
  vec3 chsRot = vec3(
    aimPitch * 0.34 - 0.03 * aimPose + recoil.x * 0.040 + flinch * hit.z * 0.20 + breath,
    -pelYaw * 0.45 + 0.08 * (1.0 - sprint) + flinch * hit.y * 0.16 + headYawOff * 0.08,
    lean * 0.26 - pelRoll * 0.40
  );
  vec3 chsPos = lumPos + rigEuler(J_CHS - J_LUM, lumTotalRot);
  vec3 chsTotalRot = lumTotalRot + chsRot;

  if(boneId == 2){
    vec3 rel = p - J_CHS;
    rel.z *= 1.0 + breath * 1.15;
    p = chsPos + rigEuler(rel, chsTotalRot);
    n = normalize(rigEuler(n, chsTotalRot));
    return;
  }

  // Cervical Neck & Head: stabilized smoothly against body pitch/roll during sprint
  vec3 nckPos = chsPos + rigEuler(J_NCK - J_CHS, chsTotalRot);
  vec3 nckRot = vec3(
    aimPitch * 0.28 - chsTotalRot.x * 0.42 + flinch * 0.16,
    -chsTotalRot.y * 0.45 + headYawOff * 0.36,
    -chsTotalRot.z * 0.40 - headYawOff * 0.06
  );
  vec3 nckTotal = chsTotalRot + nckRot;
  if(boneId == 3){
    p = nckPos + rigEuler(p - J_NCK, nckTotal);
    n = normalize(rigEuler(n, nckTotal));
    return;
  }

  vec3 hedPos = nckPos + rigEuler(J_HED - J_NCK, nckTotal);
  vec3 hedRot = vec3(
    aimPitch * 0.38 - nckTotal.x * 0.50 + flinch * 0.20,
    -nckTotal.y * 0.55 + headYawOff * 0.64,
    aimPose * 0.10 - nckTotal.z * 0.50 - headYawOff * 0.10
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

  // Weapon local animation relative to Chest: ADS cheek-weld, Tactical Sprint Low-Ready, Recoil & Reload
  float lowReady = sprint * (1.0 - aimPose) * (1.0 - clamp(recoil.x * 2.5, 0.0, 1.0));
  float pump = -cos(phase) * lowReady;
  float relTilt = sin(reloadF * 3.14159265);
  float relSlam = (reloadF > 0.58 && reloadF < 0.78) ? sin((reloadF - 0.58) / 0.20 * 3.14159265) : 0.0;

  vec3 gunOffset = vec3(
    -0.030 * aimPose - 0.038 * lowReady + pump * 0.022,
     0.056 * aimPose - 0.042 * lowReady + recoil.x * 0.016 - relTilt * 0.045 + relSlam * 0.025,
    -0.018 * aimPose + 0.024 * lowReady + recoil.x * 0.048
  );
  vec3 gunRot = vec3(
    aimPitch * 0.66 - 0.22 * lowReady + recoil.x * 0.14 - relTilt * 0.24 + relSlam * 0.10,
    -0.30 * lowReady + pump * 0.08 + recoil.y * recoil.x * 0.035,
    0.08 * aimPose - 0.26 * lowReady + relTilt * 0.42
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

  // Left-Hand Reload Choreography
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
  }

  // Solve 2-Bone Analytical Arm IK in Chest-Local Space, then lift into final Thoracic Chest transform!
  bool isRightArm = (boneId == 7 || boneId == 8);
  vec3 shBind   = isRightArm ? bShR   : bShL;
  vec3 elBind   = isRightArm ? bElR   : bElL;
  vec3 hnBind   = isRightArm ? bHandR : bHandL;
  vec3 hnTarget = isRightArm ? handR_gun : handL_gun;

  // Natural clavicle shoulder elevation/retraction
  vec3 shPosed = shBind + vec3(0.0, 0.014 * aimPose + recoil.x * 0.008, recoil.x * 0.015);
  float L1 = length(elBind - shBind);
  float L2 = length(hnBind - elBind);
  vec3 poleBind = isRightArm ? vec3(0.82, -0.58, 0.32) : vec3(-0.82, -0.62, 0.24);
  vec3 polePose = isRightArm
    ? normalize(vec3(0.84 - 0.14 * aimPose, -0.56 - 0.12 * aimPose, 0.34 + 0.12 * lowReady))
    : normalize(vec3(-0.76 + 0.10 * aimPose, -0.68, 0.22 + 0.15 * relTilt));
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

// ============================================================================
// RigCore-Zero: CPU-Once 20-Bone Affine Matrix Palette Skinning (6 FMAs/vertex!)
// Eliminates 180+ ALU + 18 trig + 10 pow ops per vertex across World, Shadow & Mirror passes
// while reproducing 100% exact 16-joint FK/IK + patella bisector + articulated toe kinematics!
// ============================================================================
export const RIG_BONE_COUNT = 20;
export const IDENTITY_PALETTE = new Float32Array(RIG_BONE_COUNT * 12);
for (let b = 0; b < RIG_BONE_COUNT; b++) {
  const o = b * 12;
  IDENTITY_PALETTE[o] = 1;
  IDENTITY_PALETTE[o + 5] = 1;
  IDENTITY_PALETTE[o + 10] = 1;
}

export const RIG_PALETTE_GLSL = `
uniform vec4 uBones[60];
void rigApplyPalette(inout vec3 p, inout vec3 n, int boneId){
  int b = clamp(boneId, 0, 15);
  int idx = b * 3;
  vec4 r0 = uBones[idx];
  vec4 r1 = uBones[idx + 1];
  vec4 r2 = uBones[idx + 2];
  if(b == 10 || b == 13){
    float ly = abs(p.y - 0.500);
    float lz = p.z - 0.006;
    if(ly < 0.068 && lz < -0.048){
      float wP = smoothstep(0.068, 0.048, ly) * smoothstep(-0.048, -0.080, lz);
      int pi = (b == 13 ? 17 : 16) * 3;
      r0 = mix(r0, uBones[pi], wP);
      r1 = mix(r1, uBones[pi + 1], wP);
      r2 = mix(r2, uBones[pi + 2], wP);
    }
  } else if(b == 11 || b == 14){
    float lz = p.z - 0.014;
    if(lz < -0.055){
      float wT = smoothstep(-0.055, -0.095, lz);
      int ti = (b == 14 ? 19 : 18) * 3;
      r0 = mix(r0, uBones[ti], wT);
      r1 = mix(r1, uBones[ti + 1], wT);
      r2 = mix(r2, uBones[ti + 2], wT);
    }
  }
  vec4 p4 = vec4(p, 1.0);
  p = vec3(dot(r0, p4), dot(r1, p4), dot(r2, p4));
  n = normalize(vec3(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n)));
}
`;

export const RIG_PALETTE_SHADOW_GLSL = `
uniform vec4 uBones[60];
void rigApplyPalettePos(inout vec3 p, int boneId){
  int b = clamp(boneId, 0, 15);
  int idx = b * 3;
  vec4 r0 = uBones[idx];
  vec4 r1 = uBones[idx + 1];
  vec4 r2 = uBones[idx + 2];
  if(b == 10 || b == 13){
    float ly = abs(p.y - 0.500);
    float lz = p.z - 0.006;
    if(ly < 0.068 && lz < -0.048){
      float wP = smoothstep(0.068, 0.048, ly) * smoothstep(-0.048, -0.080, lz);
      int pi = (b == 13 ? 17 : 16) * 3;
      r0 = mix(r0, uBones[pi], wP);
      r1 = mix(r1, uBones[pi + 1], wP);
      r2 = mix(r2, uBones[pi + 2], wP);
    }
  } else if(b == 11 || b == 14){
    float lz = p.z - 0.014;
    if(lz < -0.055){
      float wT = smoothstep(-0.055, -0.095, lz);
      int ti = (b == 14 ? 19 : 18) * 3;
      r0 = mix(r0, uBones[ti], wT);
      r1 = mix(r1, uBones[ti + 1], wT);
      r2 = mix(r2, uBones[ti + 2], wT);
    }
  }
  vec4 p4 = vec4(p, 1.0);
  p = vec3(dot(r0, p4), dot(r1, p4), dot(r2, p4));
}
`;

// Zero-GC scratch matrices & helpers for CPU-once solveCharacterPalette()
const _cl = (v, a, b) => (v < a ? a : v > b ? b : v);
const _mx = (a, b, t) => a + (b - a) * t;
const _ss = (e0, e1, x) => { const t = _cl((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// Build 3x3 row-major matrix matching rigEuler(v, e) = rigRotY(rigRotZ(rigRotX(v, ex), ez), ey)
function _euler3(out, ex, ey, ez) {
  const cx = Math.cos(ex), sx = Math.sin(ex);
  const cy = Math.cos(ey), sy = Math.sin(ey);
  const cz = Math.cos(ez), sz = Math.sin(ez);
  // First A = Rz(ez) * Rx(ex):
  //   Rx = [1,0,0; 0,cx,-sx; 0,sx,cx]
  //   Rz = [cz,sz,0; -sz,cz,0; 0,0,1]
  //   A  = [cz, sz*cx, -sz*sx; -sz, cz*cx, -cz*sx; 0, sx, cx]
  // Then Ry(ey) = [cy,0,-sy; 0,1,0; sy,0,cy] * A:
  const a00 = cz,  a01 = sz * cx,  a02 = -sz * sx;
  const a10 = -sz, a11 = cz * cx,  a12 = -cz * sx;
  const a21 = sx,  a22 = cx;
  out[0] = cy * a00;             out[1] = cy * a01 - sy * a21; out[2] = cy * a02 - sy * a22;
  out[3] = a10;                  out[4] = a11;                 out[5] = a12;
  out[6] = sy * a00;             out[7] = sy * a01 + cy * a21; out[8] = sy * a02 + cy * a22;
}

function _mul3(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8];
  const b00 = b[0], b01 = b[1], b02 = b[2], b10 = b[3], b11 = b[4], b12 = b[5], b20 = b[6], b21 = b[7], b22 = b[8];
  out[0] = a00 * b00 + a01 * b10 + a02 * b20; out[1] = a00 * b01 + a01 * b11 + a02 * b21; out[2] = a00 * b02 + a01 * b12 + a02 * b22;
  out[3] = a10 * b00 + a11 * b10 + a12 * b20; out[4] = a10 * b01 + a11 * b11 + a12 * b21; out[5] = a10 * b02 + a11 * b12 + a12 * b22;
  out[6] = a20 * b00 + a21 * b10 + a22 * b20; out[7] = a20 * b01 + a21 * b11 + a22 * b21; out[8] = a20 * b02 + a21 * b12 + a22 * b22;
}

// Multiply 3x3 matrix `a` on the right by Rx(ang)
function _mulRx3(out, a, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const a01 = a[1], a02 = a[2], a11 = a[4], a12 = a[5], a21 = a[7], a22 = a[8];
  out[0] = a[0]; out[1] = a01 * c + a02 * s; out[2] = -a01 * s + a02 * c;
  out[3] = a[3]; out[4] = a11 * c + a12 * s; out[5] = -a11 * s + a12 * c;
  out[6] = a[6]; out[7] = a21 * c + a22 * s; out[8] = -a21 * s + a22 * c;
}

// Write 3x4 affine row-major bone slot `boneIdx`: p' = outP + M * (p - inP)
function _writeBone(pal, boneIdx, M, inX, inY, inZ, outX, outY, outZ) {
  const o = boneIdx * 12;
  const m0 = M[0], m1 = M[1], m2 = M[2];
  const m3 = M[3], m4 = M[4], m5 = M[5];
  const m6 = M[6], m7 = M[7], m8 = M[8];
  pal[o] = m0; pal[o + 1] = m1; pal[o + 2] = m2; pal[o + 3] = outX - (m0 * inX + m1 * inY + m2 * inZ);
  pal[o + 4] = m3; pal[o + 5] = m4; pal[o + 6] = m5; pal[o + 7] = outY - (m3 * inX + m4 * inY + m5 * inZ);
  pal[o + 8] = m6; pal[o + 9] = m7; pal[o + 10] = m8; pal[o + 11] = outZ - (m6 * inX + m7 * inY + m8 * inZ);
}

const _mPel = new Float32Array(9);
const _mLum = new Float32Array(9);
const _mChs = new Float32Array(9);
const _mChsBr = new Float32Array(9);
const _mNck = new Float32Array(9);
const _mHed = new Float32Array(9);
const _mGun = new Float32Array(9);
const _mWpn = new Float32Array(9);
const _mHip = new Float32Array(9);
const _mThigh = new Float32Array(9);
const _mShin = new Float32Array(9);
const _mPat = new Float32Array(9);
const _mFoot = new Float32Array(9);
const _mToe = new Float32Array(9);
const _mSeg = new Float32Array(9);
const _mArm = new Float32Array(9);
const _legL = {hx: 0, hy: 0, hz: 0, knee: 0, ankle: 0, toe: 0, hipX: 0, hipY: 0, hipZ: 0, kneeX: 0, kneeY: 0, kneeZ: 0, ankX: 0, ankY: 0, ankZ: 0, soleY: 0};
const _legR = {hx: 0, hy: 0, hz: 0, knee: 0, ankle: 0, toe: 0, hipX: 0, hipY: 0, hipZ: 0, kneeX: 0, kneeY: 0, kneeZ: 0, ankX: 0, ankY: 0, ankZ: 0, soleY: 0};
const _elbow = [0, 0, 0];

function _solveLegKinematics(dst, side, phase, moveAmt, fwdVel, sideVel, sprint, crouch, air, land, timeSec) {
  const ph = phase + (side > 0 ? Math.PI : 0);
  const p = fwdVel < -0.15 ? -ph : ph;
  const walkBlend = _cl(moveAmt, 0, 1) * (1 - crouch * 0.55) * (1 - air);

  const breathShift = Math.sin(timeSec * 1.7) * 0.018 * (1 - walkBlend);
  const idleHipP = side < 0 ? 0.07 : -0.08;
  const idleKnee = -0.11 - Math.abs(breathShift) * 0.4;
  const idleAnk = -idleHipP - idleKnee;

  const absF = Math.abs(fwdVel), absS = Math.abs(sideVel);
  const fwdMix = _cl(absF / Math.max(0.25, absF + absS * 0.75), 0.35, 1.0);
  const hipFwd = _mx(0.35, 0.56, sprint) * fwdMix;
  const hipBack = _mx(0.27, 0.44, sprint) * fwdMix;
  const cp = Math.cos(p);
  const walkHipP = (cp >= 0 ? cp * hipFwd : cp * hipBack) - 0.042 * Math.sin(2 * p) * fwdMix;

  const loadBell = Math.pow(0.5 + 0.5 * Math.cos(p - 0.85), 3.2);
  const swingBell = Math.pow(0.5 + 0.5 * Math.cos(p - 4.18), 2.3);
  const walkKnee = -(0.08 + _mx(0.16, 0.28, sprint) * loadBell + _mx(0.74, 1.30, sprint) * swingBell);

  const strikeBell = Math.pow(0.5 + 0.5 * Math.cos(p - 0.05), 3.0);
  const pushBell = Math.pow(0.5 + 0.5 * Math.cos(p - 3.25), 3.0);
  const swingClear = Math.pow(0.5 + 0.5 * Math.cos(p - 4.45), 2.4);
  const stanceFlat = (-walkHipP - walkKnee) * Math.pow(0.5 + 0.5 * Math.cos(p - 1.20), 2.6);
  const walkAnk = stanceFlat * 0.72 + 0.12 * strikeBell + 0.10 * swingClear - _mx(0.32, 0.48, sprint) * pushBell;
  const walkToe = pushBell * (0.40 + 0.30 * sprint);

  let hipRoll = sideVel * Math.sin(ph) * 0.13 * (1 - air) + side * (0.024 + 0.045 * crouch);
  const hipYaw = -sideVel * 0.07 * walkBlend + side * 0.035;

  let hipP = _mx(idleHipP, walkHipP, walkBlend);
  let knee = _mx(idleKnee, walkKnee, walkBlend);
  let ank = _mx(idleAnk, walkAnk, walkBlend);
  let toe = walkToe * walkBlend;

  if (crouch > 0.001) {
    const cHipP = side < 0 ? 1.18 : 0.06;
    const cKnee = side < 0 ? -1.52 : -1.42;
    const cAnk = side < 0 ? 0.34 : 0.84;
    const cToe = side < 0 ? 0.04 : 0.56;
    const cWalk = _cl(moveAmt, 0, 1) * 0.24 * cp;
    hipP = _mx(hipP, cHipP + cWalk, crouch);
    knee = _mx(knee, cKnee - swingBell * 0.24 * _cl(moveAmt, 0, 1), crouch);
    ank = _mx(ank, cAnk, crouch);
    toe = _mx(toe, cToe, crouch);
    hipRoll = _mx(hipRoll, side * 0.10, crouch);
  }
  if (land > 0.001) {
    hipP += 0.36 * land;
    knee -= 0.76 * land;
    ank += 0.40 * land;
  }
  if (air > 0.001) {
    hipP = _mx(hipP, side < 0 ? 0.72 : -0.22, air);
    knee = _mx(knee, side < 0 ? -1.16 : -0.72, air);
    ank = _mx(ank, side < 0 ? -0.14 : -0.34, air);
    toe = _mx(toe, 0, air);
  }
  dst.hx = hipP; dst.hy = hipYaw; dst.hz = hipRoll;
  dst.knee = _cl(knee, -1.95, -0.05);
  dst.ankle = _cl(ank, -0.78, 0.88);
  dst.toe = _cl(toe, 0, 0.80);
}

function _evalLegJoints(leg, side, pelX, pelY, pelZ, mPel) {
  const bHipX = side * 0.122, bHipY = 0.895, bHipZ = 0.012;
  const bKneeX = side * 0.130, bKneeY = 0.500, bKneeZ = 0.006;
  const bAnkX = side * 0.130, bAnkY = 0.115, bAnkZ = 0.014;

  const dhx = bHipX, dhy = bHipY - 0.900, dhz = bHipZ - 0.010;
  const hipX = pelX + mPel[0] * dhx + mPel[1] * dhy + mPel[2] * dhz;
  const hipY = pelY + mPel[3] * dhx + mPel[4] * dhy + mPel[5] * dhz;
  const hipZ = pelZ + mPel[6] * dhx + mPel[7] * dhy + mPel[8] * dhz;

  _euler3(_mHip, leg.hx, leg.hy, leg.hz);
  _mul3(_mThigh, mPel, _mHip);
  const dkx = bKneeX - bHipX, dky = bKneeY - bHipY, dkz = bKneeZ - bHipZ;
  const kneeX = hipX + _mThigh[0] * dkx + _mThigh[1] * dky + _mThigh[2] * dkz;
  const kneeY = hipY + _mThigh[3] * dkx + _mThigh[4] * dky + _mThigh[5] * dkz;
  const kneeZ = hipZ + _mThigh[6] * dkx + _mThigh[7] * dky + _mThigh[8] * dkz;

  _mulRx3(_mShin, _mThigh, leg.knee);
  const dax = bAnkX - bKneeX, day = bAnkY - bKneeY, daz = bAnkZ - bKneeZ;
  const ankX = kneeX + _mShin[0] * dax + _mShin[1] * day + _mShin[2] * daz;
  const ankY = kneeY + _mShin[3] * dax + _mShin[4] * day + _mShin[5] * daz;
  const ankZ = kneeZ + _mShin[6] * dax + _mShin[7] * day + _mShin[8] * daz;

  _mulRx3(_mFoot, _mShin, leg.ankle);
  const heelY = ankY + _mFoot[4] * (-0.115) + _mFoot[5] * 0.045;
  const ballY = ankY + _mFoot[4] * (-0.115) + _mFoot[5] * (-0.085);
  leg.hipX = hipX; leg.hipY = hipY; leg.hipZ = hipZ;
  leg.kneeX = kneeX; leg.kneeY = kneeY; leg.kneeZ = kneeZ;
  leg.ankX = ankX; leg.ankY = ankY; leg.ankZ = ankZ;
  leg.soleY = heelY < ballY ? heelY : ballY;
}

function _solveElbowCPU(shX, shY, shZ, hX, hY, hZ, L1, L2, pX, pY, pZ) {
  const dx = hX - shX, dy = hY - shY, dz = hZ - shZ;
  const rawD = Math.hypot(dx, dy, dz);
  const dist = _cl(rawD, Math.abs(L1 - L2) + 0.025, L1 + L2 - 0.008);
  const invD = 1 / (rawD > 1e-4 ? rawD : 1e-4);
  const dirX = dx * invD, dirY = dy * invD, dirZ = dz * invD;
  const x = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  const pd = pX * dirX + pY * dirY + pZ * dirZ;
  let bX = pX - dirX * pd, bY = pY - dirY * pd, bZ = pZ - dirZ * pd;
  const bl = Math.hypot(bX, bY, bZ);
  if (bl > 1e-4) { const ib = 1 / bl; bX *= ib; bY *= ib; bZ *= ib; }
  else { bX = 0; bY = -1; bZ = 0; }
  _elbow[0] = shX + dirX * x + bX * h;
  _elbow[1] = shY + dirY * x + bY * h;
  _elbow[2] = shZ + dirZ * x + bZ * h;
}

// Compute exact segment-to-segment rotation matrix B1 * B0^T into `_mSeg`
function _orientSegmentMat(a0x, a0y, a0z, b0x, b0y, b0z, p0x, p0y, p0z, a1x, a1y, a1z, b1x, b1y, b1z, p1x, p1y, p1z) {
  let u0x = b0x - a0x, u0y = b0y - a0y, u0z = b0z - a0z;
  let inv = 1 / (Math.hypot(u0x, u0y, u0z) || 1); u0x *= inv; u0y *= inv; u0z *= inv;
  let w0x = u0y * p0z - u0z * p0y, w0y = u0z * p0x - u0x * p0z, w0z = u0x * p0y - u0y * p0x;
  inv = 1 / (Math.hypot(w0x, w0y, w0z) || 1); w0x *= inv; w0y *= inv; w0z *= inv;
  const v0x = w0y * u0z - w0z * u0y, v0y = w0z * u0x - w0x * u0z, v0z = w0x * u0y - w0y * u0x;

  let u1x = b1x - a1x, u1y = b1y - a1y, u1z = b1z - a1z;
  inv = 1 / (Math.hypot(u1x, u1y, u1z) || 1); u1x *= inv; u1y *= inv; u1z *= inv;
  let w1x = u1y * p1z - u1z * p1y, w1y = u1z * p1x - u1x * p1z, w1z = u1x * p1y - u1y * p1x;
  const cl = Math.hypot(w1x, w1y, w1z);
  if (cl > 1e-4) { inv = 1 / cl; w1x *= inv; w1y *= inv; w1z *= inv; }
  else { w1x = w0x; w1y = w0y; w1z = w0z; }
  const v1x = w1y * u1z - w1z * u1y, v1y = w1z * u1x - w1x * u1z, v1z = w1x * u1y - w1y * u1x;

  // B1 * B0^T (row r, col c = u1[r]*u0[c] + v1[r]*v0[c] + w1[r]*w0[c])
  _mSeg[0] = u1x * u0x + v1x * v0x + w1x * w0x; _mSeg[1] = u1x * u0y + v1x * v0y + w1x * w0y; _mSeg[2] = u1x * u0z + v1x * v0z + w1x * w0z;
  _mSeg[3] = u1y * u0x + v1y * v0x + w1y * w0x; _mSeg[4] = u1y * u0y + v1y * v0y + w1y * w0y; _mSeg[5] = u1y * u0z + v1y * v0z + w1y * w0z;
  _mSeg[6] = u1z * u0x + v1z * v0x + w1z * w0x; _mSeg[7] = u1z * u0y + v1z * v0y + w1z * w0y; _mSeg[8] = u1z * u0z + v1z * v0z + w1z * w0z;
}

const _L1_L = Math.hypot(-0.210 - (-0.225), 1.160 - 1.400, -0.165);
const _L2_L = Math.hypot(0.035 - (-0.210), 1.205 - 1.160, -0.395 - (-0.165));
const _L1_R = Math.hypot(0.265 - 0.225, 1.145 - 1.400, -0.065);
const _L2_R = Math.hypot(0.072 - 0.265, 1.170 - 1.145, -0.240 - (-0.065));

/**
 * Computes all 20 affine 3x4 bone matrices (240 floats = 60 vec4s) ONCE per actor on CPU.
 * Zero allocations; shared across Shadow Flame, Mirror Reflection, and Main World passes!
 */
export function solveCharacterPalette(a, time, out) {
  const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
  let hitX = 0, hitZ = 1;
  if (a.hitDir) {
    hitX = _cl(a.hitDir[0] * cy + a.hitDir[2] * sy, -1, 1);
    hitZ = _cl(a.hitDir[0] * (-sy) + a.hitDir[2] * cy, -1, 1);
  }
  const hitMag = a.hitRecoil || 0;
  const phase = (a.stride || 0) * 1.92;
  const moveAmt = _cl(Math.hypot(a.vx || 0, a.vz || 0) / 4.2, 0, 1.15);
  const crouch = _cl(a.crouch || 0, 0, 1);
  const lean = a.lean || 0;
  const aimPose = _cl(a.aimPose || 0, 0, 1);
  const fwdVel = a.fwdVel || 0;
  const sideVel = a.sideVel || 0;
  const air = _cl(a.airBlend || 0, 0, 1);
  const land = _cl(a.landCompress || 0, 0, 1);
  const aimPitch = _cl(a.pitch || 0, -0.82, 0.82);
  const timeSec = time + (a.id || 0) * 1.13;
  const sprint = _cl(a.sprintAmt || 0, 0, 1) * (1 - crouch) * (1 - air);
  const reloadF = _cl(a.reloadFrac || 0, 0, 1);
  const recX = a.recoil || 0, recY = a.recoilSide || 0;
  const ex = a.expr;
  const headYawOff = _cl(ex?.headYaw || 0, -0.82, 0.82);
  const tension = _cl(ex?.tension || 0, 0, 1);
  const exprW = ex?.breathWave || 0;

  // 1. Pelvis
  const runFactor = _cl(moveAmt, 0, 1) * (1 - crouch * 0.55) * (1 - air);
  const cosPh = Math.cos(phase);
  const pelYaw = -cosPh * _mx(0.055, 0.115, sprint) * runFactor * (1 - aimPose * 0.55);
  const pelRoll = -cosPh * _mx(0.020, 0.038, sprint) * runFactor + sideVel * 0.042 * (1 - crouch);
  const pelPitch = -0.030 - 0.072 * sprint - 0.08 * crouch - 0.06 * land;
  _euler3(_mPel, pelPitch, pelYaw, pelRoll);

  const pelBounce = -Math.cos(phase * 2 - 1.70) * _mx(0.014, 0.034, sprint) * runFactor;
  const pelDrop = -0.016 * runFactor - 0.028 * sprint + pelBounce - 0.35 * crouch - 0.12 * land + 0.08 * air;
  const pelX = cosPh * 0.014 * runFactor;
  let pelY = 0.900 + pelDrop;
  const pelZ = 0.010 + 0.035 * crouch;

  // 2. Both legs + ground clamp
  _solveLegKinematics(_legL, -1, phase, moveAmt, fwdVel, sideVel, sprint, crouch, air, land, timeSec);
  _solveLegKinematics(_legR,  1, phase, moveAmt, fwdVel, sideVel, sprint, crouch, air, land, timeSec);
  _evalLegJoints(_legL, -1, pelX, pelY, pelZ, _mPel);
  _evalLegJoints(_legR,  1, pelX, pelY, pelZ, _mPel);
  const lowestSole = _legL.soleY < _legR.soleY ? _legL.soleY : _legR.soleY;
  const groundFix = _cl(-lowestSole, -0.026 * sprint, 0.14) * (1 - air);
  pelY += groundFix;
  _legL.hipY += groundFix; _legL.kneeY += groundFix; _legL.ankY += groundFix;
  _legR.hipY += groundFix; _legR.kneeY += groundFix; _legR.ankY += groundFix;

  // Bone 0: Pelvis
  _writeBone(out, 0, _mPel, 0, 0.900, 0.010, pelX, pelY, pelZ);

  // Bones 9..14 + Patella (16,17) + Toe (18,19)
  for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
    const isR = sideIdx === 1;
    const s = isR ? 1 : -1;
    const leg = isR ? _legR : _legL;
    const baseB = isR ? 12 : 9;
    const patB = isR ? 17 : 16;
    const toeB = isR ? 19 : 18;
    const bHipX = s * 0.122, bHipY = 0.895, bHipZ = 0.012;
    const bKneeX = s * 0.130, bKneeY = 0.500, bKneeZ = 0.006;
    const bAnkX = s * 0.130, bAnkY = 0.115, bAnkZ = 0.014;

    _euler3(_mHip, leg.hx, leg.hy, leg.hz);
    _mul3(_mThigh, _mPel, _mHip);
    _writeBone(out, baseB, _mThigh, bHipX, bHipY, bHipZ, leg.hipX, leg.hipY, leg.hipZ);

    _mulRx3(_mShin, _mThigh, leg.knee);
    _writeBone(out, baseB + 1, _mShin, bKneeX, bKneeY, bKneeZ, leg.kneeX, leg.kneeY, leg.kneeZ);

    _mulRx3(_mPat, _mThigh, leg.knee * 0.52);
    _writeBone(out, patB, _mPat, bKneeX, bKneeY, bKneeZ, leg.kneeX, leg.kneeY, leg.kneeZ);

    _mulRx3(_mFoot, _mShin, leg.ankle);
    _writeBone(out, baseB + 2, _mFoot, bAnkX, bAnkY, bAnkZ, leg.ankX, leg.ankY, leg.ankZ);

    if (leg.toe > 0.005) {
      _mulRx3(_mToe, _mFoot, leg.toe);
      const bpX = 0, bpY = -0.092, bpZ = -0.055;
      const outToeX = leg.ankX + _mFoot[1] * bpY + _mFoot[2] * bpZ;
      const outToeY = leg.ankY + _mFoot[4] * bpY + _mFoot[5] * bpZ;
      const outToeZ = leg.ankZ + _mFoot[7] * bpY + _mFoot[8] * bpZ;
      _writeBone(out, toeB, _mToe, bAnkX + bpX, bAnkY + bpY, bAnkZ + bpZ, outToeX, outToeY, outToeZ);
    } else {
      _writeBone(out, toeB, _mFoot, bAnkX, bAnkY, bAnkZ, leg.ankX, leg.ankY, leg.ankZ);
    }
  }

  // 4. Upper Body Hierarchical Chain: Lumbar (1) -> Chest (2) -> Neck (3) -> Head (4)
  const flinch = hitMag > 0.001 ? Math.sin(hitMag * Math.PI) * hitMag : 0;
  const breathRaw = Math.abs(exprW) > 0.001 ? exprW : Math.sin(timeSec * 2.55);
  const breath = breathRaw * (0.014 + 0.010 * sprint + 0.010 * tension);

  const lumX = pelX + _mPel[1] * 0.070;
  const lumY = pelY + _mPel[4] * 0.070;
  const lumZ = pelZ + _mPel[7] * 0.070;
  const lumRx = pelPitch + (-0.025 - 0.062 * sprint - 0.10 * crouch + flinch * hitZ * 0.24 + breath * 0.35);
  const lumRy = pelYaw + (-pelYaw * 0.55 + flinch * hitX * 0.20 + headYawOff * 0.06);
  const lumRz = pelRoll + (lean * 0.40 - pelRoll * 0.45 + flinch * hitX * 0.10);
  _euler3(_mLum, lumRx, lumRy, lumRz);
  _writeBone(out, 1, _mLum, 0, 0.970, 0.010, lumX, lumY, lumZ);

  const chsX = lumX + _mLum[1] * 0.180;
  const chsY = lumY + _mLum[4] * 0.180;
  const chsZ = lumZ + _mLum[7] * 0.180;
  const chsRx = lumRx + (aimPitch * 0.34 - 0.03 * aimPose + recX * 0.040 + flinch * hitZ * 0.20 + breath);
  const chsRy = lumRy + (-pelYaw * 0.45 + 0.08 * (1 - sprint) + flinch * hitX * 0.16 + headYawOff * 0.08);
  const chsRz = lumRz + (lean * 0.26 - pelRoll * 0.40);
  _euler3(_mChs, chsRx, chsRy, chsRz);
  const brZ = 1 + breath * 1.15;
  _mChsBr[0] = _mChs[0]; _mChsBr[1] = _mChs[1]; _mChsBr[2] = _mChs[2] * brZ;
  _mChsBr[3] = _mChs[3]; _mChsBr[4] = _mChs[4]; _mChsBr[5] = _mChs[5] * brZ;
  _mChsBr[6] = _mChs[6]; _mChsBr[7] = _mChs[7]; _mChsBr[8] = _mChs[8] * brZ;
  _writeBone(out, 2, _mChsBr, 0, 1.150, 0.010, chsX, chsY, chsZ);

  const nckX = chsX + _mChs[1] * 0.290 + _mChs[2] * (-0.010);
  const nckY = chsY + _mChs[4] * 0.290 + _mChs[5] * (-0.010);
  const nckZ = chsZ + _mChs[7] * 0.290 + _mChs[8] * (-0.010);
  const nckRx = chsRx + (aimPitch * 0.28 - chsRx * 0.42 + flinch * 0.16);
  const nckRy = chsRy + (-chsRy * 0.45 + headYawOff * 0.36);
  const nckRz = chsRz + (-chsRz * 0.40 - headYawOff * 0.06);
  _euler3(_mNck, nckRx, nckRy, nckRz);
  _writeBone(out, 3, _mNck, 0, 1.440, 0, nckX, nckY, nckZ);

  const hedX = nckX + _mNck[1] * 0.095 + _mNck[2] * (-0.008);
  const hedY = nckY + _mNck[4] * 0.095 + _mNck[5] * (-0.008);
  const hedZ = nckZ + _mNck[7] * 0.095 + _mNck[8] * (-0.008);
  const hedRx = nckRx + (aimPitch * 0.38 - nckRx * 0.50 + flinch * 0.20);
  const hedRy = nckRy + (-nckRy * 0.55 + headYawOff * 0.64);
  const hedRz = nckRz + (aimPose * 0.10 - nckRz * 0.50 - headYawOff * 0.10);
  _euler3(_mHed, hedRx, hedRy, hedRz);
  _writeBone(out, 4, _mHed, 0, 1.535, -0.008, hedX, hedY, hedZ);

  // 5. Weapon (15) & 2-Bone Analytical IK Arms (5, 6, 7, 8)
  const lowReady = sprint * (1 - aimPose) * (1 - _cl(recX * 2.5, 0, 1));
  const pump = -cosPh * lowReady;
  const relTilt = Math.sin(reloadF * Math.PI);
  const relSlam = (reloadF > 0.58 && reloadF < 0.78) ? Math.sin((reloadF - 0.58) / 0.20 * Math.PI) : 0;

  const gOffX = -0.030 * aimPose - 0.038 * lowReady + pump * 0.022;
  const gOffY =  0.056 * aimPose - 0.042 * lowReady + recX * 0.016 - relTilt * 0.045 + relSlam * 0.025;
  const gOffZ = -0.018 * aimPose + 0.024 * lowReady + recX * 0.048;
  const gRx = aimPitch * 0.66 - 0.22 * lowReady + recX * 0.14 - relTilt * 0.24 + relSlam * 0.10;
  const gRy = -0.30 * lowReady + pump * 0.08 + recY * recX * 0.035;
  const gRz = 0.08 * aimPose - 0.26 * lowReady + relTilt * 0.42;
  _euler3(_mGun, gRx, gRy, gRz);

  const gpLocX = 0.072 + gOffX, gpLocY = 1.245 + gOffY - 1.150, gpLocZ = -0.255 + gOffZ - 0.010;
  const gunPivotX = chsX + _mChs[0] * gpLocX + _mChs[1] * gpLocY + _mChs[2] * gpLocZ;
  const gunPivotY = chsY + _mChs[3] * gpLocX + _mChs[4] * gpLocY + _mChs[5] * gpLocZ;
  const gunPivotZ = chsZ + _mChs[6] * gpLocX + _mChs[7] * gpLocY + _mChs[8] * gpLocZ;
  _mul3(_mWpn, _mChs, _mGun);
  _writeBone(out, 15, _mWpn, 0.072, 1.245, -0.255, gunPivotX, gunPivotY, gunPivotZ);

  // Hand targets in chest-bind space
  const gCx = 0.072 + gOffX, gCy = 1.245 + gOffY, gCz = -0.255 + gOffZ;
  // bHandR - bGun = (0, -0.075, 0.015)
  const hRx = gCx + _mGun[1] * (-0.075) + _mGun[2] * 0.015;
  const hRy = gCy + _mGun[4] * (-0.075) + _mGun[5] * 0.015;
  const hRz = gCz + _mGun[7] * (-0.075) + _mGun[8] * 0.015;
  // bHandL - bGun = (-0.037, -0.040, -0.140)
  let hLx = gCx + _mGun[0] * (-0.037) + _mGun[1] * (-0.040) + _mGun[2] * (-0.140);
  let hLy = gCy + _mGun[3] * (-0.037) + _mGun[4] * (-0.040) + _mGun[5] * (-0.140);
  let hLz = gCz + _mGun[6] * (-0.037) + _mGun[7] * (-0.040) + _mGun[8] * (-0.140);

  if (reloadF > 0.005) {
    const pX = -0.14, pY = 1.05, pZ = -0.18;
    const mX = gCx + _mGun[1] * (-0.11) + _mGun[2] * (-0.12);
    const mY = gCy + _mGun[4] * (-0.11) + _mGun[5] * (-0.12);
    const mZ = gCz + _mGun[7] * (-0.11) + _mGun[8] * (-0.12);
    const bX = gCx + _mGun[0] * (-0.04) + _mGun[1] * 0.05 + _mGun[2] * (-0.05);
    const bY = gCy + _mGun[3] * (-0.04) + _mGun[4] * 0.05 + _mGun[5] * (-0.05);
    const bZ = gCz + _mGun[6] * (-0.04) + _mGun[7] * 0.05 + _mGun[8] * (-0.05);
    if (reloadF < 0.32) {
      const u = _ss(0, 0.32, reloadF);
      hLx = _mx(hLx, pX, u); hLy = _mx(hLy, pY, u); hLz = _mx(hLz, pZ, u);
    } else if (reloadF < 0.66) {
      const u = _ss(0.32, 0.66, reloadF);
      hLx = _mx(pX, mX, u); hLy = _mx(pY, mY, u); hLz = _mx(pZ, mZ, u);
    } else if (reloadF < 0.84) {
      const u = _ss(0.66, 0.84, reloadF);
      hLx = _mx(mX, bX, u); hLy = _mx(mY, bY, u); hLz = _mx(mZ, bZ, u);
    } else {
      const u = _ss(0.84, 1.0, reloadF);
      hLx = _mx(bX, hLx, u); hLy = _mx(bY, hLy, u); hLz = _mx(bZ, hLz, u);
    }
  }

  const shOffY = 0.014 * aimPose + recX * 0.008;
  const shOffZ = recX * 0.015;

  // Left Arm (bones 5, 6)
  {
    const shX = -0.225, shY = 1.400 + shOffY, shZ = shOffZ;
    let pX = -0.76 + 0.10 * aimPose, pY = -0.68, pZ = 0.22 + 0.15 * relTilt;
    const pl = 1 / (Math.hypot(pX, pY, pZ) || 1); pX *= pl; pY *= pl; pZ *= pl;
    _solveElbowCPU(shX, shY, shZ, hLx, hLy, hLz, _L1_L, _L2_L, pX, pY, pZ);
    const elX = _elbow[0], elY = _elbow[1], elZ = _elbow[2];

    _orientSegmentMat(-0.225, 1.400, 0, -0.210, 1.160, -0.165, -0.82, -0.62, 0.24, shX, shY, shZ, elX, elY, elZ, pX, pY, pZ);
    _mul3(_mArm, _mChs, _mSeg);
    const ox = chsX + _mChs[0] * shX + _mChs[1] * (shY - 1.150) + _mChs[2] * (shZ - 0.010);
    const oy = chsY + _mChs[3] * shX + _mChs[4] * (shY - 1.150) + _mChs[5] * (shZ - 0.010);
    const oz = chsZ + _mChs[6] * shX + _mChs[7] * (shY - 1.150) + _mChs[8] * (shZ - 0.010);
    _writeBone(out, 5, _mArm, -0.225, 1.400, 0, ox, oy, oz);

    _orientSegmentMat(-0.210, 1.160, -0.165, 0.035, 1.205, -0.395, -0.82, -0.62, 0.24, elX, elY, elZ, hLx, hLy, hLz, pX, pY, pZ);
    _mul3(_mArm, _mChs, _mSeg);
    const ex2 = chsX + _mChs[0] * elX + _mChs[1] * (elY - 1.150) + _mChs[2] * (elZ - 0.010);
    const ey2 = chsY + _mChs[3] * elX + _mChs[4] * (elY - 1.150) + _mChs[5] * (elZ - 0.010);
    const ez2 = chsZ + _mChs[6] * elX + _mChs[7] * (elY - 1.150) + _mChs[8] * (elZ - 0.010);
    _writeBone(out, 6, _mArm, -0.210, 1.160, -0.165, ex2, ey2, ez2);
  }

  // Right Arm (bones 7, 8)
  {
    const shX = 0.225, shY = 1.400 + shOffY, shZ = shOffZ;
    let pX = 0.84 - 0.14 * aimPose, pY = -0.56 - 0.12 * aimPose, pZ = 0.34 + 0.12 * lowReady;
    const pl = 1 / (Math.hypot(pX, pY, pZ) || 1); pX *= pl; pY *= pl; pZ *= pl;
    _solveElbowCPU(shX, shY, shZ, hRx, hRy, hRz, _L1_R, _L2_R, pX, pY, pZ);
    const elX = _elbow[0], elY = _elbow[1], elZ = _elbow[2];

    _orientSegmentMat(0.225, 1.400, 0, 0.265, 1.145, -0.065, 0.82, -0.58, 0.32, shX, shY, shZ, elX, elY, elZ, pX, pY, pZ);
    _mul3(_mArm, _mChs, _mSeg);
    const ox = chsX + _mChs[0] * shX + _mChs[1] * (shY - 1.150) + _mChs[2] * (shZ - 0.010);
    const oy = chsY + _mChs[3] * shX + _mChs[4] * (shY - 1.150) + _mChs[5] * (shZ - 0.010);
    const oz = chsZ + _mChs[6] * shX + _mChs[7] * (shY - 1.150) + _mChs[8] * (shZ - 0.010);
    _writeBone(out, 7, _mArm, 0.225, 1.400, 0, ox, oy, oz);

    _orientSegmentMat(0.265, 1.145, -0.065, 0.072, 1.170, -0.240, 0.82, -0.58, 0.32, elX, elY, elZ, hRx, hRy, hRz, pX, pY, pZ);
    _mul3(_mArm, _mChs, _mSeg);
    const ex2 = chsX + _mChs[0] * elX + _mChs[1] * (elY - 1.150) + _mChs[2] * (elZ - 0.010);
    const ey2 = chsY + _mChs[3] * elX + _mChs[4] * (elY - 1.150) + _mChs[5] * (elZ - 0.010);
    const ez2 = chsZ + _mChs[6] * elX + _mChs[7] * (elY - 1.150) + _mChs[8] * (elZ - 0.010);
    _writeBone(out, 8, _mArm, 0.265, 1.145, -0.065, ex2, ey2, ez2);
  }
  return out;
}
