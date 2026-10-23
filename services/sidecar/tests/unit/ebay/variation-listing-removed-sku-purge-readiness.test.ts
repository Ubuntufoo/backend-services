import {describe, expect, it} from 'vitest';
import {summarizeRemovedSkuPurgeReadiness} from '@/ebay/variation-listing-removed-sku-purge-readiness.js';
import type {RemovedSkuPurgeCandidateManifest} from '@/ebay/variation-listing-removed-sku-purge-preview.js';
import type {RemovedSkuOwnershipAudit} from '@/ebay/variation-listing-removed-sku-ownership.js';
import type {RemovedSkuLocalArtifactInventory} from '@/ebay/variation-listing-removed-sku-local-artifacts.js';
const candidate:RemovedSkuPurgeCandidateManifest={
 groupId:'g',revisionId:'r',targetVariationId:'v',targetSku:'sku',
 copies:[{copyId:'c',frontR2Key:'key/front',backR2Key:'key/back',localSourceRefs:['/root/f.jpg','/root/b.jpg']}],
 r2ObjectKeys:['key/front','key/back'],localSourceRefs:['/root/f.jpg','/root/b.jpg'],
 ownershipChecks:[
  {scope:'variation-groups',status:'unverified'},
  {scope:'standard-single-lot',status:'unverified'},
  {scope:'prior-revisions',status:'unverified'},
  {scope:'local-files',status:'unverified'},
  {scope:'r2-objects',status:'unverified'},
 ],requiredChecks:['check ownership'],deletionAuthorized:false,
};
const ownership=():RemovedSkuOwnershipAudit=>({
 groupId:'g',revisionId:'r',targetSku:'sku',databaseChecks:[
 {scope:'variation-groups',status:'clear'},{scope:'standard-single-lot',status:'clear'},{scope:'prior-revisions',status:'clear'}],
 referenceConflicts:[],localFiles:[
  {sourceRef:'/root/f.jpg',status:'present',resolvedPath:'/root/f.jpg',reason:'present'},
  {sourceRef:'/root/b.jpg',status:'present',resolvedPath:'/root/b.jpg',reason:'present'},
 ],r2KeyChecks:[
 {key:'key/front',formatValid:true,status:'present',reason:'present'},
 {key:'key/back',formatValid:true,status:'absent',reason:'absent'}],
 deletionAuthorized:false,outstandingChecks:[],
});
const local=():RemovedSkuLocalArtifactInventory=>({
 scannedConfiguredRootsCompletely:true,configuredRootCount:1,scannedEntryCount:2,
 sourceFiles:[{sourceRef:'/root/f.jpg',resolvedPath:'/root/f.jpg',status:'present',reason:'present'},
 {sourceRef:'/root/b.jpg',resolvedPath:'/root/b.jpg',status:'present',reason:'present'}],
 candidates:[{absolutePath:'/root/f.jpg',rootKind:'incoming',match:'source-reference',status:'present',reason:'present'},
 {absolutePath:'/root/b.jpg',rootKind:'incoming',match:'source-reference',status:'present',reason:'present'}],
 unresolved:[],deletionAuthorized:false,
});
describe('removed-SKU read-only purge readiness',()=>{
 it('reports exact candidates but never authorizes deletion',()=>{
  const result=summarizeRemovedSkuPurgeReadiness({candidate,ownership:ownership(),local:local(),predelete:null});
  expect(result.r2ObjectKeys).toEqual(['key/front','key/back']);
  expect(result.localPaths).toEqual(['/root/f.jpg','/root/b.jpg']);
  expect(result.r2Present).toBe(1);
  expect(result.r2Absent).toBe(1);
  expect(result.deletionAuthorized).toBe(false);
  expect(result.blockers).toContain('No consistent-snapshot database witness was supplied.');
  expect(result.blockers).toContain('At least one frozen R2 object is absent; the candidate resource set is stale.');
 });
 it('rejects inconsistent scope identity or forged deletion permission',()=>{
  expect(()=>summarizeRemovedSkuPurgeReadiness({candidate,ownership:{...ownership(),groupId:'foreign'},local:local(),predelete:null})).toThrow();
  expect(()=>summarizeRemovedSkuPurgeReadiness({candidate,ownership:{...ownership(),deletionAuthorized:true as never},local:local(),predelete:null})).toThrow();
 });
 it('rejects malformed R2 evidence and incomplete local source coverage',()=>{
  const malformed=ownership();
  malformed.r2KeyChecks[0].status='bogus' as never;
  expect(()=>summarizeRemovedSkuPurgeReadiness({candidate,ownership:malformed,local:local(),predelete:null})).toThrow();
  const files=local();
  files.candidates=[];
  const result=summarizeRemovedSkuPurgeReadiness({candidate,ownership:ownership(),local:files,predelete:null});
  expect(result.blockers).toContain('Configured local inventory did not produce exactly one candidate for every frozen source file.');
  expect(result.deletionAuthorized).toBe(false);
  expect(()=>summarizeRemovedSkuPurgeReadiness({candidate:{...candidate,r2ObjectKeys:['other']},ownership:ownership(),local:local(),predelete:null})).toThrow();
  expect(()=>summarizeRemovedSkuPurgeReadiness({candidate:{...candidate,localSourceRefs:['/root/other.jpg']},ownership:ownership(),local:local(),predelete:null})).toThrow();
 });
 it('rejects forged witness safety flags',()=>{
  const predelete={
   witness:{version:1 as const,groupId:'g',revisionId:'r',targetVariationId:'v',targetSku:'sku',
    confirmedRevision:1,desiredRevision:1,capturedDesiredRevision:1,copyIds:['c'],
    r2ObjectKeys:['key/front','key/back'],sourceRefs:['/root/f.jpg','/root/b.jpg'],
    liveVariationReferenceCount:0,standardReferenceCount:0,otherGroupRevisionReferenceCount:0,
    sameGroupHistoricalReferencesVerified:false as const,journalHistoryVerified:false as const,
    referenceSearchComplete:false as const,singleStatementSnapshot:true as const,deletionAuthorized:false as const},
   referenceCountsClear:true,
   deletionAuthorized:false as const,
   blockers:['blocked'],
  };
  expect(()=>summarizeRemovedSkuPurgeReadiness({candidate,ownership:ownership(),local:local(),predelete})).toThrow();
  const staleWitness={...predelete,referenceCountsClear:false as const,
   witness:{...predelete.witness,confirmedRevision:2}};
  expect(()=>summarizeRemovedSkuPurgeReadiness({candidate,ownership:ownership(),local:local(),predelete:staleWitness})).toThrow();
 });
 it('surfaces unresolved local and shared database ownership independently',()=>{
  const data=ownership();data.referenceConflicts=[{scope:'standard-single-lot',owner:'listing:x',resource:'key/front'}];
  data.databaseChecks=[...data.databaseChecks.slice(0,1),{scope:'standard-single-lot',status:'conflict'},...data.databaseChecks.slice(2)];
  const files=local();files.scannedConfiguredRootsCompletely=false;files.unresolved=['ambiguous path'];
  const result=summarizeRemovedSkuPurgeReadiness({candidate,ownership:data,local:files,predelete:null});
  expect(result.databaseReferenceConflicts).toBe(1);
  expect(result.blockers.some(x=>x.includes('shared'))).toBe(true);
  expect(result.blockers.some(x=>x.includes('incomplete'))).toBe(true);
  expect(result.deletionAuthorized).toBe(false);
 });
 it('rejects database conflict evidence that disagrees with scope status',()=>{
  const data=ownership();
  data.referenceConflicts=[{scope:'standard-single-lot',owner:'listing:x',resource:'key/front'}];
  expect(()=>summarizeRemovedSkuPurgeReadiness({candidate,ownership:data,local:local(),predelete:null})).toThrow();
 });
});
