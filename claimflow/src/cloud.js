import { supabase } from './supabase.js';

const must = ({ data, error }) => { if (error) throw error; return data; };
async function mustQuery(query) { return must(await query); }

export const getMemberships = userId => mustQuery(
    supabase.from('memberships').select('organization_id,role,organizations(name)').eq('user_id', userId)
);
export const getCloudClaims = orgId => mustQuery(
    supabase.from('claims')
        .select('id,title,status,created_at,submitted_at,decided_at,receipts(id,merchant_name,total,receipt_date,category,original_filename,storage_path,confidence_flags)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false }).limit(100)
);

/**
 * Cleanup is allowed only for the current user's own DRAFT claim.
 * Storage removal happens before database deletion so failed file removal
 * does not leave orphaned objects without a claim to identify their owner.
 * Requires the storage policy + claimflow_delete_failed_draft SQL in setup.sql.
 */
export async function deleteFailedDraft(claimId, uploaded = []) {
    if (!claimId) throw Error('Cannot delete a draft without a claim ID.');

    const paths = uploaded.map(item => item.path).filter(Boolean);
    if (paths.length) {
        const { data, error } = await supabase.storage.from('claimflow-receipts').remove(paths);
        if (error) throw Error(`Could not delete original files: ${error.message}`);
        if (!Array.isArray(data) || data.length !== paths.length) {
            throw Error(`Storage confirmed deletion of ${Array.isArray(data) ? data.length : 0} of ${paths.length} file(s). The draft was kept for safety.`);
        }
    }

    const { error } = await supabase.rpc('claimflow_delete_failed_draft', {
        p_claim_id: claimId
    });
    if (error) throw Error(`Could not delete draft record: ${error.message}`);
}

export async function createDraft(orgId, userId, files) {
    // Use the secure RPC introduced in the earlier RLS fix.
    const claimId = must(await supabase.rpc('claimflow_create_draft', { p_org_id: orgId }));
    const uploaded = [];
    try {
        for (const file of files) {
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
            const path = `${orgId}/${userId}/${claimId}/${crypto.randomUUID()}.${ext}`;
            must(await supabase.storage.from('claimflow-receipts').upload(path, file, {
                contentType: file.type || 'application/octet-stream', upsert: false
            }));
            uploaded.push({ path, name: file.name });
        }
        return { claimId, uploaded };
    } catch (uploadError) {
        try {
            await deleteFailedDraft(claimId, uploaded);
            throw Object.assign(new Error(
                `Unable to save receipt files: ${uploadError.message}. The failed draft and uploaded files were deleted.`
            ), { cleanupDone: true });
        } catch (cleanupError) {
            if (cleanupError.cleanupDone) throw cleanupError;
            throw Error(
                `Unable to save receipt files: ${uploadError.message}. Cleanup failed for draft ${claimId}: ${cleanupError.message}. Check the draft before retrying.`
            );
        }
    }
}

export async function finalizeAndSubmit(claimId, uploaded, receipts) {
    return must(await supabase.rpc('claimflow_finalize_submit', {
        p_claim_id: claimId, p_uploads: uploaded, p_receipts: receipts
    }));
}
export const managerClaims = orgId => mustQuery(
    supabase.rpc('claimflow_manager_claims', { p_org_id: orgId })
);
export const managerDecide = (id, action, note) => mustQuery(
    supabase.rpc('claimflow_manager_decide', { p_claim_id: id, p_action: action, p_note: note || '' })
);
export async function receiptSignedUrl(path) {
    return must(await supabase.storage.from('claimflow-receipts').createSignedUrl(path, 300)).signedUrl;
}
