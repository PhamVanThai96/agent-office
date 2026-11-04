// The backdrop: Agent Office keeps only the city (the countryside and beach of my-office were removed to keep the page light).
import * as THREE from 'three';
import { state } from '../../core/state.js';
import { scene } from '../../scene/renderer.js';
import { buildCity } from './city.js';
import { cityDay, cityNight, viewTex } from '../windows.js';
import { isNightHour, night, setNight } from '../room-update.js';
import { buildGrid, fp } from '../../interact/first-person.js';
import { t as tr } from '../../../i18n/index.js';

export let THEMES;
export let THEME;
export function setScene(name, apply = true) {
  const t = THEMES[name] || THEMES.city;
  if (!t.group) { t.group = new THREE.Group(); t.group.userData.noMerge = true; scene.add(t.group); t.live = t.build(t.group); t.live.night(night); }
  if (!t.wins) t.wins = [viewTex(t.view, false), viewTex(t.view, true)];
  for (const x of Object.values(THEMES)) if (x.group) x.group.visible = x === t;
  THEME = t;
  for (const b of document.querySelectorAll('[data-scene]')) b.setAttribute('aria-pressed', String(b.dataset.scene === name));
  if (fp.grid) fp.grid = buildGrid();
  if (apply) setNight(night);
}

export function setup() {
  /* ---------- backdrop: city / countryside / beach ---------- */
  THEMES = {
    city: { label: tr('world.scene.city'), build: buildCity, fog: ['#CCD8E4', '#16223E'], wins: [cityDay, cityNight] },
  };
  THEME = THEMES.city;
  setScene('city', false);
  if (!state.nightManual) setNight(isNightHour()); else setNight(night);
  setInterval(() => { if (!state.nightManual && night !== isNightHour()) setNight(isNightHour()); }, 1000);   // (the clock chip and the Mac's readings: ui/ticks.js)
}
