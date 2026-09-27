alter table public.ingredients
  add column if not exists nutrition_basis_quantity numeric not null default 100,
  add column if not exists calories_kcal numeric,
  add column if not exists proteins_g numeric,
  add column if not exists fats_g numeric,
  add column if not exists carbohydrates_g numeric;

update public.ingredients
set nutrition_basis_quantity = case when unit = 'pcs' then 1 else 100 end
where nutrition_basis_quantity is distinct from case when unit = 'pcs' then 1 else 100 end;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ingredients_nutrition_values_check'
      and conrelid = 'public.ingredients'::regclass
  ) then
    alter table public.ingredients
      add constraint ingredients_nutrition_values_check
      check (
        nutrition_basis_quantity > 0
        and (
          num_nonnulls(calories_kcal, proteins_g, fats_g, carbohydrates_g) = 0
          or (
            num_nonnulls(calories_kcal, proteins_g, fats_g, carbohydrates_g) = 4
            and
            calories_kcal >= 0
            and proteins_g >= 0
            and fats_g >= 0
            and carbohydrates_g >= 0
          )
        )
      ) not valid;
  end if;
end
$$;

alter table public.ingredients
  validate constraint ingredients_nutrition_values_check;

comment on column public.ingredients.nutrition_basis_quantity is
  'Nutrition basis: 100 for grams/millilitres, 1 for pieces.';
comment on column public.ingredients.calories_kcal is
  'Kilocalories per nutrition_basis_quantity.';
comment on column public.ingredients.proteins_g is
  'Proteins in grams per nutrition_basis_quantity.';
comment on column public.ingredients.fats_g is
  'Fats in grams per nutrition_basis_quantity.';
comment on column public.ingredients.carbohydrates_g is
  'Carbohydrates in grams per nutrition_basis_quantity.';
