// server/src/heightfield.ts
import { readFileSync } from "fs";

export class HeightField {
  N: number; minX: number; maxX: number; minZ: number; maxZ: number; ymin: number; ymax: number;
  data: Uint16Array;
  constructor(binPath: string, metaPath: string) {
    //const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    //Object.assign(this, meta);
    //const buf = readFileSync(binPath);
    //this.data = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength/2);
    this.data = new Uint16Array(1000*1000);
    for (let i=500-50; i<500+50; i++) {
      for (let j=500-50; j<500+50; j++) {
        this.data[i*1000 + j] = 65535;
      }
    }
    this.N=1000; this.minX=-50; this.maxX=50; this.minZ=-50; this.maxZ=50; this.ymin=0.9; this.ymax=10;
  }
 
  // bilinear
  H(x: number, z: number): number {
    const {N,minX,maxX,minZ,maxZ,ymin,ymax,data} = this;
    const u = (x - minX) / (maxX - minX);
    const v = (z - minZ) / (maxZ - minZ);
    const fx = Math.max(0, Math.min(N-1, u * (N-1)));
    const fz = Math.max(0, Math.min(N-1, v * (N-1)));
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const x1 = Math.min(N-1, x0+1), z1 = Math.min(N-1, z0+1);
    const tx = fx - x0, tz = fz - z0;

    const idx = (zz: number, xx: number) => data[zz*N + xx] / 65535;
    const h00 = idx(z0,x0), h10 = idx(z0,x1);
    const h01 = idx(z1,x0), h11 = idx(z1,x1);
    const h0 = h00*(1-tx) + h10*tx;
    const h1 = h01*(1-tx) + h11*tx;
    const h = h0*(1-tz) + h1*tz;
    return ymin + h * (ymax - ymin);
  }
}
