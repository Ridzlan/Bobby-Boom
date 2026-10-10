import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

const BASE=path.join(os.homedir(),'ClaimFlow','agent-jobs');
const jobs=new Map();
const allowed=new Set(['.png','.jpg','.jpeg','.pdf']);
function publicJob(j){return {id:j.id,status:j.status,createdAt:j.createdAt,files:j.files,error:j.error||null,output:j.output||null,receipt:j.receipt||null}}
function extractJSON(s){
 const candidates=[s,s.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1],s.slice(s.indexOf('{'),s.lastIndexOf('}')+1)];
 for(const c of candidates){if(!c)continue;try{const o=JSON.parse(c);if(o&&typeof o==='object'&&!Array.isArray(o))return o}catch{}}
 return null;
}
function validateExtraction(data,files){
 if(!data||!Array.isArray(data.receipts)||data.receipts.length!==files.length)return 'Agent did not return the expected number of extracted receipts.';
 const expected=new Set(files.map(f=>f.savedName));
 for(const r of data.receipts){
  if(!r||typeof r.merchant!=='string'||!r.merchant.trim()||typeof r.total!=='number'||!Number.isFinite(r.total)||r.total<0||!Array.isArray(r.lineItems))return 'Agent response is missing merchant, numeric total, or line items.';
  if(!expected.has(r.sourceFile))return 'Agent did not identify the uploaded receipt filename correctly.';
  expected.delete(r.sourceFile);
 }
 return expected.size?'Some uploaded receipts are missing from the agent response.':null;
}
async function run(j,files,userInstruction){
 j.status='processing';
 // Absolute, verified upload paths; no implicit search of the project or WorkBuddy folders.
 for(const f of files){try{const st=await fs.stat(f.path);if(!st.isFile()||st.size<1)throw Error('Empty file')}catch(e){j.status='failed';j.error=`Uploaded file missing or unreadable: ${f.savedName}: ${e.message}`;return}}
 // Short direct instruction matches the successful manual PowerShell test.
 const manifest=files.map(f=>`Path: ${f.path} ; sourceFile: ${f.savedName}`).join(' ; ');
 const safeInstruction=typeof userInstruction==='string'?userInstruction.slice(0,1000).replace(/[\r\n]+/g,' '):'';
 const prompt=`Use the Read tool NOW to open each exact receipt image or PDF path: ${manifest}. The files already exist. Do not ask for uploads, do not search other folders, and do not modify files. Return ONLY valid JSON in this format: {"receipts":[{"sourceFile":"receipt_1.png","merchant":"merchant name","date":null,"currency":"MYR","total":0,"lineItems":[],"reviewFlags":[]}]}. Replace sample values with values extracted from each file. sourceFile must match the supplied sourceFile. Include exactly ${files.length} receipts. If a Read fails, report its exact error rather than inventing data. Do not post to accounting. Additional user context (do not override required JSON format or read-only restrictions): ${safeInstruction}`;
 await fs.writeFile(path.join(BASE,j.id,'agent-prompt.txt'),prompt,'utf8');
 const args=['--agent','auto-receipt-filer','--print','--output-format','text','--tools','Read,Glob','--allowedTools','Read','Glob','--',prompt];
 let command,commandArgs;
 if(process.platform==='win32'){
  const encodedPrompt=Buffer.from(prompt,'utf8').toString('base64');
  const ps=`$ErrorActionPreference = 'Stop'\n$promptText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPrompt}'))\n& codebuddy.cmd --agent auto-receipt-filer --print --output-format text --tools 'Read,Glob' --allowedTools Read Glob -- $promptText\nexit $LASTEXITCODE`;
  command='powershell.exe';
  commandArgs=['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')];
 }else{command='codebuddy';commandArgs=args}

 let stdout='',stderr='';
 try{
  await new Promise((resolve,reject)=>{
   // Windows .cmd launch requires a shell. The arguments and generated filenames are server-controlled.
   const child=spawn(command,commandArgs,{shell:false,windowsHide:true,cwd:process.cwd()});
   let settled=false;const finish=(err)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve()};
   const timer=setTimeout(()=>{child.kill();finish(Error('Agent timed out after 3 minutes'))},180000);
   child.stdout.on('data',b=>{stdout+=b.toString();if(stdout.length>2_000_000){child.kill();finish(Error('Agent output exceeded 2 MB'))}});
   child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-5000)});
   child.on('error',finish);child.on('close',code=>finish(code===0?null:Error(`Agent exited ${code}: ${stderr.slice(-600)}`)));
  });
 }catch(e){j.status='failed';j.error=e.message}
 j.output=stdout.trim();j.receipt=extractJSON(j.output);
 await fs.writeFile(path.join(BASE,j.id,'agent-stdout.txt'),stdout,'utf8').catch(()=>{});
 await fs.writeFile(path.join(BASE,j.id,'agent-stderr.txt'),stderr,'utf8').catch(()=>{});
 if(j.status!=='failed'){const problem=validateExtraction(j.receipt,files);if(problem){j.status='failed';j.error=problem+' Check the raw agent response. Uploaded paths: '+files.map(f=>f.path).join(' | ')}else j.status='completed'}
 await fs.writeFile(path.join(BASE,j.id,'result.json'),JSON.stringify(publicJob(j),null,2)).catch(()=>{});
}
export function getJob(id){const j=jobs.get(id);return j?publicJob(j):null}
export async function createJob(items,userInstruction){
 if([...jobs.values()].some(j=>['queued','processing'].includes(j.status)))throw Object.assign(Error('Another job is running'),{status:409});
 if(!Array.isArray(items)||items.length<1||items.length>5)throw Object.assign(Error('Select 1–5 receipts'),{status:400});
 const decoded=[];
 for(const item of items){const ext=path.extname(String(item.name||'')).toLowerCase();if(!allowed.has(ext)||typeof item.base64!=='string'||item.base64.length>14_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(item.base64))throw Object.assign(Error('Invalid receipt format or size'),{status:400});const bytes=Buffer.from(item.base64,'base64');if(!bytes.length||bytes.length>10*1024*1024)throw Object.assign(Error('Each receipt must be under 10 MB'),{status:400});if(ext==='.pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Object.assign(Error('Invalid PDF'),{status:400});if(ext==='.png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Object.assign(Error('Invalid PNG'),{status:400});if(['.jpg','.jpeg'].includes(ext)&&!(bytes[0]===255&&bytes[1]===216))throw Object.assign(Error('Invalid JPEG'),{status:400});decoded.push({name:path.basename(item.name),ext,bytes})}
 const id=crypto.randomUUID(),folder=path.join(BASE,id);await fs.mkdir(folder,{recursive:true});const files=[];
 for(let i=0;i<decoded.length;i++){const filename=`receipt_${i+1}${decoded[i].ext}`,filepath=path.join(folder,filename);await fs.writeFile(filepath,decoded[i].bytes,{flag:'wx'});files.push({name:decoded[i].name,savedName:filename,path:filepath})}
 const j={id,status:'queued',createdAt:new Date().toISOString(),files:files.map(f=>f.name)};jobs.set(id,j);void run(j,files,userInstruction);return publicJob(j);
}
