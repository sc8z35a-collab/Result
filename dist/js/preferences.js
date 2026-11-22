import {clamp} from './geometry.js';
import {modes, weapons, DEFAULT_LAB_CONFIG, normalizeLabConfig} from './match.js';
import {sizes, qualityLevels, shadowModes} from './renderer.js';
import {AUDIO_MODES} from './audio.js';

const defaultSettings = {
  lightMode: false, resolution: 'HD', graphics: 'high', rate: 360, rateV2: true,
  hdr: true, khdr: true, shadowMode: 'pro', shadows: true,
  fluxGI: true, schlieren: true, aeroVortex: true, thermoFlux: true, resonance: true,
  chronoTrace: true, fermatCore: true, spectraField: true, echoPulse: true,
  autoAim: true, autoAimMode: 'standard',
  audioMode: 'ultra300', audioV2: true, sensitivity: 1, volume: 55, sound: false
};
const uiModes = {'1v1': 1, '3v3': 1, '5v5': 1, lab: 1};
const gameRules = {mode: '3v3', limit: 'points', multiplier: 5, loadout: 'SW T', allyNv21: 0, aiModel: 'human', lab: {...DEFAULT_LAB_CONFIG}};
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const choice = (table, value, fallback) => typeof value === 'string' && Object.hasOwn(table, value) ? value : fallback;
const number = (value, fallback) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function scoreMultiplier(value) {
  return clamp(Math.round(number(value, 5)), 1, 99);
}

export function readPreferences(saved) {
  const stored = record(saved);
  const old = record(stored.settings);
  const settings = {...defaultSettings};
  for (const [key, value] of Object.entries(defaultSettings)) {
    if (typeof value === 'boolean' && typeof old[key] === 'boolean') settings[key] = old[key];
  }
  settings.resolution = choice(sizes, old.resolution, settings.resolution);
  settings.graphics = choice(qualityLevels, old.graphics, settings.graphics);
  settings.shadowMode = choice(shadowModes, old.shadowMode, old.shadows === false ? 'off' : 'pro');
  settings.shadows = settings.shadowMode !== 'off';
  if (!Object.hasOwn(old, 'khdr')) settings.khdr = settings.hdr;
  if (settings.khdr) settings.hdr = true;
  if (old.autoAimMode === '1.5' || old.autoAimMode === 'standard' || old.autoAimMode === 'off') {
    settings.autoAimMode = old.autoAimMode;
    settings.autoAim = settings.autoAimMode !== 'off';
  } else {
    settings.autoAimMode = settings.autoAim ? 'standard' : 'off';
  }
  const rate = number(old.rate, settings.rate);
  if ([0, 60, 120, 360].includes(rate) && !(rate === 120 && !old.rateV2)) settings.rate = rate;
  if (old.audioV2 || old.audioMode !== 'hrtf') settings.audioMode = choice(AUDIO_MODES, old.audioMode, settings.audioMode);
  settings.rateV2 = settings.audioV2 = true;
  settings.sensitivity = clamp(number(old.sensitivity, settings.sensitivity), .4, 2);
  settings.volume = clamp(number(old.volume, settings.volume), 0, 100);

  const value = record(stored.rules);
  const rules = {...gameRules};
  rules.mode = choice(uiModes, value.mode, rules.mode);
  rules.loadout = choice(weapons, value.loadout, rules.loadout);
  rules.limit = value.limit === 'unlimited' ? 'unlimited' : 'points';
  rules.multiplier = scoreMultiplier(value.multiplier);
  rules.allyNv21 = 0;
  rules.aiModel = 'human';
  rules.lab = normalizeLabConfig(value.lab);
  return {settings, rules};
}
