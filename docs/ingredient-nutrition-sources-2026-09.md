# KARIMOFF Ingredient Nutrition Source Audit

## Update 2026-09-11

This section supersedes the earlier missing-data status below. Owner-supplied product labels, production measurements, recipes, and explicitly temporary USDA analogues now provide 37 read-time nutrition references. Database values still take priority and are never overwritten by the fallback.

- Exact label-based references: white and black burger buns; open and closed hot-dog buns; tortilla; beef patty; three sausage variants; nuggets; pickled cucumber; fried onion; cheddar; cheese sticks; fries; country potatoes; Caesar sauce; cheese sauce; ketchup; ordinary BBQ sauce; mayonnaise.
- Recipe-derived estimates: prepared chicken breast, signature BBQ sauce, Tasty sauce, and garlic sauce.
- Generic USDA estimates: cabbage, green leaf lettuce, tomato, fresh cucumber, red onion, lavash, mini lavash, flatbread, fried bacon, fried BBQ wings, honey-mustard sauce, and breaded shrimp after deep frying.
- Still missing: chicken patty, prepared pork, and prepared beef.

The beef patty is now consistently treated as 110 g. Piece-based label values are converted to one production piece using the confirmed masses: white bun 82 g, black bun 89 g, hot-dog buns 60 g, sausages 80 g, cheddar 10 g, cheese stick 23 g, and the measured 19 g midpoint for nuggets and breaded shrimp.

Prepared chicken is provisional: 10 kg raw boneless skinless breast plus 250 ml sunflower oil, divided by the stated 7.8 kg cooked yield. Seasoning macros are omitted until its label is supplied. Garlic sauce is calculated from the supplied costed recipe: the component masses are recovered from the prices and unit costs shown in the same production notes.

The supplied breaded-shrimp label describes the frozen product. Because the kitchen deep-fries it, the temporary served-state reference now uses USDA SR Legacy FDC 172037, “Fast foods, shrimp, breaded and fried”: 308 kcal, protein 7.84 g, fat 18.9 g, and carbohydrate 28 g per 100 g. One production piece is estimated at the measured midpoint of 19 g.

Research/access date: **2026-09-10**, Europe/Moscow. Scope: local ingredient evidence and public primary nutrition sources only. This is a research handoff, not a database import, recipe calculation, publication, or labeling approval.

## Result And Coverage

**Four raw ingredient references are supported by official USDA records. All are explicitly `estimated: true` for KARIMOFF, not measurements of its purchased ingredients.** A fifth record is provided only as a conditional lettuce candidate. No exact packaged/manufacturer product match can be established from the ingredient identity information available in the inspected files.

| Coverage measure | Actual result |
| --- | ---: |
| Ingredients in the local technical-card input | 44 |
| Non-drink ingredients in that input | 36 |
| Additional ingredient in the extras catalog | 1: jalapeno |
| Non-drink audit scope | 37 |
| Matched generic raw references in the new TypeScript file | 4 / 37 |
| Conditional lettuce reference, excluded from TypeScript | 1 / 37 |
| Other ingredients with no assignable nutrition values | 32 / 37 |
| Exact manufacturer-label matches established | 0 |
| Non-drink technical-card/purchase-card rows | 32 recipes, 156 ingredient lines |
| Lines potentially covered by the four raw references | 43 / 156 |
| Additional lines using the unresolved lettuce type | 10 / 156 |
| Complete non-drink recipes enabled by these references alone | 0 / 32 |

These are **local input coverage counts**, not an assertion about live database contents, current availability, or the percentage of calories covered. The eight historical drink ingredients are outside this assignment. None of the 32 non-drink recipes consists entirely of the researched raw vegetables, even if the lettuce candidate were accepted.

## Local Evidence Read Only

