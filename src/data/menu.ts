export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  category: "burger" | "sandwich";
};

export const menuItems: MenuItem[] = [
  {
    id: "obama",
    name: "Обама",
    description: "Плотный фирменный бургер с сочной котлетой, сыром и соусом KARIMOFF.",
    price: 430,
    image: "/assets/burger-obama.png",
    category: "burger"
  },
  {
    id: "tyson",
    name: "Тайсон",
    description: "Мясной акцент, мягкая булочка, насыщенный соус и уверенный вкус.",
    price: 430,
    image: "/assets/burger-tyson.png",
    category: "burger"
  },
  {
    id: "dragon-warrior",
    name: "Воин Дракона",
    description: "Яркий бургер с выразительным соусом, свежими овощами и балансом остроты.",
    price: 390,
    image: "/assets/burger-dragon.png",
    category: "burger"
  },
  {
    id: "buterbrod",
    name: "Бутерброд",
    description: "Сытный street food формат на каждый день: просто, быстро и по делу.",
    price: 400,
    image: "/assets/sandwich-buterbrod.png",
    category: "sandwich"
  }
];
