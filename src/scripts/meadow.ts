import { holdPageMotion, prefersReducedMotion } from './motion';
import { hideStill, onQuality, qualityProfile, showStill } from '../three/quality';
import type { StageTone } from '../three/stage';
import { FAR_SPLINE, GRASS_SPLINE, mountMeadowWorld } from '../three/meadow-v1/world';
import { createAuraUnit, glassOrbit, type AuraUnit, type GlazeFinish } from '../three/aura-unit';
import { createHotTub, createTubPlace, steamOrbit, type HotTub, type TubPlace } from '../three/hot-tub';
import { createSlopePlace, slopeHeight, slopeOrbit } from '../three/slope-place';
import { createSnowfall, type Snowfall } from '../three/fx/snow';

/** Scroll-driven passage worlds. The stage draws them. */

type SceneKey = 'grass' | 'glass' | 'steam' | 'far' | 'snow' | 'slope';

const KEYS: SceneKey[] = ['grass', 'glass', 'steam', 'far', 'snow', 'slope'];

function sceneKey(canvas: HTMLCanvasElement): SceneKey {
  const key = canvas.dataset.scene as SceneKey;
  return KEYS.includes(key) ? key : 'grass';
}

const LOOK: Record<SceneKey, { exposure: number; tone: StageTone; hdri: string; env: number; ao: boolean }> = {
  grass: { exposure: 1.06, tone: 'agx', hdri: '/hdri/evening_meadow_1k.hdr', env: 0.42, ao: false },
  far: { exposure: 1, tone: 'agx', hdri: '/hdri/qwantani_dusk_2_puresky_1k.hdr', env: 0.55, ao: true },
  slope: { exposure: 1.02, tone: 'agx', hdri: '/hdri/alps_field_1k.hdr', env: 0.7, ao: true },
  snow: { exposure: 1.05, tone: 'agx', hdri: '/hdri/snowy_field_1k.hdr', env: 0.85, ao: true },
  glass: { exposure: 1, tone: 'neutral', hdri: '/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr', env: 1, ao: true },
  steam: { exposure: 1.08, tone: 'agx', hdri: '/hdri/qwantani_dusk_2_puresky_1k.hdr', env: 0.2, ao: true },
};

/** Absolute heights. The camera closes on the frosted room, then the tub beside it. */
const SNOW_SPLINE = [
  { p: [2.6, 2.7, 13.2] as [number, number, number], t: [2.4, 1.25, 2.6] as [number, number, number], fov: 38 },
  { p: [1.2, 2.3, 9.2] as [number, number, number], t: [1.8, 1.2, 1.6] as [number, number, number], fov: 34 },
  { p: [-0.2, 1.85, 6.2] as [number, number, number], t: [1.1, 1.15, 0.4] as [number, number, number], fov: 32 },
];

function bindGlaze(canvas: HTMLCanvasElement, unit: AuraUnit) {
  const doc = canvas.ownerDocument;
  const apply = (value: string, seconds: number) => {
    if (value === 'clear' || value === 'mirror' || value === 'tinted') unit.setFinish(value as GlazeFinish, seconds);
  };
  const onChange = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.name !== 'glazing') return;
    if (!input.closest('.materials-swatches')) return;
    apply(input.value, prefersReducedMotion() ? 0 : 1.2);
  };
  doc.addEventListener('change', onChange);
  const checked = doc.querySelector<HTMLInputElement>('.materials-swatches input[name="glazing"]:checked');
  if (checked) apply(checked.value, 0);
  return () => doc.removeEventListener('change', onChange);
}

