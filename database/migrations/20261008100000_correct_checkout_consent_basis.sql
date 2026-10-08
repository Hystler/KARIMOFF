-- Personal data required to perform an order is processed under the contract.
-- Keep old RPC arguments for compatibility, but do not require or record a PD consent.
alter table public.cookie_consents
  add column if not exists document_version text not null default 'legacy-unversioned';

alter table public.legal_consents
  add column if not exists order_id uuid references public.orders(id) on delete restrict;
create index if not exists legal_consents_order_idx on public.legal_consents(order_id)
  where order_id is not null;

create or replace function public.create_site_order(
  p_customer_id uuid, p_delivery_type text, p_address text, p_comment text,
  p_items jsonb, p_idempotency_key uuid, p_personal_data_granted boolean,
  p_offer_accepted boolean, p_marketing_granted boolean, p_document_version text,
  p_source_path text, p_user_agent_short text, p_fulfillment_mode text,
  p_requested_at timestamptz
)
returns table(order_id uuid, total numeric)
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_customer public.customers%rowtype;
  v_existing public.orders%rowtype;
  v_order_id uuid;
  v_total numeric;
begin
  if not p_offer_accepted then raise exception using errcode = 'P0001', message = 'Требуется принять публичную оферту.'; end if;
  if p_delivery_type not in ('pickup', 'delivery') then raise exception using errcode = 'P0001', message = 'Некорректный тип получения.'; end if;
  if p_delivery_type = 'delivery' and nullif(btrim(coalesce(p_address, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'Укажите адрес доставки.';
  end if;
  if p_fulfillment_mode not in ('asap', 'scheduled') then raise exception using errcode = 'P0001', message = 'Некорректное время получения.'; end if;
  if p_fulfillment_mode = 'scheduled' and (
    p_requested_at is null or p_requested_at < now() + interval '15 minutes'
    or (p_requested_at at time zone 'Europe/Moscow')::date <> (now() at time zone 'Europe/Moscow')::date
  ) then raise exception using errcode = 'P0001', message = 'Выберите доступное время получения на сегодня.'; end if;

  select * into v_customer from public.customers where id = p_customer_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Профиль клиента не найден.'; end if;
  if p_idempotency_key is not null then
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key for update;
    if found then
      if v_existing.customer_id <> p_customer_id then raise exception using errcode = 'P0001', message = 'Некорректный ключ повторного запроса.'; end if;
      return query select v_existing.id, v_existing.total;
      return;
    end if;
  end if;

  insert into public.orders (
    customer_id, customer_name, customer_phone, public_display_name, delivery_type,
    address, comment, status, total, source, idempotency_key, payment_status,
    fiscal_status, fulfillment_mode, requested_at, source_metadata
  ) values (
    v_customer.id, v_customer.name, v_customer.phone, v_customer.name, p_delivery_type,
    case when p_delivery_type = 'delivery' then nullif(btrim(p_address), '') else null end,
    nullif(btrim(coalesce(p_comment, '')), ''), 'new', 0, 'web', p_idempotency_key,
    'not_required', 'not_required', p_fulfillment_mode,
    case when p_fulfillment_mode = 'scheduled' then p_requested_at else null end,
    jsonb_build_object('channel', 'web')
  ) returning id into v_order_id;

  v_total := public.populate_order_items_atomic(v_order_id, p_items);
  update public.orders set total = v_total, updated_at = now() where id = v_order_id;

  insert into public.legal_consents (
    subject_type, subject_id, order_id, consent_type, document_version, granted,
    granted_at, revoked_at, source_path, user_agent_short
  ) values (
    'customer', v_customer.id, v_order_id, 'offer_acceptance', p_document_version,
    true, now(), null, p_source_path, left(p_user_agent_short, 255)
  );

  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, source_path, user_agent_short)
  values ('customer', v_customer.id, 'order.create', 'order', v_order_id::text,
    jsonb_build_object('total', v_total, 'delivery_type', p_delivery_type,
      'fulfillment_mode', p_fulfillment_mode, 'requested_at', p_requested_at),
    p_source_path, left(p_user_agent_short, 255));
  return query select v_order_id, v_total;
end
$$;

-- The 15-argument release overload marks online orders operational after the
-- canonical order transaction, preserving the current payment flow.
create or replace function public.create_site_order(
  p_customer_id uuid, p_delivery_type text, p_address text, p_comment text,
  p_items jsonb, p_idempotency_key uuid, p_personal_data_granted boolean,
  p_offer_accepted boolean, p_marketing_granted boolean, p_document_version text,
  p_source_path text, p_user_agent_short text, p_fulfillment_mode text,
  p_requested_at timestamptz, p_is_test boolean
)
returns table(order_id uuid, total numeric)
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare v_result record;
begin
  select * into v_result from public.create_site_order(
    p_customer_id, p_delivery_type, p_address, p_comment, p_items, p_idempotency_key,
    p_personal_data_granted, p_offer_accepted, p_marketing_granted, p_document_version,
    p_source_path, p_user_agent_short, p_fulfillment_mode, p_requested_at
  );
  update public.orders set is_operational = true,
    operational_started_at = coalesce(operational_started_at, created_at, now()),
    is_test = p_is_test,
    source_metadata = coalesce(source_metadata, '{}'::jsonb) || jsonb_build_object('test_order', p_is_test),
    updated_at = now() where id = v_result.order_id;
  return query select v_result.order_id::uuid, v_result.total::numeric;
end
$$;

create or replace function public.create_lead_with_consents_atomic(
  p_name text,
  p_phone text,
  p_interest text,
  p_comment text,
  p_source text,
  p_consent_type text,
  p_document_version text,
  p_source_path text,
  p_user_agent_short text,
  p_marketing_granted boolean
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_lead_id uuid;
  v_subject_type text;
begin
  if p_interest not in ('order', 'b2b', 'career', 'franchise', 'other') then
    raise exception using errcode = 'P0001', message = 'Некорректный тип заявки.';
  end if;
  if (p_interest = 'career' and p_consent_type <> 'careers')
    or (p_interest = 'franchise' and p_consent_type <> 'franchise')
    or (p_interest not in ('career', 'franchise') and p_consent_type is not null) then
    raise exception using errcode = 'P0001', message = 'Согласие не соответствует типу заявки.';
  end if;
  if p_interest in ('career', 'franchise') and p_consent_type is null then
    raise exception using errcode = 'P0001', message = 'Для этого типа заявки требуется соответствующее согласие.';
  end if;

  insert into public.leads (name, phone, interest, comment, source)
  values (p_name, p_phone, p_interest, nullif(btrim(coalesce(p_comment, '')), ''), p_source)
  returning id into v_lead_id;

  v_subject_type := case when p_interest = 'career' then 'candidate' else 'lead' end;
  if p_consent_type is not null then
    insert into public.legal_consents (
      subject_type, subject_id, consent_type, document_version, granted,
      granted_at, revoked_at, source_path, user_agent_short
    ) values (
      v_subject_type, v_lead_id, p_consent_type, p_document_version, true,
      now(), null, p_source_path, left(p_user_agent_short, 255)
    );
  end if;

  if p_marketing_granted then
    insert into public.legal_consents (
      subject_type, subject_id, consent_type, document_version, granted,
      granted_at, revoked_at, source_path, user_agent_short
    ) values (
      v_subject_type, v_lead_id, 'marketing', p_document_version, true,
      now(), null, p_source_path, left(p_user_agent_short, 255)
    );
  end if;

  return v_lead_id;
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'karimoff_app') then
    grant execute on function public.create_lead_with_consents_atomic(
      text, text, text, text, text, text, text, text, text, boolean
    ) to karimoff_app;
  end if;
end
$$;
