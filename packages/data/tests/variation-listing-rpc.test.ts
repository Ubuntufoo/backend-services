import { describe, expect, it, vi } from 'vitest';
import type { SupabaseDataClient } from '../src/index.js';
import { createSupabaseVariationListingTransactionGateway, variationListingJsonSemanticallyEqual } from '../src/index.js';
const clientFor = (fn:string, payload:unknown, onArgs?:(args:Record<string,unknown>)=>void) => ({ from:vi.fn(), rpc:vi.fn((actual:string,args:Record<string,unknown>)=>{ expect(actual).toBe(fn); onArgs?.(args); return { single:vi.fn(()=>Promise.resolve({data:payload,error:null})) }; }) }) as unknown as SupabaseDataClient;
describe('simplified variation RPC gateway',()=>{ it('maps frozen operation plan capture',async()=>{ const digest='a'.repeat(64); const intentDigest='b'.repeat(64); const c=clientFor('capture_variation_listing_revision',{revision:{revision_id:'r',group_id:'g',captured_desired_revision:1,snapshot_version:1,snapshot_digest:digest,snapshot:{},operation_plan:[{sequence_no:1,operation_key:'p',operation_kind:'group_publish',target_ref:'g',intent_version:1,intent_digest:intentDigest,intent:{}}],operation_count:1,captured_at:'now'}}); const r=await createSupabaseVariationListingTransactionGateway(c).captureRevision({groupId:'g',revisionId:'r',capturedDesiredRevision:1,snapshotVersion:1,snapshotDigest:digest,snapshot:{},operationPlan:[{sequenceNo:1,operationKey:'p',operationKind:'group_publish',targetRef:'g',intentVersion:1,intentDigest:intentDigest,intent:{}}]}); expect(r.revision.operation_count).toBe(1); }); it('maps append checkpoint args and result',async()=>{ const c=clientFor('append_variation_listing_journal_checkpoint',{checkpoint:{checkpoint_id:'c',revision_id:'r',operation_key:'p',attempt_number:1,checkpoint_number:1,state:'started',observed_remote_state:null,evidence:{},created_at:'now'}}); const r=await createSupabaseVariationListingTransactionGateway(c).appendJournalCheckpoint({revisionId:'r',operationKey:'p',checkpointId:'c',attemptNumber:1,checkpointNumber:1,state:'started',evidence:{}}); expect(r.checkpoint.checkpoint_id).toBe('c'); }); it('maps completion condition and nullable capture time',async()=>{ const group={group_id:'g',group_key:'VL-G-11111111111141118111111111111111',sku_category_code:'BSKBL',sku_bucket_token:'BucketA',category_id:'261328',marketplace_id:'EBAY_US',merchant_location_key:'loc',fulfillment_policy_id:'fulfill',payment_policy_id:'pay',return_policy_id:'return',condition_id:'1000',condition_token:'VERY_GOOD',desired_revision:1,last_confirmed_revision:null,lifecycle_state:'intake',listing_format:'FIXED_PRICE',selector_name:'Card',next_inventory_serial:1,derived_common_ebay_aspects:{},condition_descriptors:[],condition_description:null,description:null,title:null,created_at:'now',updated_at:'now'}; const variation={variation_id:'v',group_id:'g',inventory_serial:1,position:0,sku:'BSKBL-BucketA-000001',selector_value:'Card A',price_amount:1.49,price_currency:'USD',representative_copy_id:'c',variation_metadata:{source:'test'},created_at:'now',updated_at:'now'}; const copy={copy_id:'c',variation_id:'v',condition_token:'EXCELLENT',front_r2_key:'variation-listing/g/v/front-a',back_r2_key:'variation-listing/g/v/back-b',capture_source_key:'camera',capture_pair_id:'p',capture_front_source_ref:'front',capture_back_source_ref:'back',capture_started_at:'now',captured_at:'now',created_at:'now',updated_at:'now',availability_state:'available',condition_notes:null}; const c=clientFor('complete_variation_listing_new_variation',{group_row:group,variation_row:variation,copy_row:copy},args=>expect(args).toMatchObject({p_condition_token:'EXCELLENT',p_captured_at:null})); const result=await createSupabaseVariationListingTransactionGateway(c).completeNewVariation({captureSourceKey:'camera',copyId:'c',variationId:'v',capturePairId:'p',conditionToken:'EXCELLENT',selectorValue:'Card A',variationMetadata:{source:'test'},frontR2Key:copy.front_r2_key,backR2Key:copy.back_r2_key,backSourceRef:'back'}); expect(result.copy.condition_token).toBe('EXCELLENT'); }); });


