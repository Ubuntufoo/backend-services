import express from 'express';
import request from 'supertest';
import {describe, expect, it, vi} from 'vitest';
import type {AuthenticatedRequest} from '@/auth/oauth-middleware.js';
import type {RemovedSkuPurgeReadiness} from '@/ebay/variation-listing-removed-sku-purge-readiness.js';
import {createVariationListingApiRouter} from '@/http/variation-listing-router.js';

const groupId='11111111-1111-4111-8111-111111111111';
const revisionId='22222222-2222-4222-8222-222222222222';

function app(preview: (groupId: string, revisionId: string) => Promise<RemovedSkuPurgeReadiness | null>, authenticated = false) {
  const server=express();
  server.use(express.json());
  if (authenticated) {
    server.use((req, _res, next) => {
      (req as AuthenticatedRequest).auth = {token: 'test', clientId: 'test', scopes: []};
      next();
    });
  }
  server.use('/api/variation-listings',createVariationListingApiRouter({readRemovedSkuPurgePreview:preview}));
  return server;
}
const path=`/api/variation-listings/${groupId}/removed-sku-purge-preview/${revisionId}`;
describe('GET removed-SKU cleanup preview — no mutation',()=>{
 it('returns only a non-authorizing preview and no-store cache control',async()=>{
  const preview=vi.fn().mockResolvedValue({kind:'removed_sku_read_only_readiness',groupId,revisionId,targetVariationId:'variation',targetSku:'SKU',r2ObjectKeys:['secret/key'],localPaths:['/secret/path'],r2Present:1,r2Absent:0,r2UnknownOrInaccessible:0,localPresent:1,localUnverifiedOrShared:0,databaseReferenceConflicts:0,databaseWitnessUsed:false,blockers:['no delete permitted'],deletionAuthorized:false});
  const response=await request(app(preview)).get(path);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.deletionAuthorized).toBe(false);
  expect(response.body.r2ObjectKeys).toEqual([]);
  expect(response.body.localPaths).toEqual([]);
  expect(preview).toHaveBeenCalledOnce();
  expect(preview).toHaveBeenCalledWith(groupId,revisionId);
 });
 it('returns resource identities only when OAuth middleware attached req.auth',async()=>{
  const preview=vi.fn().mockResolvedValue({kind:'removed_sku_read_only_readiness',groupId,revisionId,targetVariationId:'variation',targetSku:'SKU',r2ObjectKeys:['secret/key'],localPaths:['/secret/path'],r2Present:1,r2Absent:0,r2UnknownOrInaccessible:0,localPresent:1,localUnverifiedOrShared:0,databaseReferenceConflicts:0,databaseWitnessUsed:false,blockers:[],deletionAuthorized:false});
  const response=await request(app(preview, true)).get(path);
  expect(response.status).toBe(200);
  expect(response.body.r2ObjectKeys).toEqual(['secret/key']);
  expect(response.body.localPaths).toEqual(['/secret/path']);
 });
 it('rejects cross-group and forged authorization',async()=>{
  for(const item of [{groupId:'different',revisionId,deletionAuthorized:false},{groupId,revisionId,deletionAuthorized:true}]) {
   const response=await request(app(async()=>item as unknown as RemovedSkuPurgeReadiness)).get(path);
   expect(response.status).toBe(500);
  }
 });
 it('returns 404 for a missing revision and validates identifiers before access',async()=>{
  expect((await request(app(async()=>null)).get(path)).status).toBe(404);
  const preview=vi.fn();
  expect((await request(app(preview)).get('/api/variation-listings/bad/removed-sku-purge-preview/bad')).status).toBe(400);
  expect(preview).not.toHaveBeenCalled();
 });
 it('does not expose underlying error details',async()=>{
  const preview=vi.fn().mockRejectedValue(new Error('failed while reading /secret/path with key secret/key'));
  const response=await request(app(preview)).get(path);
  expect(response.status).toBe(500);
  expect(response.body).toEqual({error:'server_error',message:'An unexpected server error occurred.'});
 });
});
