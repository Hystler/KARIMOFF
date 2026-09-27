begin;

update public.customer_avatars
set
  base = case base
    when 'panda' then 'panda_core'
    when 'panda_round' then 'panda_rookie'
    when 'panda_strict' then 'panda_titan'
    else base
  end,
  eyes = case eyes
    when 'default' then 'bright'
    when 'serious' then 'focused'
    else eyes
  end,
  clothes = case clothes
    when 'none' then 'varsity_orange'
    when 'orange_apron' then 'chef_jacket'
    when 'black_apron' then 'utility_black'
    else clothes
  end,
  background = case background
    when 'orange' then 'studio_orange'
    when 'black' then 'night_city'
    when 'grill' then 'kitchen_line'
    when 'neon' then 'night_city'
    else background
  end;

update public.avatar_assets
set is_active = false
where (type, value) in (
  ('base', 'panda'),
  ('base', 'panda_round'),
  ('base', 'panda_strict'),
  ('eyes', 'default'),
  ('eyes', 'serious'),
  ('accessory', 'black_cap'),
  ('accessory', 'burger_pin'),
  ('clothes', 'none'),
  ('clothes', 'orange_apron'),
  ('clothes', 'black_apron'),
  ('background', 'orange'),
  ('background', 'black'),
  ('background', 'grill'),
  ('background', 'neon')
);

insert into public.avatar_assets (type, name, value, sort_order, is_active)
values
  ('base', 'Классик', 'panda_core', 10, true),
  ('base', 'Руки', 'panda_rookie', 20, true),
  ('base', 'Титан', 'panda_titan', 30, true),
  ('eyes', 'Живые', 'bright', 10, true),
  ('eyes', 'Улыбчивые', 'happy', 20, true),
  ('eyes', 'Собранные', 'focused', 30, true),
  ('eyes', 'Спокойные', 'sleepy', 40, true),
  ('mouth', 'Улыбка', 'smile', 10, true),
  ('mouth', 'Ухмылка', 'smirk', 20, true),
  ('mouth', 'Широкая улыбка', 'grin', 30, true),
  ('mouth', 'Спокойно', 'neutral', 40, true),
  ('accessory', 'Без аксессуара', 'none', 10, true),
  ('accessory', 'Оранжевая кепка', 'orange_cap', 20, true),
  ('accessory', 'Наушники', 'headphones', 30, true),
  ('accessory', 'Тёмные очки', 'sunglasses', 40, true),
  ('accessory', 'Оранжевый визор', 'orange_visor', 50, true),
  ('clothes', 'Куртка KARIMOFF', 'varsity_orange', 10, true),
  ('clothes', 'Графитовое худи', 'black_hoodie', 20, true),
  ('clothes', 'Китель шефа', 'chef_jacket', 30, true),
  ('clothes', 'Чёрный utility', 'utility_black', 40, true),
  ('background', 'Orange studio', 'studio_orange', 10, true),
  ('background', 'Ночной город', 'night_city', 20, true),
  ('background', 'Открытая кухня', 'kitchen_line', 30, true),
  ('background', 'Светлая студия', 'clean', 40, true)
on conflict (type, value) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

commit;
