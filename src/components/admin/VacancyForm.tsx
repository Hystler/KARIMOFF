import type { Vacancy } from "@/lib/vacancies";

type VacancyFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  submitLabel: string;
  vacancy?: Vacancy | null;
};

const salaryUnits = [
  { value: "hour", label: "в час" },
  { value: "shift", label: "за смену" },
  { value: "month", label: "в месяц" }
];

export function VacancyForm({ action, submitLabel, vacancy }: VacancyFormProps) {
  return (
    <form action={action} className="mt-8 grid gap-5 rounded-[1.25rem] border border-karimoff-line bg-white p-5 shadow-[0_24px_70px_rgba(18,18,20,0.08)] sm:p-7">
      {vacancy ? <input type="hidden" name="id" value={vacancy.id} /> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Название
          <input name="title" required defaultValue={vacancy?.title ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange focus:shadow-[0_0_0_4px_rgba(251,103,10,0.10)]" placeholder="Повар" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Slug
          <input name="slug" required defaultValue={vacancy?.slug ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" placeholder="cook" />
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Отдел
          <input name="department" defaultValue={vacancy?.department ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" placeholder="Кухня" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Занятость
          <input name="employment_type" defaultValue={vacancy?.employment_type ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" placeholder="Сменный график" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Локация
          <input name="location" defaultValue={vacancy?.location ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" placeholder="Точка KARIMOFF" />
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Зарплата от
          <input name="salary_from" type="number" min="0" step="1" defaultValue={vacancy?.salary_from ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" placeholder="450" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Зарплата до
          <input name="salary_to" type="number" min="0" step="1" defaultValue={vacancy?.salary_to ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Единица
          <select name="salary_unit" defaultValue={vacancy?.salary_unit ?? "hour"} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange">
            {salaryUnits.map((unit) => (
              <option key={unit.value} value={unit.value}>
                {unit.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Порядок
          <input name="sort_order" type="number" min="0" step="1" defaultValue={vacancy?.sort_order ?? 100} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
        График
        <input name="schedule" defaultValue={vacancy?.schedule ?? ""} className="rounded-xl border border-karimoff-line bg-white px-4 py-3 outline-none transition focus:border-karimoff-orange" placeholder="2/2, гибкий, по договорённости" />
      </label>

      <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
        Короткое описание
        <textarea name="description" rows={4} defaultValue={vacancy?.description ?? ""} className="resize-none rounded-xl border border-karimoff-line bg-white px-4 py-3 leading-6 outline-none transition focus:border-karimoff-orange" placeholder="Коротко о роли" />
      </label>

      <div className="grid gap-5 md:grid-cols-3">
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Требования
          <textarea name="requirements" rows={5} defaultValue={vacancy?.requirements ?? ""} className="resize-none rounded-xl border border-karimoff-line bg-white px-4 py-3 leading-6 outline-none transition focus:border-karimoff-orange" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Обязанности
          <textarea name="responsibilities" rows={5} defaultValue={vacancy?.responsibilities ?? ""} className="resize-none rounded-xl border border-karimoff-line bg-white px-4 py-3 leading-6 outline-none transition focus:border-karimoff-orange" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-karimoff-black">
          Условия
          <textarea name="benefits" rows={5} defaultValue={vacancy?.benefits ?? ""} className="resize-none rounded-xl border border-karimoff-line bg-white px-4 py-3 leading-6 outline-none transition focus:border-karimoff-orange" />
        </label>
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-karimoff-line px-4 py-3 text-sm font-semibold text-karimoff-black">
        <input name="is_active" type="checkbox" defaultChecked={vacancy?.is_active ?? true} className="h-5 w-5 accent-karimoff-orange" />
        Показывать на сайте
      </label>

      <button type="submit" className="w-fit rounded-full border border-karimoff-orange bg-karimoff-orange px-6 py-4 text-sm font-bold text-white shadow-[0_16px_34px_rgba(251,103,10,0.2)] transition hover:-translate-y-0.5 hover:bg-[#D95405] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-karimoff-orange active:translate-y-0">
        {submitLabel}
      </button>
    </form>
  );
}
