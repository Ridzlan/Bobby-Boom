import { supabase } from './supabase.js';
const must = ({ data, error }) => { if (error) throw error; return data; };
export const getMemberships = userId => mustQuery(supabase.from('memberships').select('organization_id,role,organizations(name)').eq('user_id', userId));
async function mustQuery(query) { return must(await query); }
export const getCloudClaims = orgId => mustQuery(supabase.from('claims').select('id,title,status,created_at,submitted_at,decided_at,receipts(id,merchant_name,total,receipt_date,category,original_filename,storage_path,confidence_flags)').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(100));
export async function createDraft(orgId, userId, files) {
    const claim = must(await supabase.from('claims').insert({ organization_id: orgId, owner_id: userId, title: `Expense claim · ${new Date().toLocaleDateString('en-MY')}`, status: 'draft' }).select('id').single());
    const uploaded = [];
    try {
        for (const file of files) {
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
            const path = `${orgId}/${userId}/${claim.id}/${crypto.randomUUID()}.${ext}`;
            must(await supabase.storage.from('claimflow-receipts').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false }));
            uploaded.push({ path, name: file.name });
        }
        return { claimId: claim.id, uploaded };
    } catch (e) { throw Error(`Claim ${claim.id} was created but upload failed: ${e.message}. Existing files are retained in Supabase. Do not retry without checking drafts.`) }
}
export async function finalizeAndSubmit(claimId, uploaded, receipts) {
    return must(await supabase.rpc('claimflow_finalize_submit', { p_claim_id: claimId, p_uploads: uploaded, p_receipts: receipts }));
}
export const managerClaims = orgId => mustQuery(supabase.rpc('claimflow_manager_claims', { p_org_id: orgId }));
export const managerDecide = (id, action, note) => mustQuery(supabase.rpc('claimflow_manager_decide', { p_claim_id: id, p_action: action, p_note: note || '' }));
export async function receiptSignedUrl(path) { return must(await supabase.storage.from('claimflow-receipts').createSignedUrl(path, 300)).signedUrl; }
