export const categories=['Meals','Travel','Accommodation','Office supplies','Vehicle maintenance','Other'];
export const NOMINAL={Meals:'DEMO-6100',Travel:'DEMO-6200',Accommodation:'DEMO-6300','Office supplies':'DEMO-6400','Vehicle maintenance':'DEMO-6500',Other:'DEMO-6990'};
export const cents=n=>Math.round(Number(n)*100);
export const fingerprint=r=>[String(r.merchant||'').toLowerCase().replace(/[^a-z0-9]/g,''),String(r.date||''),Number.isFinite(Number(r.total))?cents(r.total):'invalid',String(r.currency||'MYR').toUpperCase()].join('|');
export const meaningfulPurpose=s=>{const v=String(s||'').trim();return v.length>=12&&v.split(/\s+/).length>=3&&!/^(nothing|none|n\/a|na|test|testing|personal|unknown|no purpose|not sure|asdf|xxx)[\s.!]*$/i.test(v)};
export function evaluateReceipt(r,{cap=500,purpose='',confirmed=false,category='Other',batch=[],index=0,history=[]}={}){
 const checks=[],add=(id,ok,message,detail='')=>checks.push({id,ok,message,detail});
 const amount=Number(r.total),valid=r.total!==null&&r.total!==''&&Number.isFinite(amount)&&amount>=0;
 add('amount',valid,'Valid receipt total');
 add('cap',valid&&amount<=cap,`Receipt within demo cap (MYR ${Number(cap).toFixed(2)})`);
 add('date',!!r.date,'Receipt date available');
 add('merchant',!!String(r.merchant||'').trim(),'Merchant available');
 add('purpose',meaningfulPurpose(purpose),'Meaningful business purpose (at least 3 words / 12 characters)');
 add('category',categories.includes(category),'Expense category selected');
 add('verified',confirmed,'Original receipt manually verified');
 const lines=Array.isArray(r.lineItems)?r.lineItems:[];
 const lineValues=lines.map(l=>{if(l.lineTotal!==undefined&&l.lineTotal!==null&&l.lineTotal!=='')return Number(l.lineTotal);if(l.quantity!=null&&l.unitPrice!=null)return Number(l.quantity)*Number(l.unitPrice);return NaN});
 const complete=lines.length>0&&lineValues.every(Number.isFinite)&&lineValues.every(n=>n>=0);
 const sumCents=complete?lineValues.reduce((sum,n)=>sum+cents(n),0):null;
 const delta=complete&&valid?cents(amount)-sumCents:null;
 add('reconciliation',complete&&delta===0,'Line items reconcile with receipt total',complete&&valid?`Items MYR ${(sumCents/100).toFixed(2)}; receipt MYR ${amount.toFixed(2)}; difference ${delta<0?'-':'+'}MYR ${(Math.abs(delta)/100).toFixed(2)}`:'Line items incomplete or unavailable');
 const fp=fingerprint(r);
 const sameBatch=batch.some((x,i)=>i!==index&&fingerprint(x)===fp);
 const previous=history.some(x=>x.fingerprint===fp);
 add('duplicate',!sameBatch&&!previous,'No potential duplicate',sameBatch?'Matching merchant/date/amount in current batch':previous?'Matching previously approved receipt':'');
 return {checks,delta,sumCents,duplicate:sameBatch||previous,fingerprint:fp,hardBlocks:checks.filter(x=>!x.ok&&['amount','cap','date','merchant','purpose','category','verified'].includes(x.id)),resolvable:checks.filter(x=>!x.ok&&['reconciliation','duplicate'].includes(x.id))};
}


// Advisory only. Official approval must be performed by the database RPC.
export function autoApprovalPreview(receipt,{purpose='',purposeConfirmed=false,duplicate=false,extractionConfidence=null}={}){
 const amount=Number(receipt?.total);
 const checks={
  amount:receipt?.currency==='MYR' && Number.isFinite(amount) && amount>=0 && amount<=500,
  duplicate:!duplicate,
  confidence:Number.isFinite(extractionConfidence) && extractionConfidence>=0.9 && !(receipt?.reviewFlags||[]).length,
  purpose:purposeConfirmed && meaningfulPurpose(purpose),
 };
 return {eligible:Object.values(checks).every(Boolean),checks,decision:Object.values(checks).every(Boolean)?'eligible_for_server_review':'manager_review'};
}
