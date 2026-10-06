import { useEffect, useRef, useState } from 'react';
import StillScene from './StillScene';
import { onQuality, qualityProfile } from '../three/quality';
import { FLYOVER_SPLINE, mountMeadowWorld, type MeadowHandle, type MeadowShot, type TimeOfDay } from '../three/meadow-v1/world';

const SHOTS: Record<string, MeadowShot> = {
  'use:A room': { p: [6.8, 2.8, 12.4], t: [0.2, 2.0, 1.4], fov: 38 },
  'use:Glass on piles': { p: [4.2, 2.2, 9.6], t: [2.2, 1.2, 4.6], fov: 36 },
  'use:A farm wall': { p: [-8.2, 2.6, 8.4], t: [-0.4, 2.2, 0.6], fov: 40 },
  'use:Water from the air': { p: [3.4, 7.2, 12.8], t: [0.6, 3.4, 0.2], fov: 34 },
  'glass:Clear': { p: [0.4, 2.1, 11.2], t: [0, 2.2, 0], fov: 36 },
  'glass:Mirror': { p: [7.6, 2.4, 8.8], t: [0.2, 2.0, 1.2], fov: 38 },
  'glass:Tinted': { p: [2.8, 1.7, 9.4], t: [0, 2.0, 0.4], fov: 40 },
  'length:20 ft': { p: [4.2, 2.2, 8.6], t: [0, 1.8, 0.8], fov: 42 },
  'length:28 ft': { p: [7.2, 3.2, 12.6], t: [0, 1.9, 1.0], fov: 38 },
  'length:36 ft': { p: [10.4, 4.6, 16.8], t: [0, 2.0, 1.0], fov: 34 },
};

/** The builder fly-over. One host element, drawn by the shared stage. */
export default function StoryCanvas({
  progressRef,
  reduced,
  night = false,
  shotKey = null,
}: {
  progressRef: React.MutableRefObject<number>;
  reduced: boolean;
  night?: boolean;
  shotKey?: string | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<MeadowHandle | null>(null);
  const [off, setOff] = useState(() => qualityProfile().tier === 'off');

  useEffect(() => onQuality((profile) => setOff(profile.tier === 'off')), []);

  useEffect(() => {
    const el = host.current;
    if (!el || off) return;
    const world = mountMeadowWorld(el, {
      spline: FLYOVER_SPLINE,
      timeOfDay: night ? 'night' : 'scroll',
      density: 1,
      intro: !reduced,
      reducedShot: reduced,
      readProgress: () => Math.min(1, Math.max(0, progressRef.current / 6)),
      hdri: '/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr',
      hdriPinned: true,
      hdriNight: '/hdri/rogland_clear_night_1k.hdr',
    });
    handle.current = world;
    if (shotKey && SHOTS[shotKey]) world.setShot(SHOTS[shotKey]);
    return () => {
      world.destroy();
      handle.current = null;
    };
    // Night and the option shots update the live world. Remounting would rebuild the meadow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [off, reduced]);

  useEffect(() => {
    const next: TimeOfDay = night ? 'night' : 'scroll';
    handle.current?.setTimeOfDay(next);
  }, [night]);

  useEffect(() => {
    handle.current?.setShot(shotKey && SHOTS[shotKey] ? SHOTS[shotKey] : null);
  }, [shotKey]);

  if (off) return <StillScene />;

  return <div ref={host} className="b-world" aria-hidden="true" />;
}
