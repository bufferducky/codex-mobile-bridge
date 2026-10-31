'use strict';
// Usage: CMB_UPDATE_SIGNING_KEY=<PEM> node scripts/sign-update.cjs <artifact-dir> <notes-file>
// The private key belongs in a release secret, never in the repository or app.
const fs=require('node:fs'),path=require('node:path');
const {createHash,createPublicKey,sign}=require('node:crypto');
const {assetName}=require('../desktop/features/updates/updater.cjs');
const {writeChecksums,releaseTargets}=require('./release-assets.cjs');
const root=path.resolve(__dirname,'..');
function buildManifest(directory,notes,key,{profile='full'}={}){
  const version=require('../package.json').version;
  const trusted=fs.readFileSync(path.join(root,'desktop/features/updates/fork-update-public-key.pem'),'utf8');
  if(createPublicKey(key).export({type:'spki',format:'pem'})!==trusted)throw Error('Signing key does not match the public key shipped in this release.');
  const assets={};
  for(const [platform,arch] of releaseTargets(profile)){
    const name=assetName(version,platform,arch),bytes=fs.readFileSync(path.join(directory,name));
    assets[`${platform}-${arch}`]={name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  const payload=Buffer.from(JSON.stringify({schema:1,version,notes,assets}));
  return JSON.stringify({payload:payload.toString('base64'),signature:sign(null,payload,key).toString('base64')})+'\n';
}
if(require.main===module){
  const [directory,notesFile,profileFlag]=process.argv.slice(2),key=process.env.CMB_UPDATE_SIGNING_KEY;
  if(!directory||!notesFile||!key)throw Error('Artifact directory, notes file and CMB_UPDATE_SIGNING_KEY are required.');
  if(profileFlag&&!/^--profile=(full|mac-android)$/.test(profileFlag))throw Error('Invalid release profile.');
  const manifest=buildManifest(directory,fs.readFileSync(notesFile,'utf8'),key,{profile:profileFlag?.slice(10)||'full'});
  fs.writeFileSync(path.join(directory,'bridge-update.json'),manifest);
  writeChecksums(directory);
  console.log('Signed update manifest and checksums created.');
}
module.exports={buildManifest};