- [Ingredient model](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/ingredients.ts): `g`, `ml`, and `pcs`; four nullable nutrition fields and `nutrition_basis_quantity`. There is no source identity, preparation-state, density, or grams-per-piece field in the inspected `Ingredient` type.
- [Ingredient input schema](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/ingredient-schema.ts): all four nutrition values must be supplied together or left blank. The inspected form schema does not expose a custom nutrition-basis quantity.
- [Composition model](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/product-types.ts): recipe lines carry quantity, unit, basis quantity, and four nullable nutrition values.
- [Current nutrition module](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/product-nutrition.ts): inspected only. The base recipe calculation scales nutrition by quantity/basis and withholds the total when ingredient nutrition is incomplete. Numerical completeness alone does not establish a correct source, matching preparation state, or grams-to-pieces conversion. Implementation/customization logic remains with the main task.
- [Technical-card input](/Users/akimkovalenko/Desktop/KARIMOFF/data/tech-cards/karimoff-tech-card-2026-08-11.json): internal version `2026-09-01`; ingredient names, aliases, units, prices, and package sizes, but no nutrition, brand, manufacturer, barcode, or supplier SKU fields. Prices are not evidence of product identity.
- [Food-cost notes](/Users/akimkovalenko/Desktop/KARIMOFF/docs/food-cost-inputs-2026-09-01.md): identify white headed cabbage and fresh unpeeled cucumber; recipe quantities are net quantities. These notes support local matching only; their third-party links were not used as nutrition sources.
- [Technical-card import notes](/Users/akimkovalenko/Desktop/KARIMOFF/docs/tech-card-import-2026-08-11.md): missing nutrition and finished yield/cooking-loss information are already documented.
- [Extras catalog](/Users/akimkovalenko/Desktop/KARIMOFF/src/lib/extras-catalog.ts): adds jalapeno and explicitly provisional piece/gram relationships discussed below.

**Key collision:** technical-card key `onion` means raw red onion; extras-catalog key `onion` means fried granulated onion. Never use these keys as a shared global namespace. Technical-card `fried_onion` remains missing nutrition. The reference module therefore uses exact canonical ingredient names, not ingredient keys, database UUIDs, aliases, or extras keys.

## Supported Raw Baseline

Every row below has `basis = 100 g edible portion`, energy in **kcal**, protein/fat/carbohydrate in **g**, access `date = 2026-09-10`, and **`estimated = true`**. No dressing, added oil, or marinade is included. These are general food-composition references, not verified supplier labels.

| Local ingredient/key | Official record and state | Calories | Protein | Fat | Carbs | Primary source |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Капуста / `cabbage` | FDC 2346407; Cabbage, green, raw; edible raw green/white headed cabbage | 27.9 | 0.96 | 0.23 | 6.38 | [Foundation JSON, April 2026](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip) |
| Помидор / `tomato` | FDC 170457; Tomatoes, red, ripe, raw, year round average; NDB 11529 | 18 | 0.88 | 0.20 | 3.89 | [SR Legacy JSON, April 2018](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip) |
| Огурец свежий / `cucumber` | FDC 2346406; Cucumber, with peel, raw; not peeled/pickled | 13.9 | 0.63 | 0.18 | 2.95 | [Foundation JSON, April 2026](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip) |
| Лук красный / `onion` | FDC 790577; Onions, red, raw; not fried or marinated | 44 | 0.94 | 0.10 | 9.93 | [Foundation JSON, April 2026](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip) |

