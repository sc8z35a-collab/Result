// NV2 Human — Backward-Compatible Re-Export Shim pointing to NV2.3 HUMAN & NV 2.4 Manusia.
// Legacy NV2 / NV2.3 imports stay 100% compatible while NV 2.4 Manusia flagship classes are exported too.

export {
  NV23_HUMAN_VERSION,
  NV2_HUMAN_VERSION,
  HUMAN_ARCHETYPES,
  CALLSIGN_PROFILES,
  WEAPON_RECOIL_PROFILE,
  PEEK_STYLES,
  COMMS_CHANNELS,
  assignHumanArchetype,
  HumanPsycheV23,
  HumanPerceptionV23,
  HumanOFC_AimV23,
  HumanGazeV23,
  HumanTacticsV23,
  HumanSquadCommsV23,
  HumanMind,
  HumanVisionModel,
  HumanMotorAim,
  HumanGazeDirector,
  HumanCommsRelay
} from './nv23-human.js';

export {
  NV24_MANUSIA_VERSION,
  CALLSIGN_PROFILES_V24,
  COMMS_CHANNELS_V24,
  ManusiaSomaPsycheV24,
  ManusiaTheoryOfMindV24,
  ManusiaPerceptionV24,
  ManusiaNeuromotorAimV24,
  ManusiaGazeV24,
  ManusiaTacticsV24,
  ManusiaSocialSquadV24
} from './nv24-manusia.js';
