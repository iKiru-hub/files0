import { deflateSync } from 'node:zlib';
export function png(width=200,height=100): Buffer {
  const chunk=(name:string,data:Buffer)=>{
    const body=Buffer.concat([Buffer.from(name),data]);let crc=0xffffffff;
    for(const byte of body) {crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    const out=Buffer.alloc(body.length+8);out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const pixels=Buffer.alloc(height*(width*3+1),140);for(let y=0;y<height;y++)pixels[y*(width*3+1)]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
