import type { Product } from "@/lib/product-types";

function placeholder(category: string) {
  if (category === "Бургеры") {
    return "/assets/products/placeholder-burger.svg";
  }

  if (category === "Шаурма") {
    return "/assets/products/placeholder-shaurma.svg";
  }

  if (category === "Хот-Доги") {
    return "/assets/products/placeholder-hotdog.svg";
  }

  if (category === "Боксы") {
    return "/assets/products/placeholder-box.svg";
  }

  if (category === "Напитки") {
    return "/assets/products/placeholder-drink.svg";
  }

  return "/assets/products/placeholder-snack.svg";
}

type ProductSeed = Omit<Product, "id" | "created_at" | "updated_at" | "image_url" | "is_active" | "tags"> & {
  unit: string;
};

const productSeeds: ProductSeed[] = [
  {
    sort_order: 1,
    category: "Бургеры",
    slug: "rokki",
    name: "Рокки",
    price: 450,
    unit: "1 шт.",
    description:
      "Пшеничная булочка, соус чесночный и сырный, сочная котлета из говядины, сыр чеддер, сырные палочки моцарелла, салат, помидор, красный лук."
  },
  {
    sort_order: 2,
    category: "Бургеры",
    slug: "sebastian",
    name: "Себастиан",
    price: 430,
    unit: "1 шт.",
    description: "Пшеничная булочка, соус цезарь, салат, помидор, красный лук, королевские креветки."
  },
  {
    sort_order: 3,
    category: "Бургеры",
    slug: "kantrigrand",
    name: "Бургер КантриГранд сочная котлета из говядины",
    price: 390,
    unit: "1 шт.",
    description:
      "Пшеничная булочка, соус барбекю и кетчуп, сочная говяжья котлета, сыр чеддер, свежий салат, помидор и маринованный огурец."
  },
  {
    sort_order: 4,
    category: "Бургеры",
    slug: "borak-abama",
    name: "Борак Абама",
    price: 430,
    unit: "1 шт.",
    description:
      "Черная булочка, фирменный соус барбекю, лист салата, свежий помидор, маринованный огурец, красный лук, сочная котлета из говядины, сыр чеддер."
  },
  {
    sort_order: 5,
    category: "Бургеры",
    slug: "voin-drakona",
    name: "Бургер Воин Дракона с сочной говядиной",
    price: 390,
    unit: "1 шт.",
    description:
      "Пшеничная булочка, соус фирменный чесночный, салат, лук фри, свежий помидор, сочная котлета из говядины, сыр чеддер."
  },
  {
    sort_order: 6,
    category: "Бургеры",
    slug: "kantribif",
    name: "Бургер КантриБиф с котлетой из говядины",
    price: 390,
    unit: "1 шт.",
    description:
      "Пшеничная булочка, соус медовая-горчица и кетчуп, салат, помидор, маринованный огурец, красный лук, сочная котлета из говядины, сыр чеддер."
  },
  {
    sort_order: 7,
    category: "Бургеры",
    slug: "tayson",
    name: "Бургер Тайсон с сочной котлетой из говядины и жареным беконом",
    price: 430,
    unit: "1 шт.",
    description:
      "Пшеничная булочка, фирменный соус тейсти, сочная котлета из говядины, помидор, маринованный огурец, салат, жареный бекон, сыр чеддер."
  },
  {
    sort_order: 8,
    category: "Шаурма",
    slug: "firmennaya-shaurma",
    name: "Фирменная Шаурма",
    price: 550,
    unit: "1 шт.",
    description:
      "Лаваш тандырный, фирменный соус барбекю, сочная курочка, картошка фри, бекон жареный, маринованный огурец, красный лук, свежий помидор, сырные палочки."
  },
  {
    sort_order: 9,
    category: "Шаурма",
    slug: "shaurma-v-lepeshke-govyadina",
    name: "Шаурма в лепешке с запеченной говядиной",
    price: 460,
    unit: "1 ед.",
    description:
      "Тандырная лепешка, фирменный чесночный соус, говядина запеченная, свежие овощи: капуста, помидор, огурец, красный лук."
  },
  {
    sort_order: 10,
    category: "Шаурма",
    slug: "shaurma-v-lepeshke-svinina",
    name: "Шаурма в лепешке с запеченной свининой",
    price: 390,
    unit: "1 ед.",
    description:
      "Тандырная лепешка, соус фирменный чесночный, свинина запеченная, свежие овощи: капуста, помидор, огурец, красный лук."
  },
  {
    sort_order: 11,
    category: "Шаурма",
    slug: "shaurma-v-lepeshke-kuritsa",
    name: "Шаурма в лепешке с сочной курочкой",
    price: 290,
    unit: "1 ед.",
    description:
      "Тандырная лепешка, фирменный чесночный соус, сочная курочка, свежие овощи: капуста, помидор, огурец, красный лук."
  },
  {
    sort_order: 12,
    category: "Шаурма",
    slug: "shaurma-krevetka",
    name: "Шаурма с Королевской креветкой в панировке",
    price: 410,
    unit: "300 г.",
    description: "Тандырный лаваш, соус Цезарь, королевские креветки, свежие овощи: капуста, помидор, красный лук."
  },
  {
    sort_order: 13,
    category: "Шаурма",
    slug: "shaurma-zapechennaya-govyadina",
    name: "Шаурма с запеченной говядиной",
    price: 410,
    unit: "370 г.",
    description:
      "Лаваш тандырный, соус фирменный чесночный, говядина запеченная, свежие овощи: капуста, помидор, огурец, красный лук."
  },
  {
    sort_order: 14,
    category: "Шаурма",
    slug: "shaurma-zapechennaya-svinina",
    name: "Шаурма с запеченной свининой",
    price: 350,
    unit: "370 г.",
    description:
      "Лаваш тандырный, соус фирменный чесночный, свинина запеченная, свежие овощи: капуста, помидор, огурец, красный лук."
  },
  {
    sort_order: 15,
    category: "Шаурма",
    slug: "shaurma-kurinaya",
    name: "Шаурма куриная",
    price: 240,
    unit: "1 шт.",
    description:
      "Лаваш тандырный, соус фирменный чесночный, сочная курочка, свежие овощи: капуста, помидор, огурец, красный лук."
  },
  {
    sort_order: 16,
    category: "Хот-Доги",
    slug: "hot-dog-barbekyu",
    name: "Хот-Дог Барбекю",
    price: 260,
    unit: "1 шт.",
    description:
      "Пшеничная булочка, колбаска из свинины, свежие овощи: лист салата, помидор, маринованный огурец, фирменный соус барбекю, лук фри."
  },
  {
    sort_order: 17,
    category: "Хот-Доги",
    slug: "hot-dog-itali",
    name: "Хот-Дог Итали",
    price: 280,
    unit: "1 шт.",
    description: "Пшеничная булочка, колбаска из свинины, лист салата, сыр чеддер, сырный соус, лук фри."
  },
  {
    sort_order: 18,
    category: "Хот-Доги",
    slug: "hot-dog-datskiy",
    name: "Хот-Дог Датский",
    price: 250,
    unit: "1 шт.",
    description:
      "Пшеничная булочка, колбаска из свинины, лист салата, маринованный огурец, соусы: кетчуп, медово-горчичный, лук фри."
  },
  {
    sort_order: 19,
    category: "Боксы",
    slug: "aydahobox",
    name: "АйдахоБокс",
    price: 310,
    unit: "1 шт.",
    description: "Картофель по-деревенски, сочная курочка, жареный бекон, лук фри, сырный соус."
  },
  {
    sort_order: 20,
    category: "Боксы",
    slug: "boxfood",
    name: "БоксФуд",
    price: 300,
    unit: "1 шт.",
    description: "Картофель фри, сочная курочка, маринованный огурец, лук фри, фирменный чесночный соус."
  },
  {
    sort_order: 21,
    category: "Горячие закуски",
    slug: "krevetki-v-panirovke",
    name: "Креветки в панировке (королевские)",
    price: 390,
    unit: "6/12 шт.",
    description: "Королевские креветки в панировке — снек для компании."
  },
  {
    sort_order: 22,
    category: "Горячие закуски",
    slug: "naggetsy",
    name: "Наггетсы",
    price: 210,
    unit: "6/12 ед.",
    description: "Хрустящие кусочки нежного филе в золотистой панировке."
  },
  {
    sort_order: 23,
    category: "Горячие закуски",
    slug: "syrnye-palochki",
    name: "Сырные палочки",
    price: 590,
    unit: "12/6 шт.",
    description: "Сырные палочки из моцареллы."
  },
  {
    sort_order: 24,
    category: "Горячие закуски",
    slug: "kartofel-po-derevenski",
    name: "Картофель по деревенски",
    price: 260,
    unit: "150/200 г.",
    description: "Хрустящий картофель с мягкой сердцевиной."
  },
  {
    sort_order: 25,
    category: "Горячие закуски",
    slug: "kartoshka-fri",
    name: "Картошка фри",
    price: 210,
    unit: "150/200 г.",
    description: "Хрустящий картофель фри."
  },
  {
    sort_order: 26,
    category: "Горячие закуски",
    slug: "krylyshki-barbekyu",
    name: "Крылышки куриные Барбекю",
    price: 650,
    unit: "16/8 шт.",
    description: "Куриные крылья с фирменным соусом барбекю."
  },
  {
    sort_order: 27,
    category: "Напитки",
    slug: "dobryy-apelsin-1l",
    name: "Добрый Апельсин 1 л",
    price: 140,
    unit: "1 л.",
    description: "Апельсин."
  },
  {
    sort_order: 28,
    category: "Напитки",
    slug: "dobryy-kola-1l",
    name: "Добрый Кола 1 л",
    price: 140,
    unit: "1 л.",
    description: "Кола."
  },
  {
    sort_order: 29,
    category: "Напитки",
    slug: "dobryy-kola-zero-1l",
    name: "Добрый Кола 1 л без сахара",
    price: 140,
    unit: "1 л.",
    description: "Кола без сахара."
  },
  {
    sort_order: 30,
    category: "Напитки",
    slug: "dobryy-kola-zero-05",
    name: "Добрый Кола 0,5 без сахара",
    price: 100,
    unit: "500 мл.",
    description: "Кола без сахара."
  },
  {
    sort_order: 31,
    category: "Напитки",
    slug: "dobryy-kola-05",
    name: "Добрый Кола 0,5",
    price: 100,
    unit: "500 мл.",
    description: "Кола."
  },
  {
    sort_order: 32,
    category: "Напитки",
    slug: "dobryy-apelsin-05",
    name: "Добрый Апельсин 0,5",
    price: 100,
    unit: "500 мл.",
    description: "Апельсин."
  },
  {
    sort_order: 33,
    category: "Напитки",
    slug: "dobryy-apelsin-can-033",
    name: "Добрый Апельсин жб 0,33л",
    price: 90,
    unit: "300 мл.",
    description: "Апельсин."
  },
  {
    sort_order: 34,
    category: "Напитки",
    slug: "dobryy-kola-zero-can-033",
    name: "Добрый Кола жб 0,33л (без сахара)",
    price: 90,
    unit: "300 мл.",
    description: "Кола без сахара."
  }
];

export const demoProducts: Product[] = productSeeds.map((product) => ({
  id: product.slug,
  name: product.name,
  slug: product.slug,
  category: product.category,
  description: product.description,
  price: product.price,
  image_url: placeholder(product.category),
  is_active: true,
  sort_order: product.sort_order,
  weight: product.unit,
  tags: null
}));