describe('YP3.3 RPC parity',()=>{
  it('accepts equivalent start timestamps with different offset spelling',async()=>{
    const session={capture_source_key:'camera',mode:'new_variation',target_group_id:'11111111-1111-4111-8111-111111111111',target_variation_id:null,sticky_price_amount:1.49,sticky_price_currency:'USD',pending_pair:{pair_id:'44444444-4444-4444-8444-444444444444',mode:'new_variation',target_group_id:'11111111-1111-4111-8111-111111111111',target_variation_id:null,price_amount:1.49,price_currency:'USD',front_source_ref:'front',started_at:'2026-09-01T05:00:00+00:00',expected_desired_revision:0},created_at:'now',updated_at:'now'};
    const c=clientFor('start_variation_listing_intake_pair',{session_row:session});
    await expect(createSupabaseVariationListingTransactionGateway(c).startIntakePair({captureSourceKey:'camera',pairId:'44444444-4444-4444-8444-444444444444',frontSourceRef:'front',startedAt:'2026-09-01T01:00:00-04:00'})).resolves.toMatchObject({capture_source_key:'camera'});
  });

  it('accepts semantically equal variation metadata with different key order',async()=>{
    const group={group_id:'g',group_key:'VL-G',sku_category_code:'BSKBL',sku_bucket_token:'BucketA',category_id:'261328',marketplace_id:'EBAY_US',merchant_location_key:'loc',fulfillment_policy_id:'fulfill',payment_policy_id:'pay',return_policy_id:'return',condition_id:'1000',condition_token:'VERY_GOOD',desired_revision:1,last_confirmed_revision:null,lifecycle_state:'intake',listing_format:'FIXED_PRICE',selector_name:'Card',next_inventory_serial:2,derived_common_ebay_aspects:{},condition_descriptors:[],condition_description:null,description:null,title:null,created_at:'now',updated_at:'now'};
    const variation={variation_id:'v',group_id:'g',inventory_serial:1,position:0,sku:'BSKBL-BucketA-000001',selector_value:'Card A',price_amount:1.49,price_currency:'USD',representative_copy_id:'c',variation_metadata:{set:'Topps',nested:{b:2,a:1}},created_at:'now',updated_at:'now'};
    const copy={copy_id:'c',variation_id:'v',condition_token:'EXCELLENT',front_r2_key:'front-key',back_r2_key:'back-key',capture_source_key:'camera',capture_pair_id:'p',capture_front_source_ref:'front',capture_back_source_ref:'back',capture_started_at:'2026-09-01T05:00:00Z',captured_at:'2026-09-01T05:01:00Z',created_at:'now',updated_at:'now',availability_state:'available',condition_notes:null};
    const c=clientFor('complete_variation_listing_new_variation',{group_row:group,variation_row:variation,copy_row:copy});
    await expect(createSupabaseVariationListingTransactionGateway(c).completeNewVariation({captureSourceKey:'camera',copyId:'c',variationId:'v',capturePairId:'p',conditionToken:'EXCELLENT',selectorValue:'Card A',variationMetadata:{nested:{a:1,b:2},set:'Topps'},frontR2Key:'front-key',backR2Key:'back-key',backSourceRef:'back'})).resolves.toMatchObject({variation:{variation_id:'v'}});
  });
});

describe('variation listing JSON semantic equality', () => {
  it('ignores recursive object key order', () => {
    expect(
      variationListingJsonSemanticallyEqual(
        { outer: { beta: [{ right: 2, left: 1 }], alpha: true } },
        { outer: { alpha: true, beta: [{ left: 1, right: 2 }] } }
      )
    ).toBe(true);
  });

  it('preserves array order and scalar differences', () => {
    expect(variationListingJsonSemanticallyEqual({ values: [1, 2] }, { values: [2, 1] })).toBe(false);
    expect(variationListingJsonSemanticallyEqual({ value: 1 }, { value: '1' })).toBe(false);
  });

  it('preserves a valid __proto__ JSON key', () => {
    expect(variationListingJsonSemanticallyEqual(JSON.parse('{"__proto__":1}'), {})).toBe(false);
  });
});

