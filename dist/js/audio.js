// Sound Engin 1.0 — Public Audio Bridge & Backward-Compatible PortAudio Export
export {
  SoundEngin,
  SoundEngin as PortAudio,
  SOUND_ENGIN_VERSION,
  SPEED_OF_SOUND,
  AUDIO_MODES,
  computePropagationDelay,
  computeAirAbsorption,
  computeDopplerShift,
  computeAcousticPath,
  traceEarlyReflections,
  estimateEnclosure,
  synthesizeWaveShaperCurve,
  createGunImpulseSamples,
  generateHarborIR
} from './sound-engin.js';
