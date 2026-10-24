import {describe,it,expect,vi} from 'vitest';
import {
  executeRemovedSkuRemoteRetirement,
  type RemovedSkuRetirementStore,
  type RemovedSkuRetirementRemote,
  type RemovedSkuRetirementRecord,
} from '@/ebay/variation-listing-removed-sku-remote-retirement.js';
import type {VariationListingPermanentRemovalPlan} from '@/ebay/variation-listing-permanent-removal.js';

const plan={
  captureInput:{revisionId:'revision',groupId:'group',capturedDesiredRevision:4},
  targetVariationId:'target-var',
  targetSku:'target',
  offerIdsBySku:{target:'offer'},
  quantitiesBySku:{target:{inventoryItemQuantity:0,offerQuantity:0,sellableQuantity:0}},
  survivorSkus:['one','two'],
  marketplaceId:'EBAY_US',
  listingId:'listing',
} as unknown as VariationListingPermanentRemovalPlan;

function setup() {
  let state: RemovedSkuRetirementRecord['state']='ready';
  let present=true;
  const record=():RemovedSkuRetirementRecord=>({revisionId:'revision',groupId:'group',targetVariationId:'target-var',targetSku:'target',targetOfferId:'offer',marketplaceId:'EBAY_US',listingId:'listing',c2ConfirmedRevision:4,state});
  const store:RemovedSkuRetirementStore={
    load:vi.fn(async()=>null),
    prepare:vi.fn(async()=>record()),
    start:vi.fn(async()=>{state='started';return record();}),
    markUnknown:vi.fn(async()=>{state='unknown';return record();}),
    markComplete:vi.fn(async()=>{state='confirmed_complete';return record();}),
  };
  const remote:RemovedSkuRetirementRemote={
    readItem:vi.fn(async()=>present?{state:'present',sku:'target',groupKeys:[],quantity:0}:{state:'absent'}),
    readAllOffers:vi.fn(async()=>({complete:true,offers:present?[{offerId:'offer',sku:'target',marketplaceId:'EBAY_US',status:'UNPUBLISHED' as const,listingId:null,availableQuantity:0}]:[]})),
    verifySurvivors:vi.fn(async()=>true),
    deleteInventoryItem:vi.fn(async()=>{present=false;}),
  };
  return {store,remote,setPresent:(v:boolean)=>{present=v;},setState:(v:RemovedSkuRetirementRecord['state'])=>{state=v;}};
}
describe('c2b remote Inventory Item retirement',()=>{
  it('journals before DELETE and verifies Item and Offer absent',async()=>{
    const t=setup();
    const result=await executeRemovedSkuRemoteRetirement({plan,...t});
    expect(result.itemAbsent).toBe(true);
    expect(result.offerAbsent).toBe(true);
    expect(t.store.start).toHaveBeenCalledOnce();
    expect(t.remote.deleteInventoryItem).toHaveBeenCalledWith('target');
    expect(t.store.markComplete).toHaveBeenCalledOnce();
  });
  it('reconciles absent Item+Offer after a lost response, without another DELETE',async()=>{
    const t=setup();t.setPresent(false);t.setState('unknown');
    expect((await executeRemovedSkuRemoteRetirement({plan,...t})).state).toBe('confirmed_complete');
    expect(t.remote.deleteInventoryItem).not.toHaveBeenCalled();
  });
  it('blocks retry of a pending or ambiguous deletion',async()=>{
    const t=setup();t.setState('started');
    await expect(executeRemovedSkuRemoteRetirement({plan,...t})).rejects.toThrow(/unresolved/);
    expect(t.remote.deleteInventoryItem).not.toHaveBeenCalled();
  });
  it('refuses foreign marketplace Offers, incomplete coverage and survivor changes',async()=>{
    const t=setup();
    vi.mocked(t.remote.readAllOffers).mockResolvedValueOnce({complete:true,offers:[{offerId:'other',sku:'target',marketplaceId:'FOREIGN',status:'UNPUBLISHED',listingId:null,availableQuantity:0}]});
    await expect(executeRemovedSkuRemoteRetirement({plan,...t})).rejects.toThrow(/foreign|mismatched/);
    expect(t.remote.deleteInventoryItem).not.toHaveBeenCalled();
    vi.mocked(t.remote.readAllOffers).mockResolvedValueOnce({complete:false,offers:[]});
    await expect(executeRemovedSkuRemoteRetirement({plan,...t})).rejects.toThrow(/incomplete/);
    vi.mocked(t.remote.verifySurvivors).mockResolvedValueOnce(false);
    await expect(executeRemovedSkuRemoteRetirement({plan,...t})).rejects.toThrow(/surviving/);
  });
  it('requires one exact unpublished zero Offer and accepts an ungrouped null Item',async()=>{
    const t=setup();
    vi.mocked(t.remote.readItem).mockResolvedValueOnce({state:'present',sku:'target',groupKeys:null,quantity:0});
    vi.mocked(t.remote.readAllOffers).mockResolvedValueOnce({complete:true,offers:[
      {offerId:'offer',sku:'target',marketplaceId:'EBAY_US',status:'UNPUBLISHED',listingId:null,availableQuantity:0},
      {offerId:'foreign',sku:'target',marketplaceId:'EBAY_GB',status:'UNPUBLISHED',listingId:null,availableQuantity:0},
    ]});
    await expect(executeRemovedSkuRemoteRetirement({plan,...t})).rejects.toThrow(/exact|foreign|mismatched/);
    expect(t.remote.deleteInventoryItem).not.toHaveBeenCalled();
  });
  it('records ambiguity when eBay DELETE or verification fails',async()=>{
    const a=setup();vi.mocked(a.remote.deleteInventoryItem).mockRejectedValueOnce(new Error('timeout'));
    await expect(executeRemovedSkuRemoteRetirement({plan,...a})).rejects.toThrow(/unknown/);
    expect(a.store.markUnknown).toHaveBeenCalledOnce();
    const b=setup();vi.mocked(b.remote.readItem).mockRejectedValueOnce(new Error('unavailable'));
    await expect(executeRemovedSkuRemoteRetirement({plan,...b})).rejects.toThrow('unavailable');
    expect(b.remote.deleteInventoryItem).not.toHaveBeenCalled();
  });
  it('marks post-DELETE read ambiguity once and never retries blindly',async()=>{
    const t=setup();
    vi.mocked(t.remote.readItem).mockResolvedValueOnce({state:'present',sku:'target',groupKeys:[],quantity:0});
    vi.mocked(t.remote.readItem).mockResolvedValueOnce({state:'present',sku:'target',groupKeys:[],quantity:0});
    await expect(executeRemovedSkuRemoteRetirement({plan,...t})).rejects.toThrow(/absence|unproven|exact removable/);
    expect(t.store.markUnknown).toHaveBeenCalledOnce();
    t.setState('unknown');
    t.setPresent(true);
    await expect(executeRemovedSkuRemoteRetirement({plan,...t})).rejects.toThrow(/unresolved/);
    expect(t.remote.deleteInventoryItem).toHaveBeenCalledOnce();
  });
  it('does not DELETE when durable start CAS loses a concurrent race',async()=>{
    const t=setup();
    vi.mocked(t.store.start).mockRejectedValueOnce(new Error('concurrent start conflict'));
    await expect(executeRemovedSkuRemoteRetirement({plan,...t})).rejects.toThrow(/concurrent/);
    expect(t.remote.deleteInventoryItem).not.toHaveBeenCalled();
  });
});
