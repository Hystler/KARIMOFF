insert into public.avatar_assets (type, name, value, sort_order, is_active)
values
  ('base', 'Панда', 'panda', 10, true),
  ('base', 'Круглая панда', 'panda_round', 20, true),
  ('base', 'Строгая панда', 'panda_strict', 30, true),
  ('eyes', 'Классика', 'default', 10, true),
  ('eyes', 'Весёлые', 'happy', 20, true),
  ('eyes', 'Серьёзные', 'serious', 30, true),
  ('eyes', 'Сонные', 'sleepy', 40, true),
  ('mouth', 'Улыбка', 'smile', 10, true),
  ('mouth', 'Нейтрально', 'neutral', 20, true),
  ('mouth', 'Грин', 'grin', 30, true),
  ('accessory', 'Без аксессуара', 'none', 10, true),
  ('accessory', 'Оранжевая кепка', 'orange_cap', 20, true),
  ('accessory', 'Чёрная кепка', 'black_cap', 30, true),
  ('accessory', 'Очки', 'sunglasses', 40, true),
  ('accessory', 'Пин-бургер', 'burger_pin', 50, true),
  ('clothes', 'Без одежды', 'none', 10, true),
  ('clothes', 'Чёрное худи', 'black_hoodie', 20, true),
  ('clothes', 'Оранжевый фартук', 'orange_apron', 30, true),
  ('clothes', 'Чёрный фартук', 'black_apron', 40, true),
  ('background', 'Оранжевый', 'orange', 10, true),
  ('background', 'Чёрный', 'black', 20, true),
  ('background', 'Гриль', 'grill', 30, true),
  ('background', 'Чистый', 'clean', 40, true),
  ('background', 'Неон', 'neon', 50, true)
on conflict (type, value) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

