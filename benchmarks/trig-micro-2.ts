import { run, bench, group } from "mitata";

const RAD2DEG = 180 / Math.PI;

const _ACOS_TABLE_HALF_SIZE = 4096;
const _ACOS_TABLE_SIZE = _ACOS_TABLE_HALF_SIZE * 2;
const _acosTable = new Float64Array(_ACOS_TABLE_SIZE + 2);
for (let i = 0; i <= _ACOS_TABLE_SIZE; i++) {
  _acosTable[i] = Math.acos(i / _ACOS_TABLE_HALF_SIZE - 1) * RAD2DEG;
}
_acosTable[_ACOS_TABLE_SIZE + 1] = _acosTable[_ACOS_TABLE_SIZE]!;

function tAcos(x: number): number {
  const clampedX = Math.max(-1, Math.min(1, x));
  const tableIndex = (clampedX + 1) * _ACOS_TABLE_HALF_SIZE;
  const tableFloor = tableIndex | 0;
  return _acosTable[tableFloor]! + (tableIndex - tableFloor) * (_acosTable[tableFloor + 1]! - _acosTable[tableFloor]!);
}

const inputsAcos = new Float64Array(10000);
for (let i = 0; i < inputsAcos.length; i++) {
  inputsAcos[i] = (Math.random() * 2) - 1;
}

group("Acos", () => {
  bench("Math.acos(x) * RAD2DEG", () => {
    let sum = 0;
    for (let i = 0; i < inputsAcos.length; i++) sum += Math.acos(inputsAcos[i]) * RAD2DEG;
    return sum;
  });
  bench("tAcos(x) [LUT]", () => {
    let sum = 0;
    for (let i = 0; i < inputsAcos.length; i++) sum += tAcos(inputsAcos[i]);
    return sum;
  });
});

await run();
