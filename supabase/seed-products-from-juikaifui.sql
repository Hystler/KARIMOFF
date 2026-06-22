-- Seed generated from juikaifui.ru menu.
-- Run supabase/products.sql before this seed if the products table is not created yet.

insert into public.products (
  slug,
  name,
  category,
  description,
  price,
  image_url,
  is_active,
  sort_order,
  weight
) values
  ('rokki', 'Рокки', 'Бургеры', 'Пшеничная булочка, соус чесночный и сырный, сочная котлета из говядины, сыр чеддер, сырные палочки моцарелла, салат, помидор, красный лук.', 450.00, '/assets/products/burgers/rokki.webp', true, 1, '1 шт.'),
  ('sebastian', 'Себастиан', 'Бургеры', 'Пшеничная булочка, соус цезарь, салат, помидор, красный лук, королевские креветки.', 430.00, '/assets/products/burgers/sebastian.webp', true, 2, '1 шт.'),
  ('kantrigrand', 'Бургер КантриГранд сочная котлета из говядины', 'Бургеры', 'Пшеничная булочка, соус барбекю и кетчуп, сочная говяжья котлета, сыр чеддер, свежий салат, помидор и маринованный огурец.', 390.00, '/assets/products/burgers/kantrigrand.webp', true, 3, '1 шт.'),
  ('borak-abama', 'Борак Абама', 'Бургеры', 'Черная булочка, фирменный соус барбекю, лист салата, свежий помидор, маринованный огурец, красный лук, сочная котлета из говядины, сыр чеддер.', 430.00, '/assets/products/burgers/borak-abama.webp', true, 4, '1 шт.'),
  ('voin-drakona', 'Бургер Воин Дракона с сочной говядиной', 'Бургеры', 'Пшеничная булочка, соус фирменный чесночный, салат, лук фри, свежий помидор, сочная котлета из говядины, сыр чеддер.', 390.00, '/assets/products/burgers/voin-drakona.webp', true, 5, '1 шт.'),
  ('kantribif', 'Бургер КантриБиф с котлетой из говядины', 'Бургеры', 'Пшеничная булочка, соус медовая-горчица и кетчуп, салат, помидор, маринованный огурец, красный лук, сочная котлета из говядины, сыр чеддер.', 390.00, '/assets/products/burgers/kantribif.webp', true, 6, '1 шт.'),
  ('tayson', 'Бургер Тайсон с сочной котлетой из говядины и жареным беконом', 'Бургеры', 'Пшеничная булочка, фирменный соус тейсти, сочная котлета из говядины, помидор, маринованный огурец, салат, жареный бекон, сыр чеддер.', 430.00, '/assets/products/burgers/tayson.webp', true, 7, '1 шт.'),
  ('firmennaya-shaurma', 'Фирменная Шаурма', 'Шаурма', 'Состав: Лаваш тандырный, Фирменный соус барбекю, Сочная курочка, картошка фри, бекон жареный, Маринованный огурец, красный лук, свежий помидор, Сырные палочки.', 550.00, '/assets/products/shaurma/firmennaya-shaurma.webp', true, 8, '1 шт.'),
  ('shaurma-v-lepeshke-s-zapechennoy-govyadinoy', 'Шаурма в лепешке с запеченной говядиной', 'Шаурма', 'Состав: Тандырная лепешка, Фирменный чесночный соус, Говядина запеченная, Свежие овощи: капуста, помидор, огурец, красный лук, Фирменный чесночный соус.', 460.00, '/assets/products/shaurma/shaurma-v-lepeshke-s-zapechennoy-govyadinoy.webp', true, 9, '1 ед.'),
  ('shaurma-v-lepeshke-s-zapechennoy-svininoy', 'Шаурма в лепешке с запеченной свининой', 'Шаурма', 'Состав: Тандырная лепешка, Соус фирменный чесночный, Свинина запеченная, Свежие овощи: капуста, помидор, огурец, красный лук.', 390.00, '/assets/products/shaurma/shaurma-v-lepeshke-s-zapechennoy-svininoy.webp', true, 10, '1 ед.'),
  ('shaurma-v-lepeshke-s-sochnoy-kurochkoy', 'Шаурма в лепешке с сочной курочкой', 'Шаурма', 'Состав: Тандырная лепешка, Фирменный чесночный соус, Сочная курочка, Свежие овощи: капуста, помидор, огурец, красный лук', 290.00, '/assets/products/shaurma/shaurma-v-lepeshke-s-sochnoy-kurochkoy.webp', true, 11, '1 ед.'),
  ('shaurma-s-korolevskoy-krevetkoy-v-panirovke', 'Шаурма с Королевской креветкой в панировке', 'Шаурма', 'Состав: Тандырный лаваш, Соус Цезарь, Королевские креветки, Свежие овощи: капуста, помидор, красный лук', 410.00, '/assets/products/shaurma/shaurma-s-korolevskoy-krevetkoy-v-panirovke.webp', true, 12, '300 г.'),
  ('shaurma-s-zapechennoy-govyadinoy', 'Шаурма с запеченной говядиной', 'Шаурма', 'Состав: Лаваш тандырный, Соус фирменный чесночный, Говядина запеченная, Свежие овощи: капуста, помидор, огурец, красный лук', 410.00, '/assets/products/shaurma/shaurma-s-zapechennoy-govyadinoy.webp', true, 13, '370 г.'),
  ('shaurma-s-zapechennoy-svininoy', 'Шаурма с запеченной свининой', 'Шаурма', 'Состав: Лаваш тандырный, Соус фирменный чесночный, Свинина запеченная, Свежие овощи: капуста, помидор, огурец, красный лук', 350.00, '/assets/products/shaurma/shaurma-s-zapechennoy-svininoy.webp', true, 14, '370 г.'),
  ('shaurma-kurinaya', 'Шаурма куриная', 'Шаурма', 'Состав: Лаваш тандырный, Соус фирменный чесночный, Сочная курочка, Свежие овощи: капуста, помидор, огурец, красный лук', 240.00, '/assets/products/shaurma/shaurma-kurinaya.webp', true, 15, '1 шт.'),
  ('hot-dog-barbekyu', 'Хот-Дог Барбекю', 'Хот-Доги', 'Состав: Пшеничная булочка, Колбаска из свинины, Свежие овощи: лист салата, помидор, Маринованный огурец, Фирменный соус барбекю, Лук фри', 260.00, '/assets/products/hotdogs/hot-dog-barbekyu.webp', true, 16, '1 шт.'),
  ('hot-dog-itali', 'Хот-Дог Итали', 'Хот-Доги', 'Состав: Пшеничная булочка, Колбаска из свинины, Лист салата, сыр чеддер, Сырный соус, Лук фри', 280.00, '/assets/products/hotdogs/hot-dog-itali.webp', true, 17, '1 шт.'),
  ('hot-dog-datskiy', 'Хот-Дог Датский', 'Хот-Доги', 'Состав: Пшеничная булочка, Колбаска из свинины, Лист салата, маринованный огурец, Соусы: кетчуп, медово-горчичный, Лук фри', 250.00, '/assets/products/hotdogs/hot-dog-datskiy.webp', true, 18, '1 шт.'),
  ('aydahoboks', 'АйдахоБокс', 'Боксы', 'Состав: Картофель по-деревенски, Сочная курочка, Жареный бекон, Лук фри, Сырный соус', 310.00, '/assets/products/boxes/aydahoboks.webp', true, 19, '1 шт.'),
  ('boksfud', 'БоксФуд', 'Боксы', 'Состав: Картофель фри, Сочная курочка, Маринованный огурец, Лук фри, Фирменный чесночный соус', 300.00, '/assets/products/boxes/boksfud.webp', true, 20, '1 шт.'),
  ('krevetki-v-panirovke-korolevskie', 'Креветки в панировке (королевские)', 'Горячие закуски', 'Попробуйте наши королевские креветки в панировке! Это идеальный снек для большой компании.', 390.00, '/assets/products/snacks/krevetki-v-panirovke-korolevskie.webp', true, 21, '6 шт.'),
  ('naggetsy-6-sht', 'Наггетсы', 'Горячие закуски', 'Хрустящие кусочки нежного филе в золотистой панировке. Идеальный перекус!', 210.00, '/assets/products/snacks/naggetsy-6-sht.webp', true, 22, '6 ед.'),
  ('syrnye-palochki-12-sht', 'Сырные палочки', 'Горячие закуски', 'Сырные палочки — отличный вариант для любителей сыра. Это аппетитный снек из сыра моцарелла. Заказывайте сырные палочки и наслаждайтесь их изысканным вкусом!', 320.00, '/assets/products/snacks/syrnye-palochki-12-sht.webp', true, 23, '6 шт.'),
  ('kartofel-po-derevenski', 'Картофель по деревенски', 'Горячие закуски', 'Хрустящий картофель с мягкой сердцевиной — отличное решение для перекуса. Он подаётся горячим и хорошо сочетается с различными соусами. Это простое, но вкусное блюдо, которое идеально подходит для уютного вечера.', 260.00, '/assets/products/snacks/kartofel-po-derevenski.webp', true, 24, '150 г.'),
  ('kartoshka-fri-200-gr', 'Картошка фри', 'Горячие закуски', 'Картофель фри — идеальный выбор для любителей снеков. Хрустящий и аппетитный, он станет отличным дополнением к вашему заказу.', 210.00, '/assets/products/snacks/kartoshka-fri-200-gr.webp', true, 25, '150 г.'),
  ('krylyshki-barbekyu-16-sht', 'Крылышки куриные Барбекю', 'Горячие закуски', 'Это блюдо придётся по вкусу тем, кто любит мясо птицы, оно отлично подойдёт в качестве закуски., Нежные куриные крылья дополнены фирменным соусом барбекю. Мясо птицы получается сочным и ароматным., Это блюдо порадует вас насыщенным вкусом и станет отличным выбором для компании!', 370.00, '/assets/products/snacks/krylyshki-barbekyu-16-sht.webp', true, 26, '8 шт.'),
  ('dobryy-apelsin-1-l', 'Добрый Апельсин 1 л', 'Напитки', 'Апельсин', 140.00, '/assets/products/drinks/dobryy-apelsin-1-l.webp', true, 27, '1 л.'),
  ('dobryy-kola-1-l', 'Добрый Кола 1 л', 'Напитки', 'Кола', 140.00, '/assets/products/drinks/dobryy-kola-1-l.webp', true, 28, '1 л.'),
  ('dobryy-kola-1-l-bez-sahara', 'Добрый Кола 1 л без сахара', 'Напитки', 'Кола без сахара', 140.00, '/assets/products/drinks/dobryy-kola-1-l-bez-sahara.webp', true, 29, '1 л.'),
  ('dobryy-kola-0-5-bez-sahara', 'Добрый Кола 0,5 без сахара', 'Напитки', 'Кола без сахара', 100.00, '/assets/products/drinks/dobryy-kola-0-5-bez-sahara.webp', true, 30, '500 мл.'),
  ('dobryy-kola-0-5', 'Добрый Кола 0,5', 'Напитки', 'Кола', 100.00, '/assets/products/drinks/dobryy-kola-0-5.webp', true, 31, '500 мл.'),
  ('dobryy-apelsin-0-5', 'Добрый Апельсин 0,5', 'Напитки', 'Апельсин', 100.00, '/assets/products/drinks/dobryy-apelsin-0-5.webp', true, 32, '500 мл.'),
  ('dobryy-apelsin-zhb-0-33l', 'Добрый Апельсин жб 0,33л', 'Напитки', 'Апельсин', 90.00, '/assets/products/drinks/dobryy-apelsin-zhb-0-33l.webp', true, 33, '300 мл.'),
  ('dobryy-kola-zhb-0-33l-bez-sahara', 'Добрый Кола жб 0,33л (без сахара)', 'Напитки', 'Кола без сахара', 90.00, '/assets/products/drinks/dobryy-kola-zhb-0-33l-bez-sahara.webp', true, 34, '300 мл.'),
  ('ketchup', 'Кетчуп', 'Соусы', 'Густой, ароматный, приготовленный из отборных спелых томатов. Этот соус обладает ярким, сладковато-пряным томатным вкусом с лёгкой кислинкой и пикантностью. Он способен сделать любое кулинарное творение более выразительным и запоминающимся. Кетчуп станет отличным дополнением к мясным и рыбным блюдам, пасте, гарнирам и закускам.', 40.00, '/assets/products/sauces/ketchup.webp', true, 35, '25 г.'),
  ('syrnyy', 'Сырный соус', 'Соусы', 'Сырный соус – это настоящая находка для любителей сыра. Нежный и ароматный, он станет идеальным дополнением к любому блюду.', 40.00, '/assets/products/sauces/syrnyy.webp', true, 36, '25 г.'),
  ('chesnochnyy', 'Фирменный Чесночный соус', 'Соусы', 'Соус – это душа блюда. Он способен придать изысканность и неповторимость даже самым простым продуктам. Наш фирменный соус, приготовленный на основе майонеза с добавлением чеснока, заставит заиграть новыми красками любое блюдо.', 40.00, '/assets/products/sauces/chesnochnyy.webp', true, 37, '25 г.'),
  ('medovaya-gorchica', 'Соус Медовая Горчица', 'Соусы', 'Соус с богатым и насыщенным вкусом, в котором сладость переплетается с малой остротой и лёгкой горчинкой. Идеально подходит для мясных блюд и птицы, а также в качестве заправки для салатов.', 40.00, '/assets/products/sauces/medovaya-gorchica.webp', true, 38, '25 г.'),
  ('barbekyu', 'Соус Барбекю фирменный', 'Соусы', 'Наш фирменный соус барбекю - густой, ароматный, пряный, идеально подойдёт к мясу. В его насыщенном вкусе чувствуется приятная сладость и пикантность базилика. Соус станет отличным дополнением к мясным блюдам, придавая им особый вкус и аромат.', 40.00, '/assets/products/sauces/barbekyu.webp', true, 39, '25 г.'),
  ('teysti', 'Фирменный соус Тейсти', 'Соусы', 'Наш фирменный соус тейсти - идеальный баланс сливочности и пикантных трав. Раскроет вкус картошки, наггетсов и бургеров. Попробуйте, чтобы узнать его магию!', 40.00, '/assets/products/sauces/teysti.webp', true, 40, '25 г.')
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  price = excluded.price,
  image_url = excluded.image_url,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  weight = excluded.weight,
  updated_at = now();

