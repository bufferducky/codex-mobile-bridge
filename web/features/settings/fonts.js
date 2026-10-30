'use strict';
// Font bytes stay in this browser's IndexedDB. Binary FontFace input avoids
// remote URLs and needs no change to the gateway's Content Security Policy.
const BridgeFontLibrary=(()=>{
  const MAX_BYTES=20*1024*1024;
  function validate(buffer){
    if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<12||buffer.byteLength>MAX_BYTES)throw Error('字体文件无效或超过 20 MiB');
    const bytes=new Uint8Array(buffer),tag=String.fromCharCode(...bytes.slice(0,4));
    if(!(bytes[0]===0&&bytes[1]===1&&bytes[2]===0&&bytes[3]===0)&&!['OTTO','true','wOFF','wOF2'].includes(tag))throw Error('请选择有效的 TTF、OTF、WOFF 或 WOFF2 字体');
    return buffer;
  }
  class Store {
    constructor(idb=globalThis.indexedDB){this.idb=idb;}
    async transaction(mode,action){
      if(!this.idb)throw Error('当前环境无法保存自定义字体');
      const db=await new Promise((resolve,reject)=>{
        const req=this.idb.open('bridge-reading-fonts',1);
        req.onupgradeneeded=()=>req.result.createObjectStore('fonts');
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      try{return await new Promise((resolve,reject)=>{
        const tx=db.transaction('fonts',mode),req=action(tx.objectStore('fonts'));
        tx.oncomplete=()=>resolve(req.result);tx.onerror=tx.onabort=()=>reject(tx.error||Error('字体保存失败'));
      });}finally{db.close();}
    }
    read(slot){return this.transaction('readonly',store=>store.get(slot));}
    write(slot,value){return this.transaction('readwrite',store=>store.put(value,slot));}
    remove(slot){return this.transaction('readwrite',store=>store.delete(slot));}
  }
  class Library {
    constructor({store=new Store(),Font=globalThis.FontFace,fonts=globalThis.document?.fonts}={}){Object.assign(this,{store,Font,fonts});this.faces=new Map();this.revisions=new Map();}
    next(slot){if(!['body','code'].includes(slot))throw Error('无效的字体类型');const revision=(this.revisions.get(slot)||0)+1;this.revisions.set(slot,revision);return revision;}
    async install(slot,record,persist,revision){
      if(!record)return null;
      validate(record.buffer);
      const face=await new this.Font(slot==='body'?'BridgeCustomBody':'BridgeCustomCode',record.buffer).load();
      if(this.revisions.get(slot)!==revision)return null;
      if(persist)await this.store.write(slot,record);
      if(this.revisions.get(slot)!==revision)return null;
      const previous=this.faces.get(slot);this.fonts.add(face);if(previous)this.fonts.delete(previous);
      this.faces.set(slot,face);return {name:record.name,family:face.family};
    }
    async restore(slot){const revision=this.next(slot),record=await this.store.read(slot);if(this.revisions.get(slot)!==revision)return null;return this.install(slot,record,false,revision);}
    async import(slot,file){
      const revision=this.next(slot);
      if(!file||!Number.isFinite(file.size)||file.size>MAX_BYTES)throw Error('字体文件无效或超过 20 MiB');
      const buffer=validate(await file.arrayBuffer());
      if(this.revisions.get(slot)!==revision)return null;
      return this.install(slot,{name:String(file.name||'').slice(0,200),buffer},true,revision);
    }
    async remove(slot){this.next(slot);await this.store.remove(slot);const face=this.faces.get(slot);if(face)this.fonts.delete(face);this.faces.delete(slot);}
  }
  return {MAX_BYTES,validate,Store,Library};
})();
if(typeof module==='object'&&module.exports)module.exports=BridgeFontLibrary;
