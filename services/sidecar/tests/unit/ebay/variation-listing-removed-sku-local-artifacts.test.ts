import {mkdtemp, mkdir, writeFile, symlink, link, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';

import {inventoryRemovedSkuLocalArtifacts} from '@/ebay/variation-listing-removed-sku-local-artifacts.js';
import type {RemovedSkuPurgeCandidateManifest} from '@/ebay/variation-listing-removed-sku-purge-preview.js';

const dirs: string[] = [];
afterEach(async()=>{for(const dir of dirs.splice(0)) await rm(dir,{recursive:true,force:true});});
function candidate(front: string, back: string): RemovedSkuPurgeCandidateManifest {
  return {
    groupId:'g',revisionId:'r',targetVariationId:'v-removed',targetSku:'BSKBL-Remove-000001',
    r2ObjectKeys:['r2/front','r2/back'],
    copies:[{copyId:'copy-removed',frontR2Key:'r2/front',backR2Key:'r2/back',localSourceRefs:[front,back]}],
    localSourceRefs:[front,back],ownershipChecks:[
      {scope:'variation-groups',status:'unverified'},
      {scope:'standard-single-lot',status:'unverified'},
      {scope:'prior-revisions',status:'unverified'},
      {scope:'local-files',status:'unverified'},
      {scope:'r2-objects',status:'unverified'},
    ],deletionAuthorized:false,requiredChecks:['check ownership'],
  };
}

describe('read-only removed SKU local artifact inventory',()=>{
  it('rejects malformed frozen manifests before touching configured roots',async()=>{
    const root=await mkdtemp(join(tmpdir(),'yp-c4-local-'));dirs.push(root);
    const item=candidate(join(root,'front.jpg'),join(root,'back.jpg'));
    item.copies[0]!.localSourceRefs=[item.localSourceRefs[0]!];
    await expect(inventoryRemovedSkuLocalArtifacts({candidate:item,roots:[{kind:'incoming',absolutePath:root}]})).rejects.toThrow(/invalid frozen candidate/);
  });

  it('rejects whitespace identities and forged ownership scopes',async()=>{
    const root=await mkdtemp(join(tmpdir(),'yp-c4-local-'));dirs.push(root);
    const whitespace=candidate(join(root,'front.jpg'),join(root,'back.jpg'));
    whitespace.groupId=' g';
    await expect(inventoryRemovedSkuLocalArtifacts({candidate:whitespace,roots:[{kind:'incoming',absolutePath:root}]})).rejects.toThrow(/invalid frozen candidate/);
    const forged=candidate(join(root,'front.jpg'),join(root,'back.jpg'));
    Object.assign(forged,{ownershipChecks:[{scope:'forged',status:'unverified'} as never, ...forged.ownershipChecks.slice(1)]});
    await expect(inventoryRemovedSkuLocalArtifacts({candidate:forged,roots:[{kind:'incoming',absolutePath:root}]})).rejects.toThrow(/invalid frozen candidate/);
  });

  it('locates original source files and matching staging artifacts without authorizing deletion',async()=>{
    const root=await mkdtemp(join(tmpdir(),'yp-c4-local-'));dirs.push(root);
    const incoming=join(root,'incoming'); const cache=join(root,'cache');
    await mkdir(incoming); await mkdir(cache);
    const front=join(incoming,'front.jpg'), back=join(incoming,'back.jpg');
    await writeFile(front,'front'); await writeFile(back,'back');
    await writeFile(join(cache,'copy-removed-temp.webp'),'cached');
    const result=await inventoryRemovedSkuLocalArtifacts({candidate:candidate(front,back),roots:[{kind:'incoming',absolutePath:incoming},{kind:'cache',absolutePath:cache}]});
    expect(result.deletionAuthorized).toBe(false);
    expect(result.scannedConfiguredRootsCompletely).toBe(true);
    expect(result.candidates.filter(v=>v.match==='source-reference')).toHaveLength(2);
    expect(result.candidates.some(v=>v.match==='identity-in-path')).toBe(true);
  });

  it('never grants deletion for unconfigured or missing source references',async()=>{
    const root=await mkdtemp(join(tmpdir(),'yp-c4-local-'));dirs.push(root);
    const result=await inventoryRemovedSkuLocalArtifacts({candidate:candidate('/unconfigured/front.jpg','/unconfigured/back.jpg'),roots:[{kind:'incoming',absolutePath:root}]});
    expect(result.deletionAuthorized).toBe(false);
    expect(result.sourceFiles.every(v=>v.status==='unverified')).toBe(true);
  });

  it('marks an in-root missing source reference as incomplete',async()=>{
    const root=await mkdtemp(join(tmpdir(),'yp-c4-local-'));dirs.push(root);
    const result=await inventoryRemovedSkuLocalArtifacts({candidate:candidate(join(root,'missing-front.jpg'),join(root,'missing-back.jpg')),roots:[{kind:'incoming',absolutePath:root}]});
    expect(result.sourceFiles.every(v=>v.status==='missing')).toBe(true);
    expect(result.scannedConfiguredRootsCompletely).toBe(false);
    expect(result.unresolved.some(v=>v.includes('Frozen source path'))).toBe(true);
  });

  it('does not match identities embedded in adjacent alphanumeric text',async()=>{
    const root=await mkdtemp(join(tmpdir(),'yp-c4-local-'));dirs.push(root);
    await writeFile(join(root,'prefixBSKBL-Remove-000001suffix.webp'),'false-positive');
    const result=await inventoryRemovedSkuLocalArtifacts({candidate:candidate(join(root,'missing-front.jpg'),join(root,'missing-back.jpg')),roots:[{kind:'cache',absolutePath:root}]});
    expect(result.candidates).toHaveLength(0);
  });

  it('refuses overlapping roots and truncated scans',async()=>{
    const root=await mkdtemp(join(tmpdir(),'yp-c4-local-'));dirs.push(root);
    const nested=join(root,'nested'); await mkdir(nested);
    await writeFile(join(root,'1.jpg'),'1');
    await writeFile(join(root,'2.jpg'),'2');
    const item=candidate(join(root,'1.jpg'),join(root,'2.jpg'));
    await expect(inventoryRemovedSkuLocalArtifacts({candidate:item,roots:[{kind:'incoming',absolutePath:root},{kind:'cache',absolutePath:nested}]})).rejects.toThrow(/overlap/);
    await expect(inventoryRemovedSkuLocalArtifacts({candidate:item,roots:[{kind:'incoming',absolutePath:root}],maxEntries:1})).rejects.toThrow(/entry cap/);
  });

  it('treats symlinks and hardlinks as unresolved ownership',async()=>{
    const root=await mkdtemp(join(tmpdir(),'yp-c4-local-'));dirs.push(root);
    const front=join(root,'front.jpg'), back=join(root,'back.jpg');
    await writeFile(front,'front'); await writeFile(back,'back');
    await link(front,join(root,'front-other.jpg'));
    await symlink(back,join(root,'back-link.jpg'));
    const result=await inventoryRemovedSkuLocalArtifacts({candidate:candidate(front,back),roots:[{kind:'incoming',absolutePath:root}]});
    expect(result.deletionAuthorized).toBe(false);
    expect(result.scannedConfiguredRootsCompletely).toBe(false);
    expect(result.sourceFiles[0]?.status).toBe('shared');
  });

  it('does not traverse a configured-root symlink directory',async()=>{
    const root=await mkdtemp(join(tmpdir(),'yp-c4-local-'));dirs.push(root);
    const outside=await mkdtemp(join(tmpdir(),'yp-c4-outside-'));dirs.push(outside);
    await symlink(outside,join(root,'escape-dir'));
    const result=await inventoryRemovedSkuLocalArtifacts({candidate:candidate(join(root,'missing-front.jpg'),join(root,'missing-back.jpg')),roots:[{kind:'incoming',absolutePath:root}]});
    expect(result.scannedConfiguredRootsCompletely).toBe(false);
    expect(result.unresolved.some(v=>v.includes('symbolic link'))).toBe(true);
  });
});