Foundation was preferred when its food description matched. The generic ripe-red-tomato record was selected from SR Legacy because the inspected Foundation snapshot offered more specific raw grape/roma tomatoes, not an equivalent year-round generic red-tomato record. No grape/roma cultivar was inferred from the local name. SR Legacy is a historical final release, not a claim of fresh 2026 analysis. See the [USDA data-type comparison](https://fdc.nal.usda.gov/data-documentation/).

### Conditional Lettuce, Not Baseline Coverage

| Local candidate | Official record/state | Basis | Calories | Protein | Fat | Carbs | Status/source |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| Лист салата / `lettuce` | FDC 2346391; Lettuce, leaf, green, raw | 100 g edible raw leaves | 18.5 | 1.09 | 0.16 | 4.07 | `estimated: true`; `date: 2026-09-10`; conditional only; [Foundation JSON](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip) |

Confirm that the purchased ingredient is green leaf lettuce before accepting this candidate. The local name does not distinguish green leaf, iceberg, romaine, red leaf, or a named commercial variety. Do not silently pick one or average them. This candidate is deliberately absent from the TypeScript baseline.

### Precision And Nutrient Meaning

The baseline rounds source macros to two decimal places and energy to at most one decimal place. This is a reporting convention, **not an accuracy claim about KARIMOFF food**. Source values before rounding, in calories/protein/fat/carbs order, are:

| FDC ID | Source publication date | Energy nutrient ID | Original source values |
| --- | --- | --- | --- |
| 2346407 | 2022-10-28 | 2048 | 27.9 / 0.961 / 0.228 / 6.38 |
| 170457 | 2019-04-01 | 1008 | 18 / 0.88 / 0.2 / 3.89 |
| 2346406 | 2022-10-28 | 2048 | 13.9 / 0.625 / 0.178 / 2.95 |
| 790577 | 2020-04-01 | 1008 | 44 / 0.94 / 0.1 / 9.93 |
| 2346391, conditional | 2022-10-28 | 2048 | 18.5 / 1.09 / 0.156 / 4.07 |

Nutrient IDs used: `1003` protein, `1004` total lipid, `1005` carbohydrate by difference. Energy `2048` is Atwater-specific; legacy `1008` is the source's energy field. The downloaded onion record still supplies `1008`, not `2048`. Do not replace these source calories with an independently recomputed 4/9/4 result. USDA also publishes general-factor energy for some records; those are not the values selected here. [USDA Foundation documentation, Energy](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/).

**Carbohydrate definition matters:** USDA carbohydrate by difference includes dietary fiber. Treat `carbs` here as that source definition, not automatically as available/digestible carbohydrate or as interchangeable with every manufacturer's label. The main implementation needs a consistent definition before combining unlike sources. This audit makes no jurisdiction-specific labeling claim. [USDA Foundation documentation, Proximates](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/).

## Missing Ingredient Facts

For every packaged row below, obtain the exact manufacturer, product name/variant, supplier article or GTIN/barcode, current pack/technical-sheet identity, all four nutrition values with units and basis, and a stable official manufacturer URL or supplied label image. A similarly named product, retailer listing, recipe site, or generic USDA processed-food entry is not an exact match. Until identity and state are resolved, all four values remain **missing (`null`), not zero**.

| Ingredients / technical-card keys | Stored unit | Additional facts required before assignment |
| --- | --- | --- |
| Fried granulated onion / `fried_onion` | g | Exact fried/coated product, oil/flour formulation, ready-to-use label. Raw onion, dried onion, and breaded onion rings are not matches. |
| Pickled cucumber / `pickle` | g | Exact sweetened/unsweetened product; whether nutrition is for drained solids or product with brine; drained edible weight. The 3 kg jar and provisional waste rate do not establish nutrition. |
| Jalapeno / extras `jalapeno` | g | First confirm fresh versus pickled/canned, then SKU and drained-solids basis if packaged. The 30 g extra is a portion amount, not nutrition evidence. No raw-jalapeno substitution. |
| BBQ, garlic, Caesar, Tasty / `bbq_sauce`, `garlic_sauce`, `caesar_sauce`, `tasty_sauce` | g | Establish purchased SKU versus house-made recipe. For house-made sauce: complete ingredient list/weights and finished batch yield; exact labels of all packaged subingredients. A branded sauce with the same flavor name is insufficient. |
| Cheese sauce, ketchup, honey-mustard / `cheese_sauce`, `ketchup`, `honey_mustard` | g | Exact manufacturer and variant, full label and per-100-g basis. Generic ketchup/cheese/mustard values cannot identify the purchased formulation. |
| Lavash, flatbread / `lavash`, `flatbread` | pcs | Bakery/manufacturer formula or SKU and edible mass of one whole supplied piece; confirm whether recipe quantity means whole or cut piece. |
| White/black burger buns / `bun`, `black_bun` | pcs | Separate SKUs/formulations and mass per bun. Do not reuse white-bun nutrition for black buns. |
| Open/closed hot-dog buns / `hotdog_bun_open`, `hotdog_bun_closed` | pcs | Separate labels and edible piece weights; identify any removed core. |
| Baked chicken/pork/beef / `chicken`, `pork`, `beef` | g | Purchased cooked product label, or actual cut, fat/skin content, marinade/oil, raw batch inputs and edible cooked yield. Confirm that recipe grams are cooked-state grams. A 90 g priced portion does not supply this information. |
| Beef patty / `beef_patty` | g | Exact fat percentage/formulation, label state (raw/frozen/cooked), and recipe weighing state. Technical-card 75 g and extra 110 g are distinct quantities, not a demonstrated cooked yield or universal piece weight. |
| Chicken patty / `chicken_patty` | pcs | SKU, breaded/unbreaded state, exact piece mass and cooking preparation. |
| Nuggets / `nugget` | pcs | Exact product, piece mass, label state and preparation; distinguish frozen/pre-fried from served deep-fried nutrition. |
| Cheese sticks / `cheese_stick` | pcs | Exact cheese/breading product, piece mass and served preparation. No substitution with plain cheese. |
| Breaded king prawns / `breaded_shrimp` | pcs | SKU and size grade, breading/tail status, edible mass per piece and label state; plain shrimp nutrition is not a match. |
| Fried bacon / `bacon` | pcs | Exact bacon and fried-state nutrition or measured cooking process/yield; define one cooked piece/portion and its mass. |
| Cheddar slice / `cheddar` | pcs | Exact natural versus processed cheese product, label and slice mass. The name alone does not settle formulation. |
| Chicken/pork/beef sausages / `chicken_sausage`, `pork_sausage`, `beef_sausage` | pcs | Three separate product identities, labels, piece weights and cooking states. Animal type alone is insufficient. |
| Fries / `fries` | g | Exact frozen/pre-fried product, cooking instructions, raw/frozen-versus-served weight basis, and evidence for additional oil uptake if not already included in an as-prepared label. |
| Potato wedges / `country_potatoes` | g | Exact coating/seasoning product and the same preparation/weight facts as fries. Plain potato is not a match. |
| BBQ chicken wings / `bbq_wing` | pcs | Exact marinade/coating SKU or recipe, whole wing versus segment, label bone/edible basis, edible served mass per piece, and preparation. Portion count is not edible mass. |

No official manufacturer values are supplied here because the local files do not identify which manufacturer's product to verify. This is an **unresolved identity problem**, not evidence that official labels do not exist. A broad branded-food scrape would not resolve that identity.

## Piece Weight Checklist

There are **16 non-drink `pcs` ingredients** in the local technical-card input:

`lavash`, `flatbread`, `bun`, `black_bun`, `hotdog_bun_open`, `hotdog_bun_closed`, `chicken_patty`, `bacon`, `chicken_sausage`, `pork_sausage`, `beef_sausage`, `breaded_shrimp`, `nugget`, `bbq_wing`, `cheddar`, `cheese_stick`.

`package_size: 1` for these rows is a purchasing count, not one gram. Either obtain label nutrition explicitly per the same piece, or verified grams per piece in the **same state** as the per-100-g nutrition. Net pack mass divided by count is usable only if pack/count refer to those pieces and the basis is edible product without packaging, brine, or bones. Variable pieces require representative weighing with the observed range recorded, not an invented fixed weight.

The extras catalog has the following **unverified local hints**, not manufacturer facts:

| Ingredient | Displayed extra | Actual stored quantity | Local warning |
| --- | --- | --- | --- |
| Bacon | 20 g | 1 pcs | Temporary purchasing-piece/portion equivalence; mass must be checked. |
| Cheddar | 12 g | 1 pcs | Temporary slice/portion equivalence; mass must be checked. |
| Each sausage variant | 80 g | 1 pcs | Purchased piece mass must be checked. |
| Beef patty | 110 g | 110 g | Extra quantity; technical-card procurement/recipe reference also mentions 75 g. Neither establishes the other quantity's cooking state. |

Do not treat 6/12/16 pieces in a product portion, the product's displayed total weight, or a price as evidence for the mass of one ingredient piece.

## Handoff Constraints

- [Reference module](/Users/akimkovalenko/Desktop/KARIMOFF/src/data/ingredient-nutrition-reference.ts) exports the interface `IngredientNutritionReference` and readonly array `ingredientNutritionReference`. Required integration fields are exact canonical `name`, `calories_kcal`, `proteins_g`, `fats_g`, `carbohydrates_g`, `sourceUrl`, `sourceName`, and `state`; every record explicitly has `nutrition_basis_quantity: 100`, `unit: "g"`, and `estimated: true`. Source food names, FDC IDs, dates and energy methods are retained separately. It contains no lookup, recipe calculation, fallback, imports, or database effects.
- **Requested read-time fallback contract for the main task:** accept only an exact `name` match with ingredient unit `g` and all four database nutrition fields strictly equal to `null`. Preserve every existing database value, including zero. A partially populated row, unknown/undefined field, non-gram unit, alias/fuzzy-name match, or different preparation state must not be filled from this reference. Apply the 100 g basis to the temporary result only; never write reference values or their basis back to the database.
- Keep the temporary result explicitly approximate and expose `sourceName` with its `sourceUrl` in the admin view. Preserve the source/estimated metadata through calculations. Portion selection and extras calculations are being handled by the main task, not implemented or audited here. Do not describe this research-only module as an already installed fallback.
- Apply raw reference values to edible/net raw quantities, not gross purchasing quantities inflated by the food-cost waste percentage. Preparation that adds oil, dressing, marinade, or changes state needs separate evidence. USDA values describe edible portions. [Foundation documentation, Weights](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/).
- A gram-based label cannot directly populate a per-piece or per-milliliter basis. Same-state grams per piece or a measured/documented density is required unless the label already uses the recipe unit.
- Keep incomplete recipes unavailable as complete totals. A sum of known vegetable values is only a partial contribution and must not be presented as the dish's nutrition. This task intentionally provides no dish totals.

## Reproducible Source Record

The official [USDA download index](https://fdc.nal.usda.gov/download-datasets/) was checked on 2026-09-10. The browser tool cannot decode ZIP data, so the archives linked by that index were fetched directly, without API credentials. The exact JSON food records and nutrient IDs above were parsed locally; no third-party nutrition table was used. Source publication dates differ from dataset release dates and from this audit's access date.

| Download actually retrieved | Bytes | SHA-256 |
| --- | ---: | --- |
| [Foundation JSON 2026-04-30](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip) | 469303 | `186e988ec542e913f51ef62b86a47758e8cdd0d1dc3889e7b055581f3c09c77a` |
| [SR Legacy JSON 2018-04](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip) | 13456312 | `0fe8ae486a2c8eb42cb96413f058deb51863a46c8fb8eeb4b1fb45006dd338ef` |
| [SR Legacy CSV 2018-04](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip), fallback download during JSON timeout | 6074592 | `b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0` |

The successful JSON retry supplied the tomato values; the CSV download was not used to populate the baseline. Only these bounded official archives were retrieved, about 20 MB compressed in total; no Branded Foods/full database scrape and no archive was added to the repository. The Foundation JSON contains a null array entry, which was skipped before selecting records by FDC ID.

Reproduction: download the linked JSON archives; select FDC IDs `2346407`, `170457`, `2346406`, `790577`, and conditional `2346391`; read nutrients `1003`, `1004`, `1005` and the energy ID specified in the table; compare source descriptions/dates and apply the documented rounding. The [SR Legacy documentation](https://www.ars.usda.gov/ARSUserFiles/80400525/Data/SR-Legacy/SR-Legacy_Doc.pdf) defines nutrient amounts per 100 g edible portion (section 4.5).

## Verification

- Passed the existing TypeScript compiler against the new reference file with no emitted files.
- Passed the existing ESLint configuration against the new reference file.
- Independently loaded the exported array and both official JSON archives: all four canonical names/gram units matched the local technical-card data, all four FDC IDs/descriptions matched the archives, and all 16 numeric fields matched the specified source nutrients after documented rounding. Every record has explicit 100 g basis, access date, and estimated status.
- Recounted recipe/ingredient coverage directly from the local JSON input. No recipe totals were calculated.
- Did not run application-wide tests, builds, or a server: no runtime integration is part of this audit, and the main task is modifying runtime behavior concurrently.

Only this report and the reference module were created by this audit. Existing source files, recipes, database, production state, environment files, dependencies, and concurrent main-task edits were not modified; no commit or deployment was performed.
