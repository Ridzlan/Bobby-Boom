import React,{useEffect,useState} from 'react';
import {categories,NOMINAL,evaluateReceipt} from './reviewRules.js';
const fmt=(n,c='MYR')=>{try{return new Intl.NumberFormat('en-MY',{style:'currency',currency:c}).format(Number(n)||0)}catch{return `${c} ${Number(n||0).toFixed(2)}`}};
const csv=x=>`"${String(x??'').replaceAll('"','""')}"`;
function save(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
const STORE='claimflow-v7-approved-fingerprints';
function readHistory(){try{const x=JSON.parse(localStorage.getItem(STORE)||'[]');return Array.isArray(x)?x:[]}catch{return []}}
function ReceiptReview({receipt,index,jobId,cap,batch,history,onApproved}){
 const [category,setCategory]=useState('Other'),[purpose,setPurpose]=useState(''),[confirmed,setConfirmed]=useState(false),[approved,setApproved]=useState(false),[resolution,setResolution]=useState(''),[explanation,setExplanation]=useState('');
 const currency=receipt.currency||'MYR';
 const ev=evaluateReceipt(receipt,{cap,purpose,confirmed,category,batch,index,history});
 const needsResolution=ev.resolvable.length>0;
 const resolved=needsResolution&&resolution==='reviewed'&&explanation.trim().length>=15;
 const canApprove=ev.hardBlocks.length===0&&(!needsResolution||resolved);
 const isApproved=approved&&canApprove;
 const status=isApproved?'APPROVED LOCALLY':canApprove?'READY FOR APPROVAL':needsResolution?'REVIEW REQUIRED':'BLOCKED';
 const amount=Number(receipt.total);
 const draft=Number.isFinite(amount)&&amount>=0?[{type:'Debit',account:NOMINAL[category],description:`${category} expense — ${receipt.merchant}`,amount},{type:'Credit',account:'DEMO-2100',description:'Employee reimbursement payable',amount}]:[];
 const record={jobId,sourceFile:receipt.sourceFile,merchant:receipt.merchant,date:receipt.date,currency,total:receipt.total,lineItems:receipt.lineItems,agentReviewFlags:receipt.reviewFlags||[],review:{category,businessPurpose:purpose,confirmed,approved:isApproved,reviewedAt:isApproved?new Date().toISOString():null,policy:{kind:'ClaimFlow demonstration checks only',singleReceiptCap:cap,status,checks:ev.checks,duplicateMatchMethod:'merchant + date + amount + currency',reconciliationDifferenceCents:ev.delta,exceptionResolution:resolved?{reason:explanation.trim(),reviewedManually:true}:null},journal:{status:isApproved?'approved_local_draft':'blocked_pending_review',taxTreatment:'not assessed',nominalCodes:'illustrative placeholders',entries:draft}}};
 const exportCsv=()=>{if(!isApproved)return;save(`claimflow-journal-${index+1}.csv`,[['Type','Account (DEMO ONLY)','Description','Debit','Credit','Currency','Source file'],...draft.map(x=>[x.type,x.account,x.description,x.type==='Debit'?x.amount.toFixed(2):'',x.type==='Credit'?x.amount.toFixed(2):'',currency,receipt.sourceFile])].map(row=>row.map(csv).join(',')).join('\r\n'),'text/csv;charset=utf-8')};
 function approve(next){setApproved(next);if(next&&canApprove)onApproved({fingerprint:ev.fingerprint,merchant:receipt.merchant,date:receipt.date,total:receipt.total,currency,jobId,sourceFile:receipt.sourceFile,approvedAt:new Date().toISOString()})}
 useEffect(()=>{setApproved(false)},[cap,receipt]);
 return <section className="v6-receipt">
 <div className="v6-head"><div><span className="v6-kicker">RECEIPT {index+1} · {receipt.sourceFile}</span><h4>{receipt.merchant}</h4><span>{receipt.date||'Date not available'} · {fmt(amount,currency)}</span></div><span className={`v6-chip ${isApproved?'v6-ok':'v6-warn'}`}>{status}</span></div>
 <div className="v6-form"><label>Expense category<select value={category} onChange={e=>{setCategory(e.target.value);setApproved(false)}}>{categories.map(x=><option key={x}>{x}</option>)}</select></label><label>Business purpose<input value={purpose} onChange={e=>{setPurpose(e.target.value);setApproved(false)}} placeholder="e.g. Supplies for community workshop" /></label></div>
 <label className="v6-check"><input type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);setApproved(false)}}/> I verified this receipt against the original image.</label>
 <h5>Extracted line items</h5>{receipt.lineItems?.length?<div className="v6-table"><table><thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead><tbody>{receipt.lineItems.map((l,i)=><tr key={i}><td>{l.description||'Unspecified item'}</td><td>{l.quantity??'—'}</td><td>{fmt(l.lineTotal??(l.quantity!=null&&l.unitPrice!=null?Number(l.quantity)*Number(l.unitPrice):0),currency)}</td></tr>)}</tbody></table></div>:<p className="v6-muted">No line items extracted. Review original receipt.</p>}
 <h5>Policy & integrity checks <span className="v6-muted">· demo rules, not verified company policy</span></h5>
 <div className="v6-rules">{ev.checks.map(c=><div className="v7-rule" key={c.id}><b className={c.ok?'v7-pass':'v7-fail'}>{c.ok?'PASS':'REVIEW'}</b><span>{c.message}{c.detail&&<small className="v7-detail">{c.detail}</small>}</span></div>)}{receipt.reviewFlags?.map((f,i)=><p key={i}>⚠ Agent review flag: {f}</p>)}</div>
 {needsResolution&&<div className="v7-exception"><strong>Exception review required</strong><p>A mismatch or potential duplicate blocks approval until a human explains the exception. This does not alter extracted values.</p><label><input type="checkbox" checked={resolution==='reviewed'} onChange={e=>{setResolution(e.target.checked?'reviewed':'');setApproved(false)}}/> I investigated the original receipt and accept the flagged exception(s).</label><label>Required explanation<textarea value={explanation} onChange={e=>{setExplanation(e.target.value);setApproved(false)}} placeholder="Explain the RM difference, discount, or why this is not a duplicate." rows={3}/></label><small>At least 15 characters. Exceptions remain visible in the exported review JSON.</small></div>}
 <h5>Draft accounting journal <span className="v6-muted">· illustrative nominal codes, tax not assessed</span></h5>
 <div className="v6-table"><table><thead><tr><th>Type</th><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{draft.map((e,i)=><tr key={i}><td>{e.type}</td><td>{e.account}</td><td>{e.type==='Debit'?fmt(e.amount,currency):'—'}</td><td>{e.type==='Credit'?fmt(e.amount,currency):'—'}</td></tr>)}</tbody></table></div>
 <p className="v6-muted">Draft only. No tax split, Access Group compatibility, or actual posting is implied.</p>
 <label className="v6-check"><input type="checkbox" checked={isApproved} disabled={!canApprove} onChange={e=>approve(e.target.checked)}/> Mark as reviewed and approved locally (does not submit a claim)</label>
 <div className="v6-actions"><button className="secondary" onClick={()=>save(`claimflow-review-${index+1}.json`,JSON.stringify(record,null,2),'application/json')}>Download review JSON</button><button className="secondary" disabled={!isApproved} onClick={exportCsv}>Export approved draft CSV</button></div>
 </section>
}
export default function AgentReview({job}){
 const [cap,setCap]=useState('100');const [history,setHistory]=useState(readHistory);
 if(job?.status!=='completed'||!Array.isArray(job.receipt?.receipts))return null;
 const n=Number(cap),safeCap=cap.trim()!==''&&Number.isFinite(n)&&n>=0?n:0;
 function register(record){setHistory(prev=>{const next=[...prev.filter(x=>!(x.jobId===record.jobId&&x.sourceFile===record.sourceFile)),record];try{localStorage.setItem(STORE,JSON.stringify(next))}catch{}return next})}
 return <section className="v6-panel"><div className="v6-intro"><span className="v6-kicker">CLAIMFLOW V7 · REVIEW WORKSPACE</span><h3>Expense review & journal drafts</h3><p>AI extraction is complete. ClaimFlow checks totals, possible duplicates and demo expense rules. Nothing is posted to an accounting system.</p><label>Demo maximum per receipt (MYR) <input type="number" min="0" step="0.01" value={cap} onChange={e=>setCap(e.target.value)}/></label><p className="v6-muted">Duplicate history is stored only in this browser after local approval. It is not a shared database or definitive fraud check.</p></div>{job.receipt.receipts.map((r,i)=><ReceiptReview key={`${job.id}-${i}`} receipt={r} index={i} jobId={job.id} cap={safeCap} batch={job.receipt.receipts} history={history.filter(x=>!(x.jobId===job.id&&x.sourceFile===r.sourceFile))} onApproved={register}/>)}</section>
}
