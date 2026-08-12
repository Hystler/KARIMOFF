"use client";

import {
  BarChart3,
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
  PackageOpen,
  Plug,
  Settings,
  ShoppingBag,
  Users,
  UtensilsCrossed,
  WalletCards,
  X
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { logoutAction } from "@/app/admin/login/actions";
import type { CurrentStaff } from "@/lib/admin-auth";

const navigation = [
  { href: "/admin", label: "Обзор", icon: LayoutDashboard, roles: ["admin", "manager"] },
  { href: "/admin/kitchen", label: "Кухня", icon: ChefHat, roles: ["admin", "manager", "cook"] },
  { href: "/admin/orders", label: "Заказы", icon: ShoppingBag, roles: ["admin", "manager"] },
  { href: "/admin/products", label: "Меню", icon: UtensilsCrossed, roles: ["admin", "manager"] },
  { href: "/admin/ingredients", label: "Ингредиенты", icon: PackageOpen, roles: ["admin", "manager"] },
  { href: "/admin/inventory", label: "Склад", icon: Boxes, roles: ["admin", "manager"] },
  { href: "/admin/production", label: "Производство", icon: Factory, roles: ["admin", "manager"] },
  { href: "/admin/customers", label: "Пользователи", icon: Users, roles: ["admin", "manager"] },
  { href: "/admin/economics", label: "Экономика", icon: BarChart3, roles: ["admin", "manager"] },
  { href: "/admin/analytics/sales", label: "Продажи", icon: ChartNoAxesCombined, roles: ["admin", "manager"] },
  { href: "/admin/integrations/evotor", label: "Эвотор", icon: Plug, roles: ["admin", "manager"] },
  { href: "/admin/loyalty", label: "Лояльность", icon: WalletCards, roles: ["admin", "manager"] },
  { href: "/admin/leads", label: "Заявки", icon: FileText, roles: ["admin", "manager"] },
  { href: "/admin/vacancies", label: "Вакансии", icon: BriefcaseBusiness, roles: ["admin", "manager"] },
  { href: "/admin/cookies", label: "Cookies", icon: Cookie, roles: ["admin", "manager"] },
  { href: "/admin/staff", label: "Сотрудники", icon: Users, roles: ["admin"] },
  { href: "/admin/settings", label: "Настройки", icon: Settings, roles: ["admin", "manager"] }
] as const;

const roleLabels = { admin: "Администратор", manager: "Управляющий", cook: "Повар" };

export function AdminWorkspaceShell({ staff, children }: { staff: CurrentStaff; children: ReactNode }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const items = navigation.filter((item) => (item.roles as readonly string[]).includes(staff.role));

  return (
    <div className="admin-workspace">
      {isOpen ? <button type="button" className="admin-sidebar-overlay" aria-label="Закрыть меню" onClick={() => setIsOpen(false)} /> : null}
      <aside className={`admin-sidebar ${isOpen ? "admin-sidebar-open" : ""}`}>
        <div className="flex h-[72px] items-center justify-between border-b border-white/10 px-5">
          <Link href={staff.role === "cook" ? "/admin/kitchen" : "/admin"} className="text-xl font-black text-white">
            KARIM<span className="text-karimoff-orange">O</span>FF
          </Link>
          <button type="button" onClick={() => setIsOpen(false)} className="admin-sidebar-close" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <nav className="admin-nav">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
            return (
              <Link key={href} href={href} onClick={() => setIsOpen(false)} className={`admin-nav-link ${active ? "admin-nav-link-active" : ""}`}>
                <Icon size={19} strokeWidth={2.2} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-white/10 p-4">
          <div className="rounded-lg bg-white/[0.07] p-3">
            <p className="truncate text-sm font-bold text-white">{staff.name}</p>
            <p className="mt-1 text-xs text-white/55">{roleLabels[staff.role]}</p>
          </div>
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
        </header>
        {children}
      </div>
    </div>
  );
}