function mountMeadowNow(canvas: HTMLCanvasElement, readProgress: () => number) {
  const key = sceneKey(canvas);
  canvas.dataset.sceneLive = key;
  const look = LOOK[key];
  const hand = (world: ReturnType<typeof mountMeadowWorld>, extra?: () => void) => {
    world.setProgress(readProgress());
    return {
      setProgress(t: number) {
        world.setProgress(t);
      },
      destroy() {
        extra?.();
        world.destroy();
      },
    };
  };

  if (key === 'grass') {
    const world = mountMeadowWorld(canvas, {
      spline: GRASS_SPLINE,
      timeOfDay: 'day',
      density: 1,
      grade: 'golden',
      exposure: look.exposure,
      tone: look.tone,
      hdri: look.hdri,
      hdriPinned: true,
      envIntensity: look.env,
      ao: false,
      shadow: 'soft',
      bloom: { threshold: 0.8, intensity: 0.28 },
      godrays: true,
      flare: true,
    });
    return hand(world);
  }

  if (key === 'far') {
    let unit: AuraUnit | null = null;
    let tub: HotTub | null = null;
    const world = mountMeadowWorld(canvas, {
      spline: FAR_SPLINE,
      timeOfDay: 'scroll',
      density: 1,
      nightScroll: true,
      vista: true,
      exposure: look.exposure,
      tone: look.tone,
      hdri: look.hdri,
      hdriPinned: true,
      hdriNight: '/hdri/rogland_clear_night_1k.hdr',
      envIntensity: look.env,
      ao: true,
      shadow: 'soft',
      bloom: { threshold: 0.9, intensity: 0.42 },
      steady: true,
      occupyUnit(slot) {
        const next = createAuraUnit({ rising: true });
        unit = next;
        slot.add(next.object);
        return () => {
          next.dispose();
          if (unit === next) unit = null;
        };
      },
      occupyTub(slot) {
        const next = createHotTub();
        tub = next;
        slot.add(next.object);
        return () => {
          next.dispose();
          if (tub === next) tub = null;
        };
      },
      onFrame(info) {
        unit?.setMood(info.night);
        tub?.update(info);
      },
    });
    return hand(world);
  }

  if (key === 'glass') {
    let stopGlaze = () => {};
    const world = mountMeadowWorld(canvas, {
      spline: glassOrbit(),
      timeOfDay: 'day',
      density: 1,
      exposure: look.exposure,
      tone: look.tone,
      hdri: look.hdri,
      hdriPinned: true,
      envIntensity: look.env,
      ao: true,
      product: true,
      occupyUnit(slot) {
        stopGlaze();
        const unit = createAuraUnit();
        slot.add(unit.object);
        const asked = new URLSearchParams(window.location.search).get('glaze');
        if (asked === 'clear' || asked === 'mirror' || asked === 'tinted') unit.setFinish(asked, 0);
        stopGlaze = bindGlaze(canvas, unit);
        return () => {
          stopGlaze();
          stopGlaze = () => {};
          unit.dispose();
        };
      },
    });
    return hand(world, () => stopGlaze());
  }

  if (key === 'steam') {
    let place: TubPlace | null = null;
    const world = mountMeadowWorld(canvas, {
      spline: steamOrbit(),
      timeOfDay: 'dusk',
      density: 1,
      exposure: 1.02,
      tone: look.tone,
      hdri: look.hdri,
      hdriPinned: true,
      envIntensity: 0.72,
      ao: true,
      shadow: 'soft',
      bloom: { threshold: 0.9, intensity: 0.42 },
      steady: true,
      occupyUnit(slot) {
        const unit = createAuraUnit();
        slot.add(unit.object);
        return () => unit.dispose();
      },
      occupyTub(slot) {
        place?.dispose();
        place = createTubPlace();
        slot.add(place.object);
        const current = place;
        return () => {
          current.dispose();
          if (place === current) place = null;
        };
      },
      onFrame(info) {
        place?.update(info);
      },
    });
    return hand(world);
  }

  if (key === 'slope') {
    const world = mountMeadowWorld(canvas, {
      spline: slopeOrbit(),
      timeOfDay: 'day',
      density: 1,
      vista: true,
      meadow: false,
      ground: 'rock',
      heightAt: slopeHeight,
      clear: { x: 0, z: -7, r: 4.2 },
      exposure: look.exposure,
      tone: look.tone,
      hdri: look.hdri,
      hdriPinned: true,
      envIntensity: look.env,
      ao: true,
      shadow: 'soft',
      bloom: { threshold: 0.9, intensity: 0.28 },
      steady: true,
      occupyUnit(slot) {
        const parent = slot.parent;
        if (!parent) return;
        const place = createSlopePlace();
        parent.add(place.object);
        return () => place.dispose();
      },
    });
    return hand(world);
  }

  let unit: AuraUnit | null = null;
  let tub: HotTub | null = null;
  let fall: Snowfall | null = null;
  const world = mountMeadowWorld(canvas, {
    spline: SNOW_SPLINE,
    timeOfDay: 'day',
    density: 1,
    vista: true,
    meadow: false,
    ground: 'snow',
    exposure: look.exposure,
    tone: look.tone,
    hdri: look.hdri,
    hdriPinned: true,
    envIntensity: look.env,
    ao: true,
    shadow: 'soft',
    bloom: { threshold: 0.9, intensity: 0.36 },
    steady: true,
    occupyUnit(slot) {
      const next = createAuraUnit({ frost: true });
      next.setMood(0.72);
      unit = next;
      slot.add(next.object);
      const parent = slot.parent;
      const snow = parent ? createSnowfall(parent) : null;
      fall = snow;
      return () => {
        next.dispose();
        snow?.dispose();
        if (unit === next) unit = null;
        if (fall === snow) fall = null;
      };
    },
    occupyTub(slot) {
      const next = createHotTub();
      tub = next;
      slot.add(next.object);
      return () => {
        next.dispose();
        if (tub === next) tub = null;
      };
    },
    onFrame(info) {
      unit?.setMood(Math.max(0.72, info.night));
      tub?.update({ camera: info.camera, renderer: info.renderer, dusk: 0.75, night: 0, reduced: info.reduced });
      fall?.update(info);
    },
  });
  return hand(world);
}

export function mountMeadow(canvas: HTMLCanvasElement) {
  let dead = false;
  let inner: ReturnType<typeof mountMeadowNow> | null = null;
  let progress = 0;

  const boot = () => {
    if (dead || inner) return;
    if (qualityProfile().tier === 'off') {
      showStill(canvas);
      return;
    }
    hideStill(canvas);
    inner = mountMeadowNow(canvas, () => progress);
  };

  const stop = onQuality((next) => {
    if (dead) return;
    if (next.tier === 'off') {
      inner?.destroy();
      inner = null;
      showStill(canvas);
      return;
    }
    if (!inner) boot();
  });

  boot();

  const api = {
    setProgress(t: number) {
      progress = t;
      inner?.setProgress(t);
    },
    destroy() {
      if (dead) return;
      dead = true;
      stop();
      inner?.destroy();
      inner = null;
    },
  };
  holdPageMotion(api.destroy);
  return api;
}
