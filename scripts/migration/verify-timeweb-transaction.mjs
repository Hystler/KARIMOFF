import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

function readEnv(path) {
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[trimmed.slice(0, separator).trim()] = value;
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migrationPath =
  process.env.MIGRATION_ENV_PATH || "/Users/akimkovalenko/Desktop/KARIMOFF-migration.env";
const migration = readEnv(migrationPath);
const databaseUrl =
  migration.TIMEWEB_APP_DATABASE_URL_PUBLIC || migration.TARGET_DATABASE_URL;

if (!databaseUrl) {
  console.error("Timeweb application DATABASE_URL is missing.");
  process.exit(2);
}

const sql = postgres(databaseUrl, {
  connect_timeout: 10,
  idle_timeout: 5,
  max: 1,
  prepare: false
});
const rollbackMarker = `karimoff-verification-rollback-${randomUUID()}`;

try {
  await sql.begin(async (tx) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const customerId = randomUUID();
    const productId = randomUUID();
    const removableIngredientId = randomUUID();
    const extraIngredientId = randomUUID();

    await tx`
      insert into public.customers (id, name, phone, password_hash)
      values (
        ${customerId},
        ${`Cutover Test ${suffix}`},
        ${`+7000${suffix.slice(0, 7)}`},
        'transaction-test-only'
      )
    `;
    await tx`
      insert into public.legal_consents (
        subject_type,
        subject_id,
        consent_type,
        document_version,
        granted,
        granted_at,
        source_path
      )
      values (
        'customer',
        ${customerId},
        'loyalty_rules',
        'cutover-test',
        true,
        now(),
        '/migration/verify'
      )
    `;
    await tx`
      insert into public.ingredients (id, name, category, unit, cost_per_unit, is_active)
      values
        (
          ${removableIngredientId},
          ${`Cutover Onion ${suffix}`},
          'test',
          'pcs',
          5,
          true
        ),
        (
          ${extraIngredientId},
          ${`Cutover Sauce ${suffix}`},
          'test',
          'g',
          0.5,
          true
        )
    `;
    await tx`
      insert into public.products (
        id,
        name,
        slug,
        category,
        description,
        price,
        is_active,
        sort_order
      )
      values (
        ${productId},
        ${`Cutover Burger ${suffix}`},
        ${`cutover-burger-${suffix}`},
        'burgers',
        'Temporary transaction verification product',
        430,
        true,
        9999
      )
    `;
    await tx`
      insert into public.product_ingredients (
        product_id,
        ingredient_id,
        quantity,
        unit,
        sort_order,
        is_removable,
        is_extra_available,
        extra_quantity,
        extra_price,
        max_extra_quantity
      )
      values
        (
          ${productId},
          ${removableIngredientId},
          1,
          'pcs',
          10,
          true,
          false,
          0,
          0,
          1
        ),
        (
          ${productId},
          ${extraIngredientId},
          10,
          'g',
          20,
          false,
          true,
          5,
          25,
          2
        )
    `;
    await tx`
      insert into public.inventory_items (
        ingredient_id,
        current_quantity,
        min_quantity,
        unit,
        location,
        is_active
      )
      values
        (${removableIngredientId}, 20, 2, 'pcs', 'cutover-test', true),
        (${extraIngredientId}, 100, 10, 'g', 'cutover-test', true)
    `;

    const firstOrder = await tx`
      select *
      from public.create_site_order(
        p_customer_id => ${customerId},
        p_delivery_type => 'pickup',
        p_address => null,
        p_comment => 'cutover transaction verification',
        p_items => ${tx.json([
          {
            product_id: productId,
            quantity: 2,
            removed_ingredient_ids: [removableIngredientId],
            extras: [{ ingredient_id: extraIngredientId, quantity: 2 }]
          }
        ])},
        p_idempotency_key => ${randomUUID()},
        p_personal_data_granted => true,
        p_offer_accepted => true,
        p_marketing_granted => false,
        p_document_version => 'cutover-test',
        p_source_path => '/migration/verify',
        p_user_agent_short => 'migration-verifier',
        p_fulfillment_mode => 'asap',
        p_requested_at => null
      )
    `;
    const firstOrderId = firstOrder[0]?.order_id;
    assert(firstOrderId, "Order creation did not return an order id.");
    assert(Number(firstOrder[0]?.total) === 960, "Server-authoritative order total is incorrect.");

    const itemRows = await tx`
      select unit_price, quantity, line_total
      from public.order_items
      where order_id = ${firstOrderId}
    `;
    assert(Number(itemRows[0]?.unit_price) === 480, "Extra price was not calculated server-side.");
    assert(Number(itemRows[0]?.line_total) === 960, "Order line total is incorrect.");

    const modifierRows = await tx`
      select modifier_type, line_price_delta
      from public.order_item_modifiers
      where order_item_id in (
        select id from public.order_items where order_id = ${firstOrderId}
      )
      order by modifier_type
    `;
    assert(modifierRows.length === 2, "Removed and added ingredient modifiers were not saved.");
    assert(
      modifierRows.some(
        (row) => row.modifier_type === "remove" && Number(row.line_price_delta) === 0
      ),
      "Removing an ingredient changed the price."
    );
    assert(
      modifierRows.some(
        (row) => row.modifier_type === "add" && Number(row.line_price_delta) === 100
      ),
      "Added ingredient price delta is incorrect."
    );

    await tx`
      select public.set_order_status_staff_atomic(
        p_order_id => ${firstOrderId},
        p_status => 'completed',
        p_actor_id => null,
        p_actor_role => 'admin',
        p_source_path => '/migration/verify'
      )
    `;

    const stockAfterCompletion = await tx`
      select ingredient_id, current_quantity
      from public.inventory_items
      where ingredient_id in (${removableIngredientId}, ${extraIngredientId})
      order by ingredient_id
    `;
    const removableStock = stockAfterCompletion.find(
      (row) => row.ingredient_id === removableIngredientId
    );
    const extraStock = stockAfterCompletion.find((row) => row.ingredient_id === extraIngredientId);
    assert(Number(removableStock?.current_quantity) === 20, "Removed ingredient was deducted.");
    assert(Number(extraStock?.current_quantity) === 60, "Inventory deduction is incorrect.");

    const deductionRows = await tx`
      select count(*)::integer as count
      from public.order_inventory_deductions
      where order_id = ${firstOrderId}
    `;
    const movementRows = await tx`
      select count(*)::integer as count
      from public.inventory_movements
      where order_id = ${firstOrderId} and movement_type = 'sale'
    `;
    const loyaltyRows = await tx`
      select count(*)::integer as count, coalesce(sum(points), 0) as points
      from public.loyalty_transactions
      where order_id = ${firstOrderId} and type = 'earn'
    `;
    assert(Number(deductionRows[0]?.count) === 1, "Inventory deduction marker is missing.");
    assert(Number(movementRows[0]?.count) === 1, "Inventory sale movement is missing.");
    assert(Number(loyaltyRows[0]?.count) === 1, "Loyalty earn transaction is missing.");
    assert(Number(loyaltyRows[0]?.points) > 0, "Loyalty points were not earned.");

    await tx`
      select public.set_order_status_staff_atomic(
        p_order_id => ${firstOrderId},
        p_status => 'completed',
        p_actor_id => null,
        p_actor_role => 'admin',
        p_source_path => '/migration/verify'
      )
    `;
    const duplicateCheck = await tx`
      select
        (select count(*) from public.order_inventory_deductions where order_id = ${firstOrderId})
          as deductions,
        (select count(*) from public.inventory_movements
          where order_id = ${firstOrderId} and movement_type = 'sale') as movements,
        (select count(*) from public.loyalty_transactions
          where order_id = ${firstOrderId} and type = 'earn') as loyalty,
        (select current_quantity from public.inventory_items
          where ingredient_id = ${extraIngredientId}) as stock
    `;
    assert(Number(duplicateCheck[0]?.deductions) === 1, "Order was marked deducted twice.");
    assert(Number(duplicateCheck[0]?.movements) === 1, "Inventory was moved twice.");
    assert(Number(duplicateCheck[0]?.loyalty) === 1, "Loyalty was awarded twice.");
    assert(Number(duplicateCheck[0]?.stock) === 60, "Stock changed on repeated completion.");

    const secondOrder = await tx`
      select *
      from public.create_site_order(
        p_customer_id => ${customerId},
        p_delivery_type => 'pickup',
        p_address => null,
        p_comment => 'cutover insufficient stock verification',
        p_items => ${tx.json([{ product_id: productId, quantity: 7 }])},
        p_idempotency_key => ${randomUUID()},
        p_personal_data_granted => true,
        p_offer_accepted => true,
        p_marketing_granted => false,
        p_document_version => 'cutover-test',
        p_source_path => '/migration/verify',
        p_user_agent_short => 'migration-verifier',
        p_fulfillment_mode => 'asap',
        p_requested_at => null
      )
    `;
    const secondOrderId = secondOrder[0]?.order_id;
    assert(secondOrderId, "Insufficient-stock order was not created.");

    let insufficientStockRejected = false;
    try {
      await tx.savepoint((savepoint) =>
        savepoint`
          select public.set_order_status_staff_atomic(
            p_order_id => ${secondOrderId},
            p_status => 'completed',
            p_actor_id => null,
            p_actor_role => 'admin',
            p_source_path => '/migration/verify'
          )
        `
      );
    } catch (error) {
      insufficientStockRejected = String(error?.message || "").includes("Недостаточно остатков");
    }
    assert(insufficientStockRejected, "Insufficient stock did not block order completion.");

    const rejectedOrderRows = await tx`
      select status
      from public.orders
      where id = ${secondOrderId}
    `;
    const stockAfterRejectedOrder = await tx`
      select current_quantity
      from public.inventory_items
      where ingredient_id = ${extraIngredientId}
    `;
    assert(rejectedOrderRows[0]?.status === "new", "Rejected order status changed.");
    assert(
      Number(stockAfterRejectedOrder[0]?.current_quantity) === 60,
      "Rejected order changed inventory."
    );

    throw new Error(rollbackMarker);
  });
} catch (error) {
  if (error?.message !== rollbackMarker) {
    console.error(`Timeweb transaction verification failed: ${error?.message || "unknown error"}`);
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 5 });
}

if (!process.exitCode) {
  console.log("server_price=ok");
  console.log("modifiers=ok");
  console.log("inventory_atomicity=ok");
  console.log("inventory_idempotency=ok");
  console.log("negative_stock_guard=ok");
  console.log("loyalty=ok");
  console.log("cleanup=rolled_back");
}
