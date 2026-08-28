-- Keep guest-facing names and descriptions concise while recipes remain the composition source of truth.
with public_copy(aliases, name, description) as (
  values
    (array['rokki'], 'Рокки', 'Сырный удар: говяжья котлета, чеддер и хрустящие палочки моцареллы.'),
    (array['sebastian'], 'Себастиан', 'Бургер с королевскими креветками, свежими овощами и соусом «Цезарь».'),
    (array['kantrigrand'], 'КантриГранд', 'Большой говяжий бургер с чеддером, барбекю и хрустящим огурцом.'),
    (array['borak-abama'], 'Барак Обама', 'Фирменный говяжий бургер в чёрной булочке с чеддером и барбекю.'),
    (array['voin-drakona'], 'Воин Дракона', 'Сочный говяжий бургер с чеддером, чесночным соусом и хрустящим луком.'),
    (array['kantribif'], 'КантриБиф', 'Говядина, чеддер и медово-горчичный соус — ярко, сочно и по делу.'),
    (array['tayson'], 'Тайсон', 'Мощный говяжий бургер с жареным беконом, чеддером и соусом «Тейсти».'),
    (array['firmennaya-shaurma'], 'Фирменная шаурма', 'Максимально сытная: курочка, бекон, картофель фри и сырные палочки в тандырном лаваше.'),
    (array['shaurma-v-lepeshke-s-zapechennoy-govyadinoy', 'shaurma-v-lepeshke-govyadina'], 'Шаурма с говядиной в лепёшке', 'Запечённая говядина, свежие овощи и чесночный соус в горячей тандырной лепёшке.'),
    (array['shaurma-v-lepeshke-s-zapechennoy-svininoy', 'shaurma-v-lepeshke-svinina'], 'Шаурма со свининой в лепёшке', 'Запечённая свинина, свежие овощи и фирменный чесночный соус в тандырной лепёшке.'),
    (array['shaurma-v-lepeshke-s-sochnoy-kurochkoy', 'shaurma-v-lepeshke-kuritsa'], 'Шаурма с курицей в лепёшке', 'Сочная курочка, свежие овощи и чесночный соус в горячей тандырной лепёшке.'),
    (array['shaurma-s-korolevskoy-krevetkoy-v-panirovke', 'shaurma-krevetka'], 'Шаурма с королевскими креветками', 'Королевские креветки в хрустящей панировке, свежие овощи и соус «Цезарь».'),
    (array['shaurma-s-zapechennoy-govyadinoy', 'shaurma-zapechennaya-govyadina'], 'Шаурма с говядиной', 'Сытная шаурма с запечённой говядиной, свежими овощами и фирменным чесночным соусом.'),
    (array['shaurma-s-zapechennoy-svininoy', 'shaurma-zapechennaya-svinina'], 'Шаурма со свининой', 'Сочная запечённая свинина, свежие овощи и чесночный соус в тандырном лаваше.'),
    (array['shaurma-kurinaya'], 'Шаурма с курицей', 'Классика KARIMOFF: сочная курочка, свежие овощи и фирменный чесночный соус.'),
    (array['hot-dog-barbekyu'], 'Хот-дог Барбекю', 'Сочная свиная колбаска, свежие овощи, лук фри и фирменный барбекю.'),
    (array['hot-dog-itali'], 'Хот-дог Итали', 'Сочная колбаска с чеддером, сырным соусом и хрустящим луком.'),
    (array['hot-dog-datskiy'], 'Хот-дог Датский', 'Американская классика: колбаска, маринованный огурец, лук фри и два соуса.'),
    (array['aydahoboks', 'aydahobox'], 'Айдахо Бокс', 'Сытный бокс с картофелем по-деревенски, курочкой, беконом и сырным соусом.'),
    (array['boksfud', 'boxfood'], 'Бокс Фуд', 'Картофель фри, сочная курочка, хрустящий лук и фирменный чесночный соус.'),
    (array['krevetki-v-panirovke-korolevskie', 'krevetki-v-panirovke'], 'Королевские креветки', 'Королевские креветки в хрустящей панировке — яркая закуска для компании.'),
    (array['naggetsy-6-sht', 'naggetsy'], 'Наггетсы', 'Нежное куриное филе в золотистой хрустящей панировке.'),
    (array['syrnye-palochki-12-sht', 'syrnye-palochki'], 'Сырные палочки', 'Тягучая моцарелла в хрустящей золотистой панировке.'),
    (array['kartofel-po-derevenski'], 'Картофель по-деревенски', 'Золотистые картофельные дольки: хрустящие снаружи и мягкие внутри.'),
    (array['kartoshka-fri-200-gr', 'kartoshka-fri'], 'Картофель фри', 'Горячий золотистый картофель фри с аппетитным хрустом.'),
    (array['krylyshki-barbekyu-16-sht', 'krylyshki-barbekyu'], 'Крылышки барбекю', 'Сочные куриные крылышки в фирменном соусе барбекю.'),
    (array['dobryy-apelsin-1-l', 'dobryy-apelsin-1l'], 'Добрый Апельсин, 1 л', 'Газированный напиток с ярким апельсиновым вкусом.'),
    (array['dobryy-kola-1-l', 'dobryy-kola-1l'], 'Добрый Кола, 1 л', 'Классический вкус газированной колы.'),
    (array['dobryy-kola-1-l-bez-sahara', 'dobryy-kola-zero-1l'], 'Добрый Кола без сахара, 1 л', 'Знакомый вкус колы без сахара.'),
    (array['dobryy-kola-0-5-bez-sahara', 'dobryy-kola-zero-05'], 'Добрый Кола без сахара, 0,5 л', 'Знакомый вкус колы без сахара.'),
    (array['dobryy-kola-0-5', 'dobryy-kola-05'], 'Добрый Кола, 0,5 л', 'Классический вкус газированной колы.'),
    (array['dobryy-apelsin-0-5', 'dobryy-apelsin-05'], 'Добрый Апельсин, 0,5 л', 'Газированный напиток с ярким апельсиновым вкусом.'),
    (array['dobryy-apelsin-zhb-0-33l', 'dobryy-apelsin-can-033'], 'Добрый Апельсин, 0,33 л', 'Газированный напиток с ярким апельсиновым вкусом.'),
    (array['dobryy-kola-zhb-0-33l-bez-sahara', 'dobryy-kola-zero-can-033'], 'Добрый Кола без сахара, 0,33 л', 'Знакомый вкус колы без сахара.'),
    (array['ketchup'], 'Кетчуп', 'Насыщенный томатный соус с лёгкой кислинкой и пряной сладостью.'),
    (array['syrnyy'], 'Сырный соус', 'Нежный сливочно-сырный соус для картофеля, бургеров и закусок.'),
    (array['chesnochnyy'], 'Фирменный чесночный соус', 'Сливочный соус с ярким чесночным вкусом — фирменное дополнение KARIMOFF.'),
    (array['medovaya-gorchica'], 'Медово-горчичный соус', 'Мягкая горчичная пикантность и медовая сладость в одном соусе.'),
    (array['barbekyu'], 'Фирменный соус барбекю', 'Густой пряный барбекю со сладкими нотами и ароматом базилика.'),
    (array['teysti'], 'Фирменный соус Тейсти', 'Сливочный соус с пикантными травами для бургеров, картофеля и закусок.')
)
update public.products as product
set
  name = public_copy.name,
  description = public_copy.description,
  updated_at = now()
from public_copy
where product.slug = any(public_copy.aliases)
  and (product.name, product.description) is distinct from (public_copy.name, public_copy.description);
