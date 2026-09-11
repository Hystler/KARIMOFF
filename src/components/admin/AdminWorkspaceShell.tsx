"use client";

import {
  BarChart3,
  Bell,
  ChartNoAxesCombined,
  Boxes,
  BriefcaseBusiness,
  ChefHat,
  Cookie,
  Factory,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PackageOpen,
  ListPlus,
  Plug,
  Settings,
  ShoppingBag,
  SquareTerminal,
  Sun,
  Users,
  UtensilsCrossed,
  WalletCards,
  X
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { logoutAction } from "@/app/admin/login/actions";
import { useTheme } from "@/components/theme/ThemeProvider";
import type { CurrentStaff } from "@/lib/admin-auth";

const navigation = [
  { href: "/admin", label: "Обзор", icon: LayoutDashboard, roles: ["owner", "admin", "manager"] },
  { href: "/pos", label: "Касса POS", icon: SquareTerminal, roles: ["owner", "admin", "manager", "cashier"] },
  { href: "/kitchen", label: "Кухня", icon: ChefHat, roles: ["owner", "admin", "manager", "cashier", "cook"] },
  { href: "/admin/orders", label: "Заказы", icon: ShoppingBag, roles: ["owner", "admin", "manager", "cashier"] },
  { href: "/admin/products", label: "Меню", icon: UtensilsCrossed, roles: ["owner", "admin", "manager"] },
  { href: "/admin/ingredients", label: "Ингредиенты", icon: PackageOpen, roles: ["owner", "admin", "manager"] },
  { href: "/admin/ingredients/extras", label: "Допы к блюдам", icon: ListPlus, roles: ["owner", "admin"] },
  { href: "/admin/inventory", label: "Склад", icon: Boxes, roles: ["owner", "admin", "manager"] },
  { href: "/admin/production", label: "Производство", icon: Factory, roles: ["owner", "admin", "manager"] },
  { href: "/admin/customers", label: "Пользователи", icon: Users, roles: ["owner", "admin", "manager"] },
  { href: "/admin/economics", label: "Экономика", icon: BarChart3, roles: ["owner", "admin", "manager"] },
  { href: "/admin/analytics", label: "Аналитика", icon: ChartNoAxesCombined, roles: ["owner", "admin", "manager"] },
  { href: "/admin/integrations/evotor", label: "Эвотор", icon: Plug, roles: ["owner", "admin", "manager"] },
  { href: "/admin/loyalty", label: "Лояльность", icon: WalletCards, roles: ["owner", "admin", "manager"] },
  { href: "/admin/notifications", label: "Уведомления", icon: Bell, roles: ["owner", "admin"] },
  { href: "/admin/leads", label: "Заявки", icon: FileText, roles: ["owner", "admin", "manager"] },
  { href: "/admin/vacancies", label: "Вакансии", icon: BriefcaseBusiness, roles: ["owner", "admin", "manager"] },
  { href: "/admin/cookies", label: "Cookies", icon: Cookie, roles: ["owner", "admin", "manager"] },
  { href: "/admin/staff", label: "Сотрудники", icon: Users, roles: ["owner", "admin"] },
  { href: "/admin/settings", label: "Настройки", icon: Settings, roles: ["owner", "admin", "manager"] }
] as const;

const roleLabels = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Управляющий",
  cashier: "Кассир",
  cook: "Повар"
};

export function AdminWorkspaceShell({ staff, children }: { staff: CurrentStaff; children: ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const items = navigation.filter((item) => (item.roles as readonly string[]).includes(staff.role));
  const activeHref = items.filter(({ href }) => pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="admin-workspace">
      {isOpen ? <button type="button" className="admin-sidebar-overlay" aria-label="Закрыть меню" onClick={() => setIsOpen(false)} /> : null}
      <aside className={`admin-sidebar ${isOpen ? "admin-sidebar-open" : ""}`}>
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
          <Link href={staff.role === "cook" ? "/kitchen" : staff.role === "cashier" ? "/pos" : "/admin"} className="text-xl font-black text-white">
            KARIM<span className="text-karimoff-orange">O</span>FF
          </Link>
          <button type="button" onClick={() => setIsOpen(false)} className="admin-sidebar-close" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <nav className="admin-nav" aria-label="Разделы администрирования">
          {items.map(({ href, label, icon: Icon }) => {
            const active = activeHref === href;
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => setIsOpen(false)} className={`admin-nav-link ${active ? "admin-nav-link-active" : ""}`}>
                <Icon size={17} strokeWidth={2} className="shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto shrink-0 border-t border-white/10 p-3">
          <div className="px-3 py-1">
            <p className="truncate text-sm font-bold text-white">{staff.name}</p>
            <p className="mt-1 text-xs text-white/55">{roleLabels[staff.role]}</p>
          </div>
          <button type="button" className="admin-theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"} title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            <span>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span>
          </button>
          <form action={logoutAction} className="mt-3">
            <button type="submit" className="admin-logout">
              <LogOut size={18} />
              Выйти
            </button>
          </form>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-mobile-header">
          <button type="button" onClick={() => setIsOpen(true)} className="admin-mobile-menu" aria-label="Открыть меню">
            <Menu size={22} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-black">{staff.name}</p>
            <p className="text-xs text-karimoff-muted">{roleLabels[staff.role]}</p>
          </div>
          <button type="button" className="admin-mobile-theme" onClick={toggleTheme} aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"} title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}>
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
