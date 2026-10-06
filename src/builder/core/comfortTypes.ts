/**
 * Comfort fields the builder document still carries.
 * The comfort solver and its panel were not brought across.
 */
export interface ComfortTarget {
  winterMinC: number;
  winterMaxC: number;
  summerMinC: number;
  summerMaxC: number;
  humidityMinPct: number;
  humidityMaxPct: number;
  illuminanceMinLux: number;
}

export interface DesignConditions {
  winterIndoorC: number;
  winterRhPct: number;
  summerIndoorC: number;
  summerRhPct: number;
}

export interface ComfortSettings {
  conditions: DesignConditions;
  targets: Readonly<Record<string, ComfortTarget>>;
}

export const DEFAULT_SETTINGS: Readonly<ComfortSettings> = Object.freeze({
  conditions: Object.freeze({
    winterIndoorC: 21,
    winterRhPct: 35,
    summerIndoorC: 24,
    summerRhPct: 50,
  }),
  targets: Object.freeze({}),
});
