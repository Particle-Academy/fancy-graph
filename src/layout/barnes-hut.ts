/**
 * A Barnes-Hut tree over flat positions: a quadtree in 2D, an octree in 3D.
 * Typed arrays throughout and no per-node allocation, so a rebuild every tick
 * stays cheap at several thousand nodes. Written for this package; nothing
 * third-party.
 */
const MAX_DEPTH = 24;

export class BarnesHutTree {
  private k: number;
  private cap = 0;
  count = 0;
  child = new Int32Array(0);
  body = new Int32Array(0);
  leaf = new Uint8Array(0);
  parent = new Int32Array(0);
  depth = new Uint8Array(0);
  cx = new Float64Array(0);
  cy = new Float64Array(0);
  cz = new Float64Array(0);
  half = new Float64Array(0);
  mass = new Float64Array(0);
  mx = new Float64Array(0);
  my = new Float64Array(0);
  mz = new Float64Array(0);
  /** Bodies sharing a leaf at MAX_DEPTH (coincident nodes), as a linked list. */
  next = new Int32Array(0);

  constructor(private readonly dims: 2 | 3) {
    this.k = dims === 3 ? 8 : 4;
  }

  private grow(min: number) {
    if (min <= this.cap) return;
    const cap = Math.max(min, this.cap * 2, 64);
    const g = <T extends Int32Array | Uint8Array | Float64Array>(a: T, size: number, C: new (n: number) => T): T => {
      const b = new C(size);
      b.set(a);
      return b;
    };
    this.child = g(this.child, cap * this.k, Int32Array);
    this.body = g(this.body, cap, Int32Array);
    this.leaf = g(this.leaf, cap, Uint8Array);
    this.parent = g(this.parent, cap, Int32Array);
    this.depth = g(this.depth, cap, Uint8Array);
    for (const key of ["cx", "cy", "cz", "half", "mass", "mx", "my", "mz"] as const) this[key] = g(this[key], cap, Float64Array);
    this.cap = cap;
  }

  private cell(cx: number, cy: number, cz: number, half: number, parent: number, depth: number): number {
    if (this.count >= this.cap) this.grow(this.count + 1);
    const c = this.count++;
    this.cx[c] = cx;
    this.cy[c] = cy;
    this.cz[c] = cz;
    this.half[c] = half;
    this.parent[c] = parent;
    this.depth[c] = depth;
    this.leaf[c] = 1;
    this.body[c] = -1;
    this.child.fill(-1, c * this.k, c * this.k + this.k);
    return c;
  }

  private octant(c: number, p: Float32Array, i: number): number {
    let o = (p[i * 3] >= this.cx[c] ? 1 : 0) | (p[i * 3 + 1] >= this.cy[c] ? 2 : 0);
    if (this.dims === 3 && p[i * 3 + 2] >= this.cz[c]) o |= 4;
    return o;
  }

  private childCell(c: number, o: number): number {
    const h = this.half[c] / 2;
    const cx = this.cx[c] + (o & 1 ? h : -h);
    const cy = this.cy[c] + (o & 2 ? h : -h);
    const cz = this.dims === 3 ? this.cz[c] + (o & 4 ? h : -h) : 0;
    const id = this.cell(cx, cy, cz, h, c, this.depth[c] + 1);
    this.child[c * this.k + o] = id;
    return id;
  }

  /** Rebuilds the tree over `n` bodies and computes each cell's mass and centre of mass. */
  build(p: Float32Array, n: number, weight?: Float64Array) {
    this.count = 0;
    if (this.next.length < n) this.next = new Int32Array(n);
    this.next.fill(-1, 0, n);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!n) return;
    const half = Math.max(1, maxX - minX, maxY - minY, this.dims === 3 ? maxZ - minZ : 0) / 2 + 1e-3;
    this.grow(n * 2 + 1);
    this.cell((minX + maxX) / 2, (minY + maxY) / 2, this.dims === 3 ? (minZ + maxZ) / 2 : 0, half, -1, 0);

    for (let i = 0; i < n; i++) {
      let c = 0;
      for (;;) {
        if (this.leaf[c]) {
          const b = this.body[c];
          if (b < 0) {
            this.body[c] = i;
            break;
          }
          if (this.depth[c] >= MAX_DEPTH) {
            this.next[i] = this.next[b];
            this.next[b] = i;
            break;
          }
          // Split: push the resident body down one level, then keep descending with i.
          this.leaf[c] = 0;
          this.body[c] = -1;
          const ob = this.octant(c, p, b);
          const nc = this.childCell(c, ob);
          this.body[nc] = b;
          // b may carry a chain of coincident bodies; they move together.
          continue;
        }
        const o = this.octant(c, p, i);
        const ch = this.child[c * this.k + o];
        if (ch < 0) {
          const nc = this.childCell(c, o);
          this.body[nc] = i;
          break;
        }
        c = ch;
      }
    }

    // Cells are created after their parent, so a reverse sweep accumulates bottom-up.
    this.mass.fill(0, 0, this.count);
    this.mx.fill(0, 0, this.count);
    this.my.fill(0, 0, this.count);
    this.mz.fill(0, 0, this.count);
    for (let c = this.count - 1; c >= 0; c--) {
      if (this.leaf[c]) {
        for (let b = this.body[c]; b >= 0; b = this.next[b]) {
          const w = weight ? weight[b] : 1;
          this.mass[c] += w;
          this.mx[c] += p[b * 3] * w;
          this.my[c] += p[b * 3 + 1] * w;
          this.mz[c] += p[b * 3 + 2] * w;
        }
      }
      const par = this.parent[c];
      if (par >= 0) {
        this.mass[par] += this.mass[c];
        this.mx[par] += this.mx[c];
        this.my[par] += this.my[c];
        this.mz[par] += this.mz[c];
      }
    }
  }

  get arity() {
    return this.k;
  }
}
