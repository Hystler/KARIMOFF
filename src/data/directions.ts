export type DirectionItem = {
  title: string;
  description: string;
  href: string;
  cta: string;
};

export const directions: DirectionItem[] = [
  {
    title: "Меню",
    description: "Фирменные бургеры, сытные позиции и быстрый заказ без лишнего шума.",
    href: "/menu",
    cta: "Смотреть меню"
  },
  {
    title: "Для бизнеса",
    description: "Корпоративные заказы, мероприятия, pop-up форматы и партнерские проекты.",
    href: "/business",
    cta: "Для бизнеса"
  },
  {
    title: "Работа в KARIMOFF",
    description: "Кухня, сервис и управление для людей, которым важны темп и качество.",
    href: "/careers",
    cta: "Вакансии"
  },
  {
    title: "Франшиза",
    description: "Подготовленный вход в масштабирование бренда в других городах.",
    href: "/franchise",
    cta: "Смотреть франшизу"
  }
];
