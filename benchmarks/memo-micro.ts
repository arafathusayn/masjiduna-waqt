import { run, bench, group } from "mitata";

class V {
  ms: number;
  constructor(ms: number) { this.ms = ms; }
}

class NonMemo {
  o: number;
  constructor(o: number) { this.o = o; }
  get val() { return new V(this.o); }
}

class Memo {
  o: number;
  _v?: V;
  constructor(o: number) { this.o = o; }
  get val() {
    if (this._v) return this._v;
    return this._v = new V(this.o);
  }
}

const N = 1000;
const nonMemoArr = Array.from({ length: N }, (_, i) => new NonMemo(i));
const memoArr = Array.from({ length: N }, (_, i) => new Memo(i));

group("First Access", () => {
  bench("NonMemo (allocate V)", () => {
    let sum = 0;
    for (let i = 0; i < N; i++) sum += nonMemoArr[i].val.ms;
    return sum;
  });
  bench("Memo (allocate V + store)", () => {
    let sum = 0;
    for (let i = 0; i < N; i++) {
        const m = new Memo(i);
        sum += m.val.ms;
    }
    return sum;
  });
});

group("Repeated Access (3x)", () => {
  bench("NonMemo", () => {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const obj = nonMemoArr[i];
      sum += obj.val.ms;
      sum += obj.val.ms;
      sum += obj.val.ms;
    }
    return sum;
  });
  bench("Memo", () => {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const obj = memoArr[i];
      sum += obj.val.ms;
      sum += obj.val.ms;
      sum += obj.val.ms;
    }
    return sum;
  });
});

await run();
