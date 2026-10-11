import React, { useEffect, useRef, useState } from 'react';
import { Home, ClipboardList, UserRound, ArrowLeft, ArrowRight, FolderOpen, FileText, CheckCircle2, AlertTriangle, ShieldCheck, Mail, Copy, Download, Play, Clock, ChevronRight, ReceiptText, Info, LoaderCircle, Check, X, Bot, Camera, Send, RefreshCw } from 'lucide-react';
import './style.css';
import { supabase, configured } from './supabase.js';
import { getMemberships, getCloudClaims, createDraft, deleteFailedDraft, finalizeAndSubmit, managerClaims, managerDecide, receiptSignedUrl } from './cloud.js';
import { suggestExpense } from './suggestions.js';
const money = (n, c = 'MYR') => { try { return new Intl.NumberFormat('en-MY', { style: 'currency', currency: c }).format(Number(n || 0)) } catch { return `RM ${Number(n || 0).toFixed(2)}` } };
const statusLabel = s => ({ draft: 'Processing / Saved', submitted: 'Pending Manager', approved: 'Approved by Manager', rejected: 'Rejected', needs_changes: 'Needs Changes' }[s] || s);
const getIssues = (r, all, i) => { const a = [...(r.reviewFlags || []).map(x => typeof x === 'string' ? x : JSON.stringify(x))]; if (!r.merchant || !r.date || !(Number(r.total) > 0)) a.push('Missing receipt information'); if (Number(r.total) > 500) a.push('Exceeds RM500 review threshold'); if (all.some((x, j) => j < i && x.merchant === r.merchant && x.date === r.date && Number(x.total) === Number(r.total))) a.push('Possible duplicate'); return a };
function saveFile(name, data, type = 'application/json') { const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
export default function App() {
    const [session, setSession] = useState(null), [ready, setReady] = useState(false), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [authError, setAuthError] = useState('');
    const [memberships, setMemberships] = useState([]), [orgId, setOrgId] = useState(''), [page, setPage] = useState('home'), [files, setFiles] = useState([]), [prompt, setPrompt] = useState('Extract all receipts, categorize expenses, check for missing information, and submit to my manager.');
    const [job, setJob] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [phase, setPhase] = useState(''), [claimId, setClaimId] = useState(''), [claimStatus, setClaimStatus] = useState(''), [claims, setClaims] = useState([]), [queue, setQueue] = useState([]), [queueBusy, setQueueBusy] = useState(false), [managerError, setManagerError] = useState(''), [notes, setNotes] = useState({}), [selected, setSelected] = useState(0), [online, setOnline] = useState(false), [filter, setFilter] = useState('All');
    const fileRef = useRef(null); const isManager = memberships.some(m => m.organization_id === orgId && ['manager', 'admin', 'owner'].includes(String(m.role).toLowerCase()));
    const go = p => { setPage(p); window.scrollTo({ top: 0, behavior: 'instant' }) };
    useEffect(() => { if (!supabase) { setReady(true); return } supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) }).catch(e => { setAuthError(e.message); setReady(true) }); const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s)); return () => subscription.unsubscribe() }, []);
    useEffect(() => { if (!session?.user) { setMemberships([]); setOrgId(''); return } getMemberships(session.user.id).then(rows => { setMemberships(rows); setOrgId(old => rows.some(x => x.organization_id === old) ? old : rows[0]?.organization_id || '') }).catch(e => setAuthError(e.message)) }, [session?.user?.id]);
    useEffect(() => { fetch('/api/health', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(d => setOnline(d.status === 'ok')).catch(() => setOnline(false)) }, []);
    async function refresh() { if (!orgId) return; try { setClaims(await getCloudClaims(orgId)) } catch (e) { setError(e.message) } }
    async function refreshQueue() { if (!isManager) return; setQueueBusy(true); setManagerError(''); try { setQueue(await managerClaims(orgId)) } catch (e) { setManagerError(e.message) } finally { setQueueBusy(false) } }
    useEffect(() => { void refresh(); if (isManager) void refreshQueue() }, [orgId, isManager]);
    async function signIn(e) { e.preventDefault(); setAuthError(''); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) setAuthError(error.message) }
    function addFiles(input) { const incoming = Array.from(input || []); const valid = incoming.filter(f => /\.(png|jpe?g|pdf)$/i.test(f.name) && f.size > 0 && f.size <= 10 * 1024 * 1024); setFiles(old => [...old, ...valid].slice(0, 5)); setError(valid.length !== incoming.length || incoming.length + files.length > 5 ? 'Maximum 5 JPG, PNG or PDF files, each under 10 MB.' : '') }
    async function process() {
        if (!files.length || !orgId || busy) return;
        setBusy(true); setError(''); setJob(null); setClaimId(''); setClaimStatus('');
        go('processing');
        let savedId = '';
        let uploaded = [];
        let submitted = false;
        try {
            setPhase('Saving original photos to Supabase before AI processing');
            const draft = await createDraft(orgId, session.user.id, files);
            savedId = draft.claimId;
            uploaded = draft.uploaded;
            setClaimId(savedId);

            // Process ONE image per request to avoid exceeding Vercel's
            // aggregate request-size limit with several receipt photos.
            const extracted = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                setPhase(`Reading receipt ${i + 1} of ${files.length} with Gemini`);
                const payload = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve({ name: file.name, base64: String(reader.result).split(',')[1] });
                    reader.onerror = () => reject(Error('Unable to read ' + file.name));
                    reader.readAsDataURL(file);
                });
                const response = await fetch('/api/process', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ files: [payload], prompt })
                });
                // Vercel may return plain text for HTTP 413 instead of JSON.
                const responseText = await response.text();
                let data;
                try { data = JSON.parse(responseText); }
                catch {
                    if (response.status === 413 || /Request Entity Too Large/i.test(responseText)) {
                        throw Error(`Receipt ${i + 1} (${file.name}) is too large for AI processing. Try a smaller image.`);
                    }
                    throw Error(`Receipt ${i + 1} processing returned an invalid response (HTTP ${response.status}).`);
                }
                if (!response.ok) throw Error(data?.error || `Receipt ${i + 1} processing failed (HTTP ${response.status}).`);
                const oneReceipt = data.job?.receipt?.receipts;
                if (data.job?.status !== 'completed' || !Array.isArray(oneReceipt) || oneReceipt.length !== 1) {
                    throw Error(`Gemini could not extract receipt ${i + 1} (${file.name}).`);
                }
                // Keep the original selected-file order, including duplicate filenames.
                extracted.push({ ...oneReceipt[0], sourceFile: file.name });
            }
            setJob({ status: 'completed', receipt: { receipts: extracted } });

            setPhase('Saving extracted details and submitting to manager');
            const categorized = extracted.map(r => ({
                ...r,
                expenseCategory: r.expenseCategory && r.expenseCategory !== 'Other'
                    ? r.expenseCategory : suggestExpense(r).category
            }));
            const result = await finalizeAndSubmit(savedId, uploaded, categorized);
            submitted = true;
            setClaimStatus(result);
            await refresh();
            go('results');
        } catch (e) {
            if (savedId && !submitted) {
                setPhase('Processing failed. Cleaning up this failed draft and its original files…');
                try {
                    await deleteFailedDraft(savedId, uploaded);
                    setClaimId('');
                    setFiles([]);
                    setJob(null);
                    setError(`Unable to process receipt(s): ${e.message} The failed upload and draft were deleted. You can try again.`);
                } catch (cleanupError) {
                    setError(`Unable to process receipt(s): ${e.message} Automatic cleanup was NOT completed for draft ${savedId}: ${cleanupError.message}. Do not re-upload until you check this draft.`);
                }
            } else if (submitted) {
                // A refresh error must never cause the now-submitted claim to be deleted.
                setError(`Your claim was submitted, but updating the screen failed: ${e.message}. Check Claim History.`);
            } else {
                setError(e.message);
            }
            await refresh();
        } finally {
            setBusy(false);
        }
    }
    async function decide(id, action) { setQueueBusy(true); setManagerError(''); try { await managerDecide(id, action, notes[id] || ''); await Promise.all([refreshQueue(), refresh()]) } catch (e) { setManagerError(e.message) } finally { setQueueBusy(false) } }
    async function openReceipt(path) { try { window.open(await receiptSignedUrl(path), '_blank', 'noopener,noreferrer') } catch (e) { setManagerError(e.message) } }
    const receipts = job?.receipt?.receipts || []; const total = receipts.reduce((s, r) => s + Number(r.total || 0), 0); const flagged = receipts.filter((r, i) => getIssues(r, receipts, i).length).length; const selectedReceipt = receipts[selected];
    const head = (title, sub, back = 'home') => <div className="screen-head"><button className="icon-button" onClick={() => go(back)}><ArrowLeft size={20} /></button><div><h1>{title}</h1><p>{sub}</p></div></div>;
    if (!ready) return <div className="auth-page">Loading authentication…</div>;
    if (!configured) return <div className="auth-page">Configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.</div>;
    if (!session) return <div className="auth-page"><form className="auth-card" onSubmit={signIn}><div className="auth-brand">▣ ClaimFlow</div><h2>Welcome back</h2><p>Employee and manager sign-in</p><label>Email</label><input className="field" type="email" value={email} onChange={e => setEmail(e.target.value)} required /><label>Password</label><input className="field" type="password" value={password} onChange={e => setPassword(e.target.value)} required />{authError && <div className="alert error">{authError}</div>}<button className="btn primary big">Sign in</button></form></div>;
    if (!memberships.length) return <div className="auth-page"><div className="auth-card"><h2>No organization access</h2><p>Ask an administrator to add this user to an organization.</p>{authError && <p>{authError}</p>}<button className="btn secondary" onClick={() => supabase.auth.signOut()}>Sign out</button></div></div>;
    return <div className="app-wrap"><div className="phone-app"><div className="statusbar"><span>9:41</span><span className="island" /><span>▮▮ ◕ ▰</span></div><div className="screen" key={page}>
        {page === 'home' && <><div className="home-hero"><div className="home-top"><span className="logo"><ReceiptText size={19} /> ClaimFlow <small>AI Expense Agent</small></span><span className="avatar"><UserRound size={19} /></span></div><h1>Welcome back! 👋</h1><p>Upload receipts. AI handles the details. Your manager handles approval.</p><div className="agent-card"><div className="agent-icon"><Bot size={22} /></div><div><b>Auto-Receipt & Claim Filer</b><p>AI categorization, secure storage and manager approvals.</p></div></div><button className="btn white-btn" onClick={() => go('upload')}><Camera size={17} /> New Expense Claim <ArrowRight size={17} /></button></div><div className="screen-padding"><div className="section-title"><h3>Recent Claims</h3><button onClick={() => go('history')}>View all <ChevronRight size={14} /></button></div>{claims.slice(0, 5).map(c => <div className="task-row" key={c.id}><span className="task-icon green"><FileText size={17} /></span><span><b>{c.title}</b><small>{statusLabel(c.status)} · {c.receipts?.length || 0} receipt(s)</small></span></div>)}{!claims.length && <div className="quiet">No claims yet.</div>}{isManager && <button className="btn primary big" onClick={() => go('manager')}><ShieldCheck size={17} /> Manager Approval Queue <ArrowRight size={17} /></button>}<div className="mini-note"><Info size={16} />{online ? 'Vercel API connected' : 'Vercel API health check unavailable'}</div></div></>}
        {page === 'upload' && <>{head('New Expense Claim', 'Upload receipts and let AI prepare your submission.')}<div className="screen-padding"><div className="panel"><h3>Receipt photos</h3><p className="muted">Up to 5 JPG, PNG or PDF receipts. Camera supported on mobile.</p><div className="upload-zone" onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}><div className="upload-circle"><Camera size={27} /></div><b>Take a photo or browse files</b><span>Tap to select receipts</span><small>10 MB per file</small></div><input hidden ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" multiple onChange={e => { addFiles(e.target.files); e.target.value = '' }} />{files.map((f, i) => <div className="file-row" key={i}><FileText size={18} /><span>{f.name}<small>{Math.round(f.size / 1024)} KB</small></span><button onClick={() => setFiles(old => old.filter((_, j) => j !== i))}><X size={17} /></button></div>)}</div><div className="panel"><h3>AI Instruction</h3><textarea className="prompt" value={prompt} maxLength={1000} rows={4} onChange={e => setPrompt(e.target.value)} /></div>{error && <div className="alert error">{error}</div>}<button className="btn primary big" disabled={!files.length || busy} onClick={process}><Play size={17} /> Save, Process & Submit <ArrowRight size={17} /></button><p className="fineprint">Original photos are saved before Gemini runs. Only your manager can approve a claim.</p></div></>}
        {page === 'processing' && <div className="dark-screen"><button className="dark-back" onClick={() => go('upload')}><ArrowLeft size={19} /></button><h1>Processing claim</h1><p>ClaimFlow is handling your expense claim.</p><div className="timeline">{[['Save originals', 'Upload to Supabase Storage'], ['AI extraction', 'Read and categorize expenses'], ['Submit to manager', 'Save data and request approval']].map(([t, d], i) => <div className="timeline-item" key={t}><span className="step-bubble current">{i + 1}</span><div><b>{t}</b><small>{d}</small></div></div>)}</div><div className="bot-bubble"><span><Bot size={26} /></span><p>{phase}</p></div>{busy && <div className="spinner"><LoaderCircle size={27} /></div>}{error && <div className="alert error">{error}</div>}{claimId && <p className="fineprint">Saved claim ID: {claimId}</p>}{error && <button className="btn primary big" onClick={() => go('upload')}>Try Again</button>}{error && claimId && <button className="btn secondary big" onClick={() => go('history')}>View Saved Claims</button>}</div>}
        {page === 'results' && <>{head('Extraction Results', `${receipts.length} receipt(s) processed`)}<div className="screen-padding"><div className="metric-grid"><div className="metric green"><strong>{receipts.length - flagged}</strong><span>Checks passed</span></div><div className="metric red"><strong>{flagged}</strong><span>Flagged</span></div><div className="metric"><strong>{money(total)}</strong><span>Claim total</span></div></div><div className="panel"><h3>Manager submission</h3><div className="success-line"><CheckCircle2 size={18} />{statusLabel(claimStatus)}</div><p className="muted">AI validation is not manager approval. Claim ID: {claimId}</p></div><div className="panel no-pad">{receipts.map((r, i) => <button className="receipt-row" key={i} onClick={() => { setSelected(i); go('policy') }}><span className="vendor-icon"><ReceiptText size={16} /></span><span className="vendor-name">{r.merchant}<small>{r.date || 'Date unknown'} · {r.expenseCategory || suggestExpense(r).category}</small></span><b>{money(r.total, r.currency)}</b><span className={`tiny-status ${getIssues(r, receipts, i).length ? 'flag' : 'ok'}`}>{getIssues(r, receipts, i).length ? 'Flagged' : 'Checked'}</span></button>)}</div><button className="btn primary big" onClick={() => go('packet')}>View Claim Summary <ArrowRight size={17} /></button></div></>}
        {page === 'policy' && <>{head('Policy Validation', 'AI checks are advisory. Your manager decides.', 'results')}<div className="screen-padding">{selectedReceipt ? <div className="panel"><h3>{selectedReceipt.merchant}</h3><p>{money(selectedReceipt.total, selectedReceipt.currency)} · {selectedReceipt.date || 'Unknown date'}</p><div className="detail-row"><span>AI expense category</span><b>{selectedReceipt.expenseCategory || suggestExpense(selectedReceipt).category}</b></div>{(selectedReceipt.lineItems || []).map((x, i) => <div className="detail-row" key={i}><span>{x.description}</span><b>{money(x.lineTotal)}</b></div>)}<h4>Policy flags</h4>{getIssues(selectedReceipt, receipts, selected).length ? getIssues(selectedReceipt, receipts, selected).map((x, i) => <div className="alert warn" key={i}><AlertTriangle size={16} />{x}</div>) : <div className="success-line"><CheckCircle2 size={18} /> No automatic flags detected</div>}</div> : <div className="quiet">No receipt selected</div>}<button className="btn primary big" onClick={() => go('results')}>Back to Results</button></div></>}
        {page === 'packet' && <>{head('Claim Summary', 'Manager approval packet', 'results')}<div className="screen-padding"><div className="panel"><h3>Submission status</h3><p><b>{statusLabel(claimStatus || 'draft')}</b></p><p className="muted">Claim ID: {claimId || 'No current claim'}</p><div className="detail-row"><span>Total expense</span><b>{money(total)}</b></div>{receipts.map((r, i) => <div className="detail-row" key={i}><span>{r.merchant}<small>{r.expenseCategory || suggestExpense(r).category}</small></span><b>{money(r.total, r.currency)}</b></div>)}<button className="btn secondary big" disabled={!receipts.length} onClick={() => saveFile('claimflow-claim-summary.json', JSON.stringify({ claimId, status: claimStatus, receipts }, null, 2))}><Download size={17} /> Download Summary</button></div><button className="btn primary big" onClick={() => go('history')}>Track Claim Status <ArrowRight size={17} /></button></div></>}
        {page === 'history' && <>{head('Claim History', 'Your saved claims in Supabase')}<div className="screen-padding"><button className="btn secondary big" onClick={refresh}><RefreshCw size={16} /> Refresh Claims</button><div className="filter-pills">{['All', 'Pending', 'Approved', 'Rejected'].map(x => <button key={x} className={filter === x ? 'active' : ''} onClick={() => setFilter(x)}>{x}</button>)}</div><div className="panel no-pad">{claims.filter(c => filter === 'All' || (filter === 'Pending' && ['draft', 'submitted', 'needs_changes'].includes(c.status)) || c.status === filter.toLowerCase()).map(c => <div className="task-row" key={c.id}><span className="task-icon green"><FileText size={17} /></span><span><b>{c.title}</b><small>{statusLabel(c.status)} · {c.receipts?.length || 0} receipt(s)</small><small>{new Date(c.created_at).toLocaleString()}</small></span></div>)}{!claims.length && <div className="quiet">No saved claims yet.</div>}</div>{error && <div className="alert error">{error}</div>}</div></>}
        {page === 'manager' && isManager && <>{head('Manager Approvals', 'Review employee submissions and original receipts')}<div className="screen-padding"><button className="btn secondary big" onClick={refreshQueue} disabled={queueBusy}><RefreshCw size={17} /> Refresh Pending Queue</button>{managerError && <div className="alert error">{managerError}</div>}{!queue.length && <div className="quiet">No pending claims.</div>}{queue.map(c => <div className="panel" key={c.id}><h3>{c.title}</h3><p className="muted">Employee: {c.owner_id} · {new Date(c.submitted_at).toLocaleString()}</p>{(c.receipts || []).map(r => <div className="detail-row" key={r.id}><span>{r.merchant_name}<small>{r.category} · {r.receipt_date || 'Unknown date'}</small><button className="btn secondary" onClick={() => openReceipt(r.storage_path)}>View Photo</button>{Array.isArray(r.confidence_flags) && r.confidence_flags.length > 0 && <small>AI flags: {r.confidence_flags.join(', ')}</small>}</span><b>{money(r.total)}</b></div>)}<label className="form-label">Decision note / rejection reason</label><textarea className="field" value={notes[c.id] || ''} onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))} placeholder="Required for rejection" /><div className="manager-actions"><button className="btn primary" disabled={queueBusy || c.owner_id === session.user.id} onClick={() => decide(c.id, 'approved')}><Check size={17} /> Approve</button><button className="btn secondary" disabled={queueBusy || c.owner_id === session.user.id || (notes[c.id] || '').trim().length < 3} onClick={() => decide(c.id, 'rejected')}><X size={17} /> Reject</button></div>{c.owner_id === session.user.id && <p className="fineprint">You cannot approve your own claim.</p>}</div>)}</div></>}
        {page === 'profile' && <>{head('Profile & Settings', 'Your organization and connection')}<div className="screen-padding"><div className="panel"><h3>{session.user.email}</h3><div className="detail-row"><span>API</span><b>{online ? 'Connected' : 'Unavailable'}</b></div><div className="detail-row"><span>Role</span><b>{isManager ? 'Manager' : 'Employee'}</b></div><div className="detail-row"><span>Approval destination</span><b>Manager dashboard</b></div><label className="form-label">Organization</label><select className="field" value={orgId} onChange={e => setOrgId(e.target.value)}>{memberships.map(m => <option key={m.organization_id} value={m.organization_id}>{m.organizations?.name || m.organization_id} · {m.role}</option>)}</select><button className="btn secondary big" onClick={() => supabase.auth.signOut()}>Sign out</button></div></div></>}
    </div><nav className="bottom-nav">{[['home', Home, 'Home'], ['history', ClipboardList, 'Claims'], ...(isManager ? [['manager', ShieldCheck, 'Approvals']] : []), ['packet', FolderOpen, 'Summary'], ['profile', UserRound, 'Profile']].map(([id, Icon, label]) => <button key={id} onClick={() => go(id)} className={page === id ? 'active' : ''}><Icon size={20} /><span>{label}</span></button>)}</nav></div><div className="desktop-caption"><b>ClaimFlow</b><span>Employee → Gemini AI → Supabase → Manager Approval</span></div></div>
}
