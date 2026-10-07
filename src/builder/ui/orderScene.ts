/**
 * One meadow, one renderer. The home is a guest in the unit slot.
 */
import type { GlazeFinish } from '../../three/aura-unit';
import { isPhoneClass, lockPhoneBuilderDpr } from '../../three/quality';
import { mountMeadowWorld } from '../../three/meadow-v1/world';
import type { BuilderDocument } from '../core/document';
import { attachHome, type PlacedHome } from './placeHome';

export type OrderScene = {
  paint: () => void;
  destroy: () => void;
};

export function mountOrderScene(
  element: HTMLElement,
  read: { document: () => BuilderDocument; glaze: () => GlazeFinish },
): OrderScene {
  const phone = isPhoneClass();
  if (phone) lockPhoneBuilderDpr(true);
  let home: PlacedHome | null = null;
  const world = mountMeadowWorld(element, {
    product: true,
    steady: true,
    timeOfDay: 'day',
    density: phone ? 0.45 : 0.65,
    occupyUnit(slot) {
      home = attachHome(slot);
      home.update(read.document(), read.glaze());
      return () => {
        home?.dispose();
        home = null;
      };
    },
    onFrame(frame) {
      home?.tick(frame);
    },
  });
  world.setShot({ p: [6.4, 2.35, 7.6], t: [0.2, 1.25, 0.2], fov: 34 });
  world.setProgress(0.62);
  return {
    paint() {
      home?.update(read.document(), read.glaze());
    },
    destroy() {
      if (phone) lockPhoneBuilderDpr(false);
      world.destroy();
    },
  };
}
