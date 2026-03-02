import { run, bench, group } from "mitata";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const _SIN_OVERSAMPLE_FACTOR = 5;
const _SIN_TABLE_OFFSET = 540;
const _SIN_TABLE_BASE_INDEX = _SIN_TABLE_OFFSET * _SIN_OVERSAMPLE_FACTOR;
const _COS_TABLE_BASE_INDEX = (_SIN_TABLE_OFFSET + 90) * _SIN_OVERSAMPLE_FACTOR;
const _SIN_TABLE_SIZE = 1170 * _SIN_OVERSAMPLE_FACTOR;
const _sinTable = new Float64Array(_SIN_TABLE_SIZE + 2);

for (let i = 0; i <= _SIN_TABLE_SIZE; i++) {
  _sinTable[i] = Math.sin((i / _SIN_OVERSAMPLE_FACTOR - _SIN_TABLE_OFFSET) * DEG2RAD);
}
_sinTable[_SIN_TABLE_SIZE + 1] = _sinTable[_SIN_TABLE_SIZE]!;

function tSin(deg: number): number {
  const tableIndex = deg * _SIN_OVERSAMPLE_FACTOR + _SIN_TABLE_BASE_INDEX;
  const tableFloor = tableIndex | 0;
  return _sinTable[tableFloor]! + (tableIndex - tableFloor) * (_sinTable[tableFloor + 1]! - _sinTable[tableFloor]!);
}

function tCos(deg: number): number {
  const tableIndex = deg * _SIN_OVERSAMPLE_FACTOR + _COS_TABLE_BASE_INDEX;
  const tableFloor = tableIndex | 0;
  return _sinTable[tableFloor]! + (tableIndex - tableFloor) * (_sinTable[tableFloor + 1]! - _sinTable[tableFloor]!);
}

const inputs = new Float64Array(10000);
for (let i = 0; i < inputs.length; i++) {
  inputs[i] = (Math.random() * 360) - 180;
}

group("Sin", () => {
  bench("Math.sin(deg * DEG2RAD)", () => {
    let sum = 0;
    for (let i = 0; i < inputs.length; i++) sum += Math.sin(inputs[i] * DEG2RAD);
    return sum;
  });
  bench("tSin(deg) [LUT]", () => {
    let sum = 0;
    for (let i = 0; i < inputs.length; i++) sum += tSin(inputs[i]);
    return sum;
  });
});

group("Cos", () => {
  bench("Math.cos(deg * DEG2RAD)", () => {
    let sum = 0;
    for (let i = 0; i < inputs.length; i++) sum += Math.cos(inputs[i] * DEG2RAD);
    return sum;
  });
  bench("tCos(deg) [LUT]", () => {
    let sum = 0;
    for (let i = 0; i < inputs.length; i++) sum += tCos(inputs[i]);
    return sum;
  });
});

await run();
