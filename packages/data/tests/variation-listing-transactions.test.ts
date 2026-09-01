import { describe, expect, it } from 'vitest';
import type { VariationListingRevisionPlanOperation, VariationListingPublishingCheckpointRow } from '../src/index.js';
import { assertVariationListingJournalCanContinue, inspectVariationListingJournal } from '../src/index.js';

const op: VariationListingRevisionPlanOperation = { sequence_no:1, operation_key:'publish', operation_kind:'group_publish', target_ref:'g', intent_version:1, intent_digest:'a'.repeat(64), intent:{} };
let id = 0;
const cp = (o: Partial<VariationListingPublishingCheckpointRow> = {}): VariationListingPublishingCheckpointRow => ({ checkpoint_id:`c${++id}`, revision_id:'r', operation_key:'publish', attempt_number:1, checkpoint_number:1, state:'started', observed_remote_state:null, evidence:{}, created_at:'now', ...o });

describe('publishing checkpoints',()=>{
  it('requires reconciliation for started/unknown latest',()=>expect(inspectVariationListingJournal(op,[cp()]).requiresReconciliation).toBe(true));

  it('accepts exact after-state resolution after unknown as terminal complete',()=>{
    const rows=[cp(),cp({checkpoint_number:2,state:'unknown',observed_remote_state:'unknown',evidence:{timeout:true}}),cp({attempt_number:2,checkpoint_number:1,state:'confirmed_complete',observed_remote_state:'present',evidence:{readback:true}})];
    expect(inspectVariationListingJournal(op,rows)).toMatchObject({hasUnknownHistory:true,requiresReconciliation:false,retryAuthorized:false,retryExhausted:false});
    expect(()=>assertVariationListingJournalCanContinue(op,rows)).toThrow('terminal');
  });

  it('authorizes exactly one replay after unknown is reconciled to exact pre-state',()=>{
    const rows=[
      cp(),
      cp({checkpoint_number:2,state:'unknown',observed_remote_state:'unknown',evidence:{timeout:true}}),
      cp({attempt_number:2,checkpoint_number:1,state:'retry_authorized',observed_remote_state:'proven_absent',evidence:{prestate:true}}),
    ];
    expect(inspectVariationListingJournal(op,rows)).toMatchObject({retryAuthorized:true,requiresReconciliation:false});
    expect(()=>assertVariationListingJournalCanContinue(op,rows)).not.toThrow();
    expect(()=>inspectVariationListingJournal(op,[...rows,cp({attempt_number:2,checkpoint_number:2,state:'started'})])).not.toThrow();
    expect(()=>inspectVariationListingJournal(op,[...rows,cp({attempt_number:3,checkpoint_number:1,state:'started'})])).toThrow('exactly one started replay');
  });

  it('marks a second ambiguous replay reconciled to pre-state as exhausted and forbids a third mutation',()=>{
    const rows=[
      cp(),
      cp({checkpoint_number:2,state:'unknown',observed_remote_state:'unknown',evidence:{timeout:true}}),
      cp({attempt_number:2,checkpoint_number:1,state:'retry_authorized',observed_remote_state:'proven_absent',evidence:{prestate:true}}),
      cp({attempt_number:2,checkpoint_number:2,state:'started'}),
      cp({attempt_number:2,checkpoint_number:3,state:'unknown',observed_remote_state:'unknown',evidence:{timeout:true}}),
      cp({attempt_number:3,checkpoint_number:1,state:'retry_exhausted',observed_remote_state:'proven_absent',evidence:{prestate:true}}),
    ];
    expect(inspectVariationListingJournal(op,rows)).toMatchObject({retryAuthorized:false,retryExhausted:true,requiresReconciliation:false});
    expect(()=>assertVariationListingJournalCanContinue(op,rows)).toThrow('exhausted');
    expect(()=>inspectVariationListingJournal(op,[...rows,cp({attempt_number:3,checkpoint_number:2,state:'started'})])).toThrow('terminal');
  });

  it('rejects resolved checkpoint without exact remote evidence',()=>expect(()=>inspectVariationListingJournal({...op,operation_kind:'final_absence_verification'},[cp({state:'retry_authorized',evidence:{prestate:true}})])).toThrow('exact remote evidence'));
  it('preserves read-only started compatibility while rejecting initial retry states',()=>{
    expect(()=>inspectVariationListingJournal({...op,operation_kind:'revision_reconcile'},[cp()])).not.toThrow();
    expect(()=>inspectVariationListingJournal({...op,operation_kind:'revision_reconcile'},[cp({state:'retry_authorized',observed_remote_state:'proven_absent',evidence:{prestate:true}})])).toThrow('must begin');
  });
});
