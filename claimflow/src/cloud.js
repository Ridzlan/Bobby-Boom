import {suggestExpense} from './suggestions.js';
import {supabase} from './supabase.js';
const must=(r)=>{if(r.error)throw r.error;return r.data};
export async function getMemberships(userId){return must(await supabase.from('memberships').select('organization_id,role,organizations(name)').eq('user_id',userId));}
export async function getCloudClaims(orgId){return must(await supabase.from('claims').select('id,title,status,created_at,receipts(id,merchant_name,total,receipt_date,category,business_purpose,original_filename)').eq('organization_id',orgId).order('created_at',{ascending:false}).limit(50));}
export async function saveClaimToCloud({orgId,userId,job,files,category,purpose}){
 if(job?.status!=='completed'||!job?.receipt?.receipts?.length)throw Error('Only completed extractions can be saved.');
 const claim=must(await supabase.from('claims').insert({organization_id:orgId,owner_id:userId,title:`Receipt batch ${new Date().toLocaleDateString('en-MY')}`,status:'draft'}).select('id').single());
 try{
  for(let i=0;i<job.receipt.receipts.length;i++){
   const r=job.receipt.receipts[i], file=files[i];
   if(!file)throw Error(`Original file ${i+1} is not available in this session. Upload and process again.`);
   const ext=(file.name.split('.').pop()||'png').toLowerCase();
   const objectPath=`${orgId}/${userId}/${crypto.randomUUID()}.${ext}`;
   must(await supabase.storage.from('claimflow-receipts').upload(objectPath,file,{upsert:false,contentType:file.type||'application/octet-stream'}));
   const receipt=must(await supabase.from('receipts').insert({claim_id:claim.id,organization_id:orgId,owner_id:userId,storage_path:objectPath,original_filename:file.name,merchant_name:r.merchant,receipt_date:r.date||null,currency:r.currency||'MYR',total:r.total,category:category?.[i]||suggestExpense(r).category,business_purpose:purpose?.[i]||suggestExpense(r).purpose,extracted_data:r,confidence_flags:r.reviewFlags||[]}).select('id').single());
   const items=(r.lineItems||[]).map(x=>({receipt_id:receipt.id,description:String(x.description||'Unknown item'),quantity:Number(x.quantity)||1,unit_price:Number.isFinite(Number(x.unitPrice))?Number(x.unitPrice):null,line_total:Number(x.lineTotal??(Number(x.unitPrice||0)*Number(x.quantity||1)))}));
   if(items.length)must(await supabase.from('receipt_items').insert(items));
  }
  return claim.id;
 }catch(err){throw Error(`Cloud save was incomplete (claim ${claim.id}). ${err.message}. Check Supabase before retrying to avoid duplicates.`)}
}

// The RPC must perform all security-sensitive checks; never accept a client-supplied approval status.
export async function requestAutomaticDecision(claimId){
 const {data,error}=await supabase.rpc('claimflow_auto_decide',{p_claim_id:claimId});
 if(error)throw error;
 return data;
}
