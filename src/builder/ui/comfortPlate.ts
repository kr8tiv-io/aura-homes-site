/** Plate shape the old comfort overlay painted. The solver was not ported. */
export interface ComfortPlate {
  id: string;
  name: string;
  xFt: number;
  zFt: number;
  widthFt: number;
  depthFt: number;
  sPmv: number;
  deviation: number;
  meets: boolean | null;
  modelled: boolean;
}
