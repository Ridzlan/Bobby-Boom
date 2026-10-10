import {createJob,getJob} from './agent.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const ROOT=path.resolve(process.env.WORKBUDDY_OUTPUT_DIR||path.join(os.homedir(),'WorkBuddy AI'));
const PORT=4318, MAX=5*1024*1024;
const stamp=/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/;
const receipt=/^receipt_[\w-]+\.json$/i;
const named=new Set(['receipts_extraction.json','access_group_payload.json']);
function classify(name,d){
 if(receipt.test(name)&&typeof d?.receiptId==='string'&&d.phase2_extraction?.totals&&d.phase3_policyValidation&&Array.isArray(d.phase4_ledgerDraft?.entries))return 'receipt';
 if(name==='receipts_extraction.json'&&Array.isArray(d?.receipts)&&d.sessionMeta)return 'extraction';
 if(name==='access_group_payload.json'&&d?.batchMeta&&Array.isArray(d.rejectedEntries)&&Array.isArray(d.postedEntries))return 'accounting';
 return null;
}
async function read(file,name){const st=await fs.stat(file);if(!st.isFile()||st.size>MAX)return null;const data=JSON.parse(await fs.readFile(file,'utf8'));const kind=classify(name,data);return kind?{kind,data,modifiedAt:st.mtime.toISOString()}:null;}
async function list(){let folders;try{folders=await fs.readdir(ROOT,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return [];throw e}
 const ids=folders.filter(x=>x.isDirectory()&&stamp.test(x.name)).map(x=>x.name).sort().reverse().slice(0,80);const out=[];
 for(const id of ids)for(const dir of ['outputs','.']){let files;try{files=await fs.readdir(path.join(ROOT,id,dir),{withFileTypes:true})}catch{continue}
 for(const f of files){if(!f.isFile()||!(receipt.test(f.name)||named.has(f.name)))continue;try{const r=await read(path.join(ROOT,id,dir,f.name),f.name);if(!r)continue;const d=r.data;out.push({id:`${id}/${dir}/${f.name}`,taskId:id,file:f.name,kind:r.kind,modifiedAt:r.modifiedAt,count:r.kind==='receipt'?1:r.kind==='extraction'?d.receipts.length:d.rejectedEntries.length+d.postedEntries.length,title:r.kind==='receipt'?d.phase2_extraction.merchant?.name:r.kind==='extraction'?`Extracted receipts (${d.receipts.length})`:`Accounting batch ${d.batchMeta.batchReference||''}`,status:r.kind==='receipt'?d.phase3_policyValidation.status:r.kind==='accounting'?`${d.rejectedEntries.length} rejected`:'Extraction only'})}catch{/* unfinished/invalid file */}}
 }return out.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt)).slice(0,150)}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
http.createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost:4318');try{
 if(req.method==='POST'&&u.pathname==='/api/process'){
  const origin=req.headers.origin;if(origin){let host;try{host=new URL(origin).hostname}catch{return send(res,403,{error:'Invalid origin'})}if(!['localhost','127.0.0.1'].includes(host))return send(res,403,{error:'Local requests only'})}
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>70*1024*1024)return send(res,413,{error:'Upload exceeds 70 MB'});chunks.push(chunk)}
  let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return send(res,400,{error:'Invalid JSON'})}
  return send(res,202,{job:await createJob(input.files,input.prompt)});
 }
 if(req.method==='GET'&&u.pathname==='/api/job'){const j=getJob(u.searchParams.get('id'));return j?send(res,200,{job:j}):send(res,404,{error:'Job not found'})}
 if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
 if(u.pathname==='/api/health')return send(res,200,{ok:true,mode:'read-only',folder:ROOT});
 if(u.pathname==='/api/results')return send(res,200,{results:await list()});
 if(u.pathname==='/api/result'){const id=u.searchParams.get('id');const m=typeof id==='string'&&id.match(/^(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\/(outputs|\.)\/(receipt_[\w-]+\.json|receipts_extraction\.json|access_group_payload\.json)$/i);if(!m)return send(res,400,{error:'Invalid identifier'});const r=await read(path.join(ROOT,m[1],m[2],m[3]),m[3]);return r?send(res,200,{kind:r.kind,data:r.data}):send(res,404,{error:'Unsupported file'});}
 return send(res,404,{error:'Not found'});
 }catch(e){send(res,e.status||(e.code==='ENOENT'?404:500),{error:e.message||'Request failed'})}}).listen(PORT,'127.0.0.1',()=>console.log(`ClaimFlow backend http://127.0.0.1:${PORT} | Watching ${ROOT} (agent processing enabled)`));
