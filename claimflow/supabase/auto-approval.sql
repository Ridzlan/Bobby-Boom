-- Run in Supabase SQL Editor. Only a trusted backend using the service role
-- can attest extraction confidence and a verified business purpose.
-- This deliberately FAILS CLOSED until that backend integration is built.
create table if not exists public.claimflow_verified_evidence (
 claim_id uuid primary key references public.claims(id) on delete cascade,
 confidence numeric not null check (confidence between 0 and 1),
 purpose_verified boolean not null default false,
 verified_at timestamptz not null default now()
);
alter table public.claimflow_verified_evidence enable row level security;
revoke all on public.claimflow_verified_evidence from public, anon, authenticated;

create or replace function public.claimflow_auto_decide(p_claim_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
 c record;
 evidence record;
 n integer;
 sum_total numeric;
 duplicates integer;
 invalid integer;
begin
 select id,organization_id,owner_id,status into c
 from public.claims where id=p_claim_id for update;
 if not found then raise exception 'Claim not found'; end if;
 if auth.uid() is null or not exists (
  select 1 from public.memberships m
  where m.organization_id=c.organization_id and m.user_id=auth.uid()
  and (m.user_id=c.owner_id or m.role='manager')
 ) then raise exception 'Not authorized'; end if;
 if c.status <> 'draft' then return 'already_'||c.status; end if;
 select count(*), coalesce(sum(total),0),
 count(*) filter (where currency is distinct from 'MYR' or total is null or total < 0
 or receipt_date is null or coalesce(trim(merchant_name),'')=''
 or coalesce(trim(business_purpose),'')='' or category is null
 or coalesce(jsonb_array_length(to_jsonb(confidence_flags)),0)>0)
 into n,sum_total,invalid from public.receipts where claim_id=c.id;
 if n=0 or sum_total>500 or invalid>0 then return 'needs_review_policy'; end if;
 -- Check exact merchant/date/amount duplicates across the organization, not just this batch.
 select count(*) into duplicates from public.receipts r
 join public.receipts other on other.organization_id=r.organization_id
  and other.id<>r.id and lower(trim(other.merchant_name))=lower(trim(r.merchant_name))
  and other.receipt_date=r.receipt_date and other.total=r.total
 where r.claim_id=c.id;
 if duplicates>0 then return 'needs_review_duplicate'; end if;
 select confidence,purpose_verified into evidence
 from public.claimflow_verified_evidence where claim_id=c.id;
 if not found or evidence.confidence < 0.90 or not evidence.purpose_verified then
  return 'needs_review_unverified_evidence';
 end if;
 update public.claims set status='approved' where id=c.id and status='draft';
 return 'approved';
end $$;
revoke all on function public.claimflow_auto_decide(uuid) from public,anon;
grant execute on function public.claimflow_auto_decide(uuid) to authenticated;
