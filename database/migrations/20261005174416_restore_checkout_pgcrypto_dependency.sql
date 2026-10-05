-- Repair pgcrypto drift without rewriting already-applied migration history.
do $$
declare
  v_schema text;
  v_rpc regprocedure := 'public.create_site_order_with_payment_from_whitelist(uuid,text,uuid,jsonb,text,jsonb,uuid,boolean,boolean,boolean,text,text,text,text,timestamptz,text,text)'::regprocedure;
  v_definition text;
  v_qualified_call text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_schema is null then
    create extension pgcrypto with schema public;
    v_schema := 'public';
  end if;

  -- Keep an existing extension in its own schema; do not relocate shared objects.
  if to_regprocedure(format('%I.digest(text,text)', v_schema)) is null then
    raise exception 'pgcrypto text digest dependency is missing';
  end if;
  if not has_schema_privilege('karimoff_app', v_schema, 'USAGE') then
    execute format('grant usage on schema %I to karimoff_app', v_schema);
  end if;
  if not has_function_privilege('karimoff_app',
    to_regprocedure(format('%I.digest(text,text)', v_schema)), 'EXECUTE') then
    raise exception 'karimoff_app requires EXECUTE on pgcrypto text digest';
  end if;

  v_definition := pg_get_functiondef(v_rpc);
  v_qualified_call := format('encode(%I.digest(jsonb_build_object(', v_schema);
  if position('encode(digest(jsonb_build_object(' in v_definition) > 0 then
    execute replace(v_definition, 'encode(digest(jsonb_build_object(', v_qualified_call);
  elsif position(v_qualified_call in v_definition) = 0 then
    raise exception 'Unexpected whitelist checkout hash expression; migration requires review';
  end if;

  execute format('select encode(%I.digest(''probe'', ''sha256''), ''hex'')', v_schema);
end
$$;