-- Optional manual cleanup for old demo placeholder products after you verify this import:
-- update public.products
-- set is_active = false, updated_at = now()
-- where image_url like '/assets/products/placeholder-%'
--   and slug not in ('rokki', 'sebastian', 'kantrigrand', 'borak-abama', 'voin-drakona', 'kantribif', 'tayson', 'firmennaya-shaurma', 'shaurma-v-lepeshke-s-zapechennoy-govyadinoy', 'shaurma-v-lepeshke-s-zapechennoy-svininoy', 'shaurma-v-lepeshke-s-sochnoy-kurochkoy', 'shaurma-s-korolevskoy-krevetkoy-v-panirovke', 'shaurma-s-zapechennoy-govyadinoy', 'shaurma-s-zapechennoy-svininoy', 'shaurma-kurinaya', 'hot-dog-barbekyu', 'hot-dog-itali', 'hot-dog-datskiy', 'aydahoboks', 'boksfud', 'krevetki-v-panirovke-korolevskie', 'naggetsy-6-sht', 'syrnye-palochki-12-sht', 'kartofel-po-derevenski', 'kartoshka-fri-200-gr', 'krylyshki-barbekyu-16-sht', 'dobryy-apelsin-1-l', 'dobryy-kola-1-l', 'dobryy-kola-1-l-bez-sahara', 'dobryy-kola-0-5-bez-sahara', 'dobryy-kola-0-5', 'dobryy-apelsin-0-5', 'dobryy-apelsin-zhb-0-33l', 'dobryy-kola-zhb-0-33l-bez-sahara', 'ketchup', 'syrnyy', 'chesnochnyy', 'medovaya-gorchica', 'barbekyu', 'teysti');