describe('YP4.2b group review-draft RPC', () => {
  const group = {
    group_id:'g', group_key:'VL-G', sku_category_code:'BSKBL', sku_bucket_token:'BucketA', category_id:'261328', marketplace_id:'EBAY_US', merchant_location_key:'loc', fulfillment_policy_id:'fulfill', payment_policy_id:'pay', return_policy_id:'return', condition_id:'1000', condition_token:'VERY_GOOD', desired_revision:3, last_confirmed_revision:null, lifecycle_state:'review', listing_format:'FIXED_PRICE', selector_name:'Card', next_inventory_serial:2, derived_common_ebay_aspects:{Manufacturer:'Topps',Year:'2024'}, condition_descriptors:[], condition_description:null, description:'Approved description', title:'Approved title', created_at:'now', updated_at:'now',
  };

  it('maps narrow args and verifies trimmed/parity response with semantic aspects', async () => {
    const aspects = { Year:'2024', Manufacturer:'Topps' };
    const c = clientFor('apply_variation_listing_group_review_draft', { group_row: group }, args => {
      expect(args).toEqual({ p_group_id:'g', p_expected_desired_revision:2, p_title:'Approved title', p_description:'Approved description', p_derived_common_ebay_aspects:aspects });
    });
    await expect(createSupabaseVariationListingTransactionGateway(c).applyGroupReviewDraft({ groupId:'g', expectedDesiredRevision:2, title:'  Approved title ', description:' Approved description ', derivedCommonEbayAspects:{ Manufacturer:'Topps', Year:'2024' } })).resolves.toMatchObject({ group_id:'g', lifecycle_state:'review', desired_revision:3 });
  });

  it('maps VR001 stale-CAS conflicts', async () => {
    const c = { rpc: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data:null, error:{ code:'VR001', message:'stale' } })) })) } as unknown as SupabaseDataClient;
    await expect(createSupabaseVariationListingTransactionGateway(c).applyGroupReviewDraft({ groupId:'g', expectedDesiredRevision:2, title:'Title', description:'Description', derivedCommonEbayAspects:{} })).rejects.toMatchObject({ name:'VariationListingTransactionConflictError', code:'VR001' });
  });
});


describe('YP4.3 manual variation price RPC', () => {
  const group = {
    group_id:'g', group_key:'VL-G', sku_category_code:'BSKBL', sku_bucket_token:'BucketA', category_id:'261328', marketplace_id:'EBAY_US', merchant_location_key:'loc', fulfillment_policy_id:'fulfill', payment_policy_id:'pay', return_policy_id:'return', condition_id:'1000', condition_token:'VERY_GOOD', desired_revision:4, last_confirmed_revision:null, lifecycle_state:'review', listing_format:'FIXED_PRICE', selector_name:'Card', next_inventory_serial:2, derived_common_ebay_aspects:{}, condition_descriptors:[], condition_description:null, description:'Description', title:'Title', created_at:'now', updated_at:'now',
  };
  const variation = {
    variation_id:'v', group_id:'g', inventory_serial:1, position:0, sku:'BSKBL-BucketA-000001', selector_value:'Card A', price_amount:1.99, price_currency:'USD', representative_copy_id:'c', variation_metadata:{}, created_at:'now', updated_at:'now',
  };

  it('maps narrow args and verifies returned group/variation parity', async () => {
    const c = clientFor('update_variation_listing_manual_price', { group_row:group, variation_row:variation }, args => {
      expect(args).toEqual({ p_group_id:'g', p_variation_id:'v', p_expected_desired_revision:3, p_price_amount:1.99 });
    });
    await expect(createSupabaseVariationListingTransactionGateway(c).updateVariationPrice({ groupId:'g', variationId:'v', expectedDesiredRevision:3, priceAmount:1.99 })).resolves.toMatchObject({ group:{group_id:'g',desired_revision:4}, variation:{variation_id:'v',price_amount:1.99,price_currency:'USD'} });
  });

  it('fails before RPC invocation for an unsupported runtime price', async () => {
    const c = clientFor('update_variation_listing_manual_price', { group_row:group, variation_row:variation });
    await expect(createSupabaseVariationListingTransactionGateway(c).updateVariationPrice({ groupId:'g', variationId:'v', expectedDesiredRevision:3, priceAmount:2.99 as never })).rejects.toThrow(/price edit amount/);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it('maps VR001 stale-CAS conflicts', async () => {
    const c = { rpc: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data:null, error:{ code:'VR001', message:'stale' } })) })) } as unknown as SupabaseDataClient;
    await expect(createSupabaseVariationListingTransactionGateway(c).updateVariationPrice({ groupId:'g', variationId:'v', expectedDesiredRevision:3, priceAmount:1.99 })).rejects.toMatchObject({ name:'VariationListingTransactionConflictError', code:'VR001' });
  });
});
