create table if not exists public.site_settings (
  id text primary key default 'main'
);

alter table public.site_settings add column if not exists telegram_url text;
alter table public.site_settings add column if not exists instagram_url text;
alter table public.site_settings add column if not exists tiktok_url text;

insert into public.site_settings (id)
values ('main')
on conflict (id) do nothing;

update public.site_settings
set
  telegram_url = coalesce(telegram_url, 'https://t.me/juikaifui'),
  instagram_url = coalesce(instagram_url, 'https://www.instagram.com/_guikaifui_/'),
  tiktok_url = coalesce(tiktok_url, 'https://www.tiktok.com/@karimich_11.0')
where id = 'main';
