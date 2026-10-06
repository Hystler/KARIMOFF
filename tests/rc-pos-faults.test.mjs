import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import postgres from 'postgres';
import ts from 'typescript';

const testPaymentSystemId = 'synthetic-evotor-payment-system';
const paymentEvidence = (paymentIdentifier, total = 100) => ({
  receiptClosed: true,
  paymentType: 'ELECTRON',
  total,
  paymentIdentifier,
  paymentSystemId: testPaymentSystemId
});

function parseCloudReceipt(document) {
  const code = ts.transpileModule(readFileSync('src/lib/integrations/evotor/receipts.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(id => {
    if (id === 'server-only') return {};
    throw new Error(`Unexpected parser import ${id}`);
  }, exports);
  return exports.parseEvotorReceipt(document);
}

function service(sql, enabled = true) {
  const reconciliationCode = ts.transpileModule(readFileSync('src/lib/integrations/evotor/fiscal-reconciliation.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const reconciliation = {};
  new Function('require', 'exports', reconciliationCode)(id => {
    if (id === 'server-only') return {};
    throw new Error(`Unexpected reconciliation import ${id}`);
  }, reconciliation);
  const paymentResultCode = ts.transpileModule(readFileSync('src/lib/integrations/evotor/payment-result.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const paymentResult = {};
  new Function('require', 'exports', paymentResultCode)(id => {
    if (id === 'server-only') return {};
    throw new Error(`Unexpected payment-result import ${id}`);
  }, paymentResult);
  const code = ts.transpileModule(readFileSync('src/lib/integrations/evotor/pos-payments.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'process', code)(id => {
    if (id === 'server-only') return {};
    if (id === '@/lib/postgres/server') return { getPostgresSql: () => sql };
    if (id === './terminal-bridge') return { terminalBridgeReady: () => true };
    if (id === './fiscal-reconciliation') return reconciliation;
    if (id === './payment-result') return paymentResult;
    throw new Error(`Unexpected import ${id}`);
  }, exports, { env: { EVOTOR_POS_PAYMENTS_ENABLED: String(enabled), TEST_ORDER_MODE: 'false' } });
  exports.reconcileEvotorReceipt = reconciliation.reconcileEvotorReceipt;
  const receiptExports = {};
  const receiptCode = ts.transpileModule(readFileSync('src/lib/integrations/evotor/receipts.ts','utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  new Function('require','exports',receiptCode)(id => {
    if (id === 'server-only') return {};
    throw new Error(`Unexpected receipt import ${id}`);
  },receiptExports);
  const syncSource = readFileSync('src/lib/integrations/evotor/sync.ts','utf8')
    .replace('async function persistSnapshot(', 'export async function persistSnapshot(');
  const syncCode = ts.transpileModule(syncSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const syncExports = {};
  new Function('require','exports',syncCode)(id => {
    if (id === 'server-only') return {};
    if (id === 'node:crypto') return {createHash};
    if (id === '@/lib/postgres/server') return {getPostgresSql:()=>sql};
    if (id === './receipts') return receiptExports;
    if (id === './fiscal-reconciliation') return reconciliation;
    if (id === './product-mapping-rules') return {EXPLICIT_EVOTOR_PRODUCT_MAPPINGS:[]};
    if (['@/lib/audit','@/lib/observability','./client','./crypto','./devices',
      './documents','./employees','./errors','./products','./recovery','./stores'].includes(id)) return {};
    throw new Error(`Unexpected sync import ${id}`);
  },syncExports);
  exports.persistSnapshot = syncExports.persistSnapshot;
  return exports;
}

test('RC PG17 runtime: concurrent POS, unknown outcomes, restart and recovery are fail-safe', async () => {
  const dsn = process.env.KARIMOFF_RC_LOCAL_DSN;
  assert.match(dsn ?? '', /^postgres:\/\/karimoff_app@127\.0\.0\.1:55445\/karimoff_rc_fresh_\d+$/,
    'Run verify-release-database --local-only first and provide its runtimeDsn');
  const sql = postgres(dsn, { max: 8, onnotice() {} });
  try {
    const [identity] = await sql`select current_user as role, current_setting('server_version_num')::int as version`;
    assert.equal(identity.role, 'karimoff_app');
    assert.ok(identity.version >= 170000 && identity.version < 180000);
    const api = service(sql);
    const fiscalStorageNumber = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
    const [connection] = await sql`insert into evotor_connections(evotor_user_id,encrypted_token,token_fingerprint)
      values(${randomUUID()},'synthetic',${randomUUID()}) returning id`;
    const [product] = await sql`insert into products(name,slug,category,price,is_active)
      values('Synthetic POS meal', ${`rc-${randomUUID()}`}, 'Бургеры', 100, true) returning id`;
    const [ingredient] = await sql`insert into ingredients(name,unit,cost_per_unit)
      values('Synthetic POS ingredient','g',1) returning id`;
    await sql`insert into inventory_items(ingredient_id,unit,current_quantity) values(${ingredient.id},'g',100)`;
    await sql`insert into product_ingredients(product_id,ingredient_id,quantity,unit)
      values(${product.id},${ingredient.id},10,'g')`;
    async function fixture() {
      const [location] = await sql`insert into order_locations(location_key,name)
        values(${`rc-${randomUUID()}`},'Synthetic RC point') returning id`;
      const [device] = await sql`insert into evotor_terminal_devices(location_id,device_key,token_hash,last_seen_at,paired_at)
        values(${location.id},${randomUUID()},${randomUUID().replaceAll('-','').repeat(2)},now(),now()) returning id`;
      const [cloudStore] = await sql`insert into evotor_stores(connection_id,evotor_store_id,name,location_id)
        values(${connection.id},${randomUUID()},'Synthetic cloud store',${location.id}) returning id`;
      const [cloudDevice] = await sql`insert into evotor_devices(connection_id,store_id,evotor_device_id)
        values(${connection.id},${cloudStore.id},${randomUUID()}) returning id`;
      await sql`update evotor_terminal_devices set cloud_device_id=${cloudDevice.id} where id=${device.id}`;
      const input = { locationId: location.id, customerId: null, customerName: 'Synthetic RC guest', comment: null,
        items: [{ product_id: product.id, quantity: 1, removed_ingredient_ids: [], extras: [], modifier_option_ids: [], note: '' }],
        idempotencyKey: randomUUID(), actorId: null, actorRole: 'owner', terminalDeviceId: device.id };
      return { input, deviceId: device.id, cloudStoreId:cloudStore.id, cloudDeviceId:cloudDevice.id };
    }
    async function state(job) {
      const [row] = await sql`select o.payment_status,o.fiscal_status,o.is_operational,
        (select count(*)::int from payments where order_id=o.id) as payments,
        (select count(*)::int from evotor_terminal_payment_intents where order_id=o.id) as intents,
        (select count(*)::int from order_outbox where aggregate_id=o.id and event_type='order.payment_succeeded') as kds,
        (select count(*)::int from canonical_analytics_sales where source_record_id=o.id) as sales,
        (select count(*)::int from order_inventory_deductions where order_id=o.id) as inventory
        from orders o where id=${job.orderId}`;
      assert.equal(row.payments, 1); assert.equal(row.intents, 1);
      return row;
    }
    // Fixture derived from one sanitized production-shape SELL. Only synthetic
    // values are committed; the actual importer writes into disposable PG.
    async function importRealShape(point, fiscal) {
      const document = JSON.parse(readFileSync('tests/fixtures/evotor-sell-real-shape.synthetic.json','utf8'));
      const [store] = await sql`select evotor_store_id from evotor_stores where id=${point.cloudStoreId}`;
      const [device] = await sql`select evotor_device_id from evotor_devices where id=${point.cloudDeviceId}`;
      document.id = randomUUID();
      document.store_id = store.evotor_store_id;
      document.device_id = device.evotor_device_id;
      const print = document.body.pos_print_results[0];
      print.fn_serial_number = fiscal.storageNumber;
      print.fiscal_document_number = Number(fiscal.documentNumber);
      print.fiscal_sign_doc_number = fiscal.sign;
      const parsed = parseCloudReceipt(document);
      assert.equal(parsed.fiscalGroups.length,1);
      const snapshot = () => api.persistSnapshot({
        connectionId:connection.id,eventId:randomUUID(),syncType:'manual',
        stores:[{id:document.store_id,name:'Synthetic cloud store'}],
        devices:[{id:document.device_id,store_id:document.store_id}],
        employees:[],productsByStore:new Map(),
        documentsByStore:new Map([[document.store_id,[document]]]),windowsByStore:new Map()
      });
      await snapshot();
      const [cloudReceipt] = await sql`select id,store_id,device_id,fiscal_drive_number,
        fiscal_document_number,fiscal_sign from evotor_receipts
        where connection_id=${connection.id} and external_receipt_id=${document.id}`;
      assert.equal(cloudReceipt.store_id,point.cloudStoreId);
      assert.equal(cloudReceipt.device_id,point.cloudDeviceId);
      assert.equal(cloudReceipt.fiscal_drive_number,parsed.fiscalDriveNumber);
      assert.equal(cloudReceipt.fiscal_document_number,parsed.fiscalDocumentNumber);
      assert.equal(cloudReceipt.fiscal_sign,parsed.fiscalSign);
      const [storedGroup] = await sql`select fiscal_storage_number,fiscal_document_number,fiscal_sign,
        receipt_number,document_number,check_sum from evotor_receipt_fiscal_groups
        where receipt_id=${cloudReceipt.id}`;
      assert.equal(storedGroup.fiscal_storage_number,parsed.fiscalGroups[0].fiscalStorageNumber);
      assert.equal(storedGroup.fiscal_document_number,parsed.fiscalGroups[0].fiscalDocumentNumber);
      assert.equal(storedGroup.fiscal_sign,parsed.fiscalGroups[0].fiscalSign);
      assert.equal(storedGroup.receipt_number,parsed.fiscalGroups[0].receiptNumber);
      assert.equal(storedGroup.document_number,parsed.fiscalGroups[0].documentNumber);
      assert.equal(Number(storedGroup.check_sum),parsed.fiscalGroups[0].checkSum);
      return { documentId:document.id, receiptId:cloudReceipt.id, reimport:snapshot };
    }
    const competing = await fixture();
    const tabletResults = await Promise.allSettled([
      api.createEvotorPosPayment(competing.input),
      service(sql).createEvotorPosPayment({ ...competing.input, idempotencyKey: randomUUID() })
    ]);
    assert.equal(tabletResults.filter(result => result.status === 'fulfilled').length, 1,
      'two distinct tablet orders can reserve only one terminal payment');
    const rejectedTablet = tabletResults.find(result => result.status === 'rejected');
    assert.match(rejectedTablet.reason.message, /Касса занята/);
    const [tabletCounts] = await sql`select
      (select count(*)::int from orders where location_id=${competing.input.locationId}) as orders,
      (select count(*)::int from evotor_terminal_payment_intents where device_id=${competing.deviceId}) as intents`;
    assert.deepEqual(tabletCounts, { orders: 1, intents: 1 });
    const winningTablet = tabletResults.find(result => result.status === 'fulfilled').value;
    assert.deepEqual(await state(winningTablet), { payment_status:'pending',fiscal_status:'pending',
      is_operational:false,payments:1,intents:1,kds:0,sales:1,inventory:0 });
    const [unpaidSale] = await sql`select analytics_included,net_revenue::text as revenue
      from canonical_analytics_sales where source_record_id=${winningTablet.orderId}`;
    assert.equal(unpaidSale.analytics_included, false, 'the pending journal row is not a recognized sale');
    assert.equal(Number(unpaidSale.revenue), 0, 'no unpaid POS revenue');

    const double = await fixture();
    const [a,b] = await Promise.all([api.createEvotorPosPayment(double.input), api.createEvotorPosPayment(double.input)]);
    assert.equal(a.intentId,b.intentId); assert.equal(a.orderId,b.orderId);
    assert.equal((await state(a)).kds,0);
    await assert.rejects(api.createEvotorPosPayment({ ...double.input,idempotencyKey:randomUUID() }), /Касса занята/);
    assert.equal((await api.nextEvotorTerminalPayment(double.deviceId)).id,a.intentId);
    const [payment] = await sql`select payment_id from evotor_terminal_payment_intents where id=${a.intentId}`;
    const localUuid = randomUUID();
    assert.equal(await api.saveEvotorLocalReceipt({ deviceId:double.deviceId,intentId:a.intentId,
      orderId:a.orderId,paymentId:randomUUID(),localReceiptUuid:localUuid,
      paymentSystemId:testPaymentSystemId,
      openedAt:new Date().toISOString() }),false);
    const [beforeSave] = await sql`select local_receipt_uuid from evotor_terminal_payment_intents where id=${a.intentId}`;
    assert.equal(beforeSave.local_receipt_uuid,null);
    assert.equal(await api.saveEvotorLocalReceipt({ deviceId:double.deviceId,intentId:a.intentId,
      orderId:a.orderId,paymentId:payment.payment_id,localReceiptUuid:localUuid,
      paymentSystemId:testPaymentSystemId,
      openedAt:new Date().toISOString() }),true);
    assert.equal(await service(sql).nextEvotorTerminalPayment(double.deviceId),null, 'restart must not resend processing');
    await sql`update evotor_terminal_payment_intents set updated_at=now()-interval '6 minutes' where id=${a.intentId}`;
    assert.equal((await api.getEvotorPosPaymentStatus(a.intentId)).status,'unknown');
    assert.equal(await api.resolveUnknownEvotorPosPayment({ intentId:a.intentId,staffId:null,resolution:'cancelled' }),false,
      'manual cancellation cannot unlock a dispatched UNKNOWN charge');
    assert.equal((await api.getEvotorPosPaymentStatus(a.intentId)).status,'unknown');
    await assert.rejects(api.createEvotorPosPayment({ ...double.input,idempotencyKey:randomUUID() }), /Касса занята/);
    const callback = { deviceId:double.deviceId,intentId:a.intentId,status:'paid',receiptReference:localUuid,
      paymentEvidence:paymentEvidence(localUuid),
      fiscal:{storageNumber:fiscalStorageNumber,documentNumber:'112',sign:'379262307',fiscalizedAt:new Date().toISOString(),total:100,documentType:'SELL'} };
    await Promise.all([service(sql).recordEvotorTerminalPaymentResult(callback),api.recordEvotorTerminalPaymentResult(callback)]);
    assert.deepEqual(await state(a), { payment_status:'paid',fiscal_status:'issued',is_operational:true,
      payments:1,intents:1,kds:1,sales:1,inventory:0 });
    await api.recordEvotorTerminalPaymentResult({ ...callback,status:'unknown',receiptReference:null });
    assert.equal((await state(a)).kds,1);
    for (const status of ['accepted','cooking','ready','ready']) {
      await sql`select set_order_kitchen_status_atomic(${a.orderId}::uuid,${status},null::uuid,'owner','rc')`;
    }
    const prepared = await state(a);
    assert.equal(prepared.inventory,1);
    assert.equal(prepared.sales,1);
    assert.equal(prepared.kds,1);
    const [stock] = await sql`select current_quantity::text as balance from inventory_items where ingredient_id=${ingredient.id}`;
    assert.equal(Number(stock.balance),90,'one recipe deduction even after repeated ready');

    const delayed = await fixture();
    const pending = await api.createEvotorPosPayment(delayed.input);
    await api.nextEvotorTerminalPayment(delayed.deviceId);
    const [pendingPayment] = await sql`select payment_id from evotor_terminal_payment_intents where id=${pending.intentId}`;
    const pendingUuid = randomUUID();
    assert.equal(await api.saveEvotorLocalReceipt({deviceId:delayed.deviceId,intentId:pending.intentId,
      orderId:pending.orderId,paymentId:pendingPayment.payment_id,localReceiptUuid:pendingUuid,
      paymentSystemId:testPaymentSystemId,
      openedAt:new Date().toISOString()}),true);
    const pendingCallback = {deviceId:delayed.deviceId,intentId:pending.intentId,status:'paid',receiptReference:pendingUuid,
      paymentEvidence:paymentEvidence(pendingUuid)};
    assert.equal((await api.recordEvotorTerminalPaymentResult(pendingCallback)).status,'fiscal_pending');
    assert.deepEqual(await state(pending),{payment_status:'paid',fiscal_status:'pending',is_operational:false,
      payments:1,intents:1,kds:0,sales:1,inventory:0});
    await assert.rejects(api.createEvotorPosPayment({...delayed.input,idempotencyKey:randomUUID()}),/Касса занята/);
    assert.equal((await service(sql).getEvotorPosPaymentStatus(pending.intentId)).status,'fiscal_pending');
    await api.recordEvotorTerminalPaymentResult({...pendingCallback,status:'failed'});
    assert.equal((await api.getEvotorPosPaymentStatus(pending.intentId)).status,'fiscal_pending');
    const fiscalIdentity = {storageNumber:fiscalStorageNumber,documentNumber:'113',sign:'379262308',
      fiscalizedAt:new Date().toISOString(),total:100,documentType:'SELL'};
    const complete = {...pendingCallback,fiscal:fiscalIdentity};
    await Promise.all([api.recordEvotorTerminalPaymentResult(complete),service(sql).recordEvotorTerminalPaymentResult(complete)]);
    assert.deepEqual(await state(pending),{payment_status:'paid',fiscal_status:'issued',is_operational:true,
      payments:1,intents:1,kds:1,sales:1,inventory:0});
    const [savedFiscal] = await sql`select local_receipt_uuid,fiscal_storage_number,fiscal_document_number,
      fiscal_sign,evotor_cloud_document_id from evotor_terminal_payment_intents where id=${pending.intentId}`;
    assert.equal(savedFiscal.local_receipt_uuid,pendingUuid);
    assert.equal(savedFiscal.fiscal_storage_number,fiscalIdentity.storageNumber);
    assert.equal(savedFiscal.fiscal_document_number,fiscalIdentity.documentNumber);
    assert.equal(savedFiscal.fiscal_sign,fiscalIdentity.sign);
    assert.equal(savedFiscal.evotor_cloud_document_id,null);
    for (const status of ['accepted','cooking','ready']) {
      await sql`select set_order_kitchen_status_atomic(${pending.orderId}::uuid,${status},null::uuid,'owner','rc')`;
    }
    assert.equal((await state(pending)).inventory,1);

    const importedAfterBridge = await importRealShape(delayed,fiscalIdentity);
    assert.equal(await sql.begin(tx=>api.reconcileEvotorReceipt(tx,importedAfterBridge.receiptId)),true);
    await importedAfterBridge.reimport();
    assert.equal(await sql.begin(tx=>api.reconcileEvotorReceipt(tx,importedAfterBridge.receiptId)),true,
      'duplicate import is idempotent');
    const [reconciled] = await sql`select evotor_cloud_document_id,evotor_cloud_device_id,evotor_cloud_store_id
      from evotor_terminal_payment_intents where id=${pending.intentId}`;
    assert.equal(reconciled.evotor_cloud_document_id,importedAfterBridge.documentId);
    assert.ok(reconciled.evotor_cloud_device_id);
    assert.ok(reconciled.evotor_cloud_store_id);
    const [saleCount] = await sql`select count(*)::int as count from canonical_analytics_sales
      where source_record_id in (${pending.orderId}::uuid,${importedAfterBridge.receiptId}::uuid)`;
    assert.equal(saleCount.count,1,'cloud import must not add a second canonical sale');
    const [link] = await sql`select count(*)::int as count from analytics_sale_reconciliations
      where web_order_id=${pending.orderId} and evotor_receipt_id=${importedAfterBridge.receiptId} and status='confirmed'`;
    assert.equal(link.count,1);
    const [matchedReceipt] = await sql`select pos_reconciliation_status from evotor_receipts
      where id=${importedAfterBridge.receiptId}`;
    assert.equal(matchedReceipt.pos_reconciliation_status,'matched');
    assert.deepEqual(await state(pending),{payment_status:'paid',fiscal_status:'issued',is_operational:true,
      payments:1,intents:1,kds:1,sales:1,inventory:1});

    const [wrongDocument] = await sql`insert into evotor_documents(connection_id,store_id,device_id,
      evotor_document_id,document_type,close_date)
      values(${connection.id},${delayed.cloudStoreId},${delayed.cloudDeviceId},${randomUUID()},'SELL',now()) returning id`;
    const [wrongReceipt] = await sql`insert into evotor_receipts(connection_id,document_id,store_id,device_id,
      external_receipt_id,receipt_type,closed_at,total,fiscal_drive_number,fiscal_document_number,fiscal_sign)
      values(${connection.id},${wrongDocument.id},${delayed.cloudStoreId},${delayed.cloudDeviceId},${randomUUID()},'sale',now(),100,
        ${fiscalIdentity.storageNumber},'999','different-fiscal-sign') returning id`;
    assert.equal(await sql.begin(tx=>api.reconcileEvotorReceipt(tx,wrongReceipt.id)),false,
      'same amount and time cannot link a different fiscal document/sign');
    const [wrongLink] = await sql`select count(*)::int as count from analytics_sale_reconciliations
      where evotor_receipt_id=${wrongReceipt.id}`;
    assert.equal(wrongLink.count,0);
    const [unreconciledReceipt] = await sql`select pos_reconciliation_status from evotor_receipts where id=${wrongReceipt.id}`;
    assert.equal(unreconciledReceipt.pos_reconciliation_status,'unreconciled');
    const [wrongCloudDevice] = await sql`insert into evotor_devices(connection_id,store_id,evotor_device_id)
      values(${connection.id},${delayed.cloudStoreId},${randomUUID()}) returning id`;
    const [wrongDeviceDocument] = await sql`insert into evotor_documents(connection_id,store_id,device_id,
      evotor_document_id,document_type,close_date)
      values(${connection.id},${delayed.cloudStoreId},${wrongCloudDevice.id},${randomUUID()},'SELL',now()) returning id`;
    const [wrongDeviceReceipt] = await sql`insert into evotor_receipts(connection_id,document_id,store_id,device_id,
      external_receipt_id,receipt_type,closed_at,total,fiscal_drive_number,fiscal_document_number,fiscal_sign)
      values(${connection.id},${wrongDeviceDocument.id},${delayed.cloudStoreId},${wrongCloudDevice.id},
        ${randomUUID()},'sale',now(),100,${fiscalIdentity.storageNumber},${fiscalIdentity.documentNumber},
        ${fiscalIdentity.sign}) returning id`;
    assert.equal(await sql.begin(tx=>api.reconcileEvotorReceipt(tx,wrongDeviceReceipt.id)),false,
      'same fiscal tuple on another cloud device cannot link');
    const [wrongStore] = await sql`insert into evotor_stores(connection_id,evotor_store_id,name,location_id)
      select ${connection.id},${randomUUID()},'Synthetic wrong store',location_id
      from evotor_stores where id=${delayed.cloudStoreId} returning id`;
    const [wrongStoreDocument] = await sql`insert into evotor_documents(connection_id,store_id,device_id,
      evotor_document_id,document_type,close_date)
      values(${connection.id},${wrongStore.id},${delayed.cloudDeviceId},${randomUUID()},'SELL',now()) returning id`;
    const [wrongStoreReceipt] = await sql`insert into evotor_receipts(connection_id,document_id,store_id,device_id,
      external_receipt_id,receipt_type,closed_at,total,fiscal_drive_number,fiscal_document_number,fiscal_sign)
      values(${connection.id},${wrongStoreDocument.id},${wrongStore.id},${delayed.cloudDeviceId},
        ${randomUUID()},'sale',now(),100,${fiscalIdentity.storageNumber},
        ${fiscalIdentity.documentNumber},${fiscalIdentity.sign}) returning id`;
    assert.equal(await sql.begin(tx=>api.reconcileEvotorReceipt(tx,wrongStoreReceipt.id)),false,
      'same fiscal tuple on another cloud store cannot link');

    const selected = await fixture();
    const [otherTerminal] = await sql`insert into evotor_terminal_devices(location_id,device_key,token_hash,last_seen_at,paired_at)
      values(${selected.input.locationId},${randomUUID()},${randomUUID().replaceAll('-','').repeat(2)},now(),now()) returning id`;
    const [otherCloudDevice] = await sql`insert into evotor_devices(connection_id,store_id,evotor_device_id)
      values(${connection.id},${selected.cloudStoreId},${randomUUID()}) returning id`;
    await sql`update evotor_terminal_devices set cloud_device_id=${otherCloudDevice.id} where id=${otherTerminal.id}`;
    const selectedJob = await api.createEvotorPosPayment({...selected.input,terminalDeviceId:otherTerminal.id});
    const [selectedIntent] = await sql`select device_id,evotor_cloud_device_id,evotor_cloud_store_id
      from evotor_terminal_payment_intents where id=${selectedJob.intentId}`;
    assert.equal(selectedIntent.device_id,otherTerminal.id);
    const [selectedCloud] = await sql`select cloud.evotor_device_id,store.evotor_store_id
      from evotor_devices cloud join evotor_stores store on store.id=cloud.store_id
      where cloud.id=${otherCloudDevice.id}`;
    assert.equal(selectedIntent.evotor_cloud_device_id,selectedCloud.evotor_device_id);
    assert.equal(selectedIntent.evotor_cloud_store_id,selectedCloud.evotor_store_id);
    assert.equal(await api.nextEvotorTerminalPayment(selected.deviceId),null,'unselected terminal must receive no task');
    assert.equal((await api.nextEvotorTerminalPayment(otherTerminal.id)).id,selectedJob.intentId);
    const offline = await fixture();
    await sql`update evotor_terminal_devices set last_seen_at=now()-interval '2 minutes' where id=${offline.deviceId}`;
    await assert.rejects(api.createEvotorPosPayment({...offline.input,terminalDeviceId:offline.deviceId}),
      /не на связи/,'offline selected terminal cannot silently reroute');
    const [offlineOrders] = await sql`select count(*)::int as count from orders
      where idempotency_key=${offline.input.idempotencyKey}`;
    assert.equal(offlineOrders.count,0);
    const unmapped = await fixture();
    await sql`update evotor_terminal_devices set cloud_device_id=null where id=${unmapped.deviceId}`;
    await assert.rejects(api.createEvotorPosPayment(unmapped.input),/не сопоставлена/);
    const [unmappedOrders] = await sql`select count(*)::int as count from orders
      where idempotency_key=${unmapped.input.idempotencyKey}`;
    assert.equal(unmappedOrders.count,0,'unmapped terminal cannot start money or create order');

    const ambiguous = await fixture();
    const ambiguousJob = await api.createEvotorPosPayment(ambiguous.input);
    await api.nextEvotorTerminalPayment(ambiguous.deviceId);
    const [ambiguousPayment] = await sql`select payment_id from evotor_terminal_payment_intents where id=${ambiguousJob.intentId}`;
    const ambiguousUuid = randomUUID();
    await api.saveEvotorLocalReceipt({deviceId:ambiguous.deviceId,intentId:ambiguousJob.intentId,
      orderId:ambiguousJob.orderId,paymentId:ambiguousPayment.payment_id,
      localReceiptUuid:ambiguousUuid,paymentSystemId:testPaymentSystemId,openedAt:new Date().toISOString()});
    const ambiguousFiscal = {storageNumber:fiscalStorageNumber,documentNumber:'114',sign:'379262309',
      fiscalizedAt:new Date().toISOString(),total:100,documentType:'SELL'};
    await api.recordEvotorTerminalPaymentResult({deviceId:ambiguous.deviceId,intentId:ambiguousJob.intentId,
      status:'paid',receiptReference:ambiguousUuid,paymentEvidence:paymentEvidence(ambiguousUuid),fiscal:ambiguousFiscal});
    const ambiguousReceipts = [];
    for (let i=0;i<2;i++) {
      const externalId = randomUUID();
      const [cloudDoc] = await sql`insert into evotor_documents(connection_id,store_id,device_id,
        evotor_document_id,document_type,close_date)
        values(${connection.id},${ambiguous.cloudStoreId},${ambiguous.cloudDeviceId},${externalId},'SELL',now()) returning id`;
      const [cloudReceipt] = await sql`insert into evotor_receipts(connection_id,document_id,store_id,device_id,
        external_receipt_id,receipt_type,closed_at,total,fiscal_drive_number,fiscal_document_number,fiscal_sign)
        values(${connection.id},${cloudDoc.id},${ambiguous.cloudStoreId},${ambiguous.cloudDeviceId},${externalId},'sale',now(),100,
          ${ambiguousFiscal.storageNumber},${ambiguousFiscal.documentNumber},${ambiguousFiscal.sign}) returning id`;
      ambiguousReceipts.push(cloudReceipt.id);
    }
    assert.equal(await sql.begin(tx=>api.reconcileEvotorReceipt(tx,ambiguousReceipts[0])),false);
    const [ambiguousLinks] = await sql`select count(*)::int as count from analytics_sale_reconciliations
      where web_order_id=${ambiguousJob.orderId}`;
    assert.equal(ambiguousLinks.count,0,'ambiguous fiscal receipts require manual review');
    const [ambiguousState] = await sql`select pos_reconciliation_status from evotor_receipts
      where id=${ambiguousReceipts[0]}`;
    assert.equal(ambiguousState.pos_reconciliation_status,'ambiguous');

    const manual = await fixture();
    const manualJob = await api.createEvotorPosPayment(manual.input);
    await api.nextEvotorTerminalPayment(manual.deviceId);
    const [manualPayment] = await sql`select payment_id from evotor_terminal_payment_intents where id=${manualJob.intentId}`;
    const manualUuid = randomUUID();
    await api.saveEvotorLocalReceipt({deviceId:manual.deviceId,intentId:manualJob.intentId,
      orderId:manualJob.orderId,paymentId:manualPayment.payment_id,
      localReceiptUuid:manualUuid,paymentSystemId:testPaymentSystemId,openedAt:new Date().toISOString()});
    await api.recordEvotorTerminalPaymentResult({deviceId:manual.deviceId,intentId:manualJob.intentId,
      status:'paid',receiptReference:manualUuid,paymentEvidence:paymentEvidence(manualUuid)});
    const manualCloudId = randomUUID();
    const [manualDoc] = await sql`insert into evotor_documents(connection_id,store_id,device_id,
      evotor_document_id,document_type,close_date)
      values(${connection.id},${manual.cloudStoreId},${manual.cloudDeviceId},${manualCloudId},'SELL',now()) returning id`;
    await sql`insert into evotor_receipts(connection_id,document_id,store_id,device_id,
      external_receipt_id,receipt_type,closed_at,total,fiscal_drive_number,fiscal_document_number,fiscal_sign)
      values(${connection.id},${manualDoc.id},${manual.cloudStoreId},${manual.cloudDeviceId},${manualCloudId},'sale',now(),100,
        ${fiscalStorageNumber},'115','379262310')`;
    const manualBase = {intentId:manualJob.intentId,staffId:null,resolution:'paid',receiptReference:manualCloudId,
      fiscalStorageNumber,fiscalDocumentNumber:'115'};
    assert.equal(await api.resolveUnknownEvotorPosPayment({...manualBase,fiscalSign:'wrong'}),false);
    assert.equal((await api.getEvotorPosPaymentStatus(manualJob.intentId)).status,'fiscal_pending');
    assert.equal(await api.resolveUnknownEvotorPosPayment({...manualBase,fiscalSign:'379262310'}),true);
    assert.equal((await state(manualJob)).kds,1);
    assert.equal((await state(manualJob)).sales,1);

    const cloudFirst = await fixture();
    const cloudFirstJob = await api.createEvotorPosPayment(cloudFirst.input);
    await api.nextEvotorTerminalPayment(cloudFirst.deviceId);
    const [cloudFirstPayment] = await sql`select payment_id from evotor_terminal_payment_intents where id=${cloudFirstJob.intentId}`;
    const cloudFirstUuid = randomUUID();
    await api.saveEvotorLocalReceipt({deviceId:cloudFirst.deviceId,intentId:cloudFirstJob.intentId,
      orderId:cloudFirstJob.orderId,paymentId:cloudFirstPayment.payment_id,
      localReceiptUuid:cloudFirstUuid,paymentSystemId:testPaymentSystemId,openedAt:new Date().toISOString()});
    await api.recordEvotorTerminalPaymentResult({deviceId:cloudFirst.deviceId,intentId:cloudFirstJob.intentId,
      status:'paid',receiptReference:cloudFirstUuid,paymentEvidence:paymentEvidence(cloudFirstUuid)});
    const cloudFirstFiscal = {storageNumber:fiscalStorageNumber,documentNumber:'116',sign:'379262311'};
    const importedBeforeBridge = await importRealShape(cloudFirst,cloudFirstFiscal);
    assert.equal(await sql.begin(tx=>api.reconcileEvotorReceipt(tx,importedBeforeBridge.receiptId)),false,
      'cloud import waits for fiscal identity from local bridge');
    await api.recordEvotorTerminalPaymentResult({deviceId:cloudFirst.deviceId,intentId:cloudFirstJob.intentId,
      status:'paid',receiptReference:cloudFirstUuid,paymentEvidence:paymentEvidence(cloudFirstUuid),fiscal:{...cloudFirstFiscal,
        fiscalizedAt:new Date().toISOString(),total:100,documentType:'SELL'}});
    const [cloudFirstLink] = await sql`select count(*)::int as count from analytics_sale_reconciliations
      where web_order_id=${cloudFirstJob.orderId} and evotor_receipt_id=${importedBeforeBridge.receiptId}`;
    assert.equal(cloudFirstLink.count,1,'delayed local fiscal identity reconciles earlier import');
    await importedBeforeBridge.reimport();
    const [cloudFirstSales] = await sql`select count(*)::int as count from canonical_analytics_sales
      where source_record_id in (${cloudFirstJob.orderId}::uuid,${importedBeforeBridge.receiptId}::uuid)`;
    assert.equal(cloudFirstSales.count,1,'import-before-bridge remains one sale after reimport');
    assert.deepEqual(await state(cloudFirstJob),{payment_status:'paid',fiscal_status:'issued',is_operational:true,
      payments:1,intents:1,kds:1,sales:1,inventory:0});

    const split = await fixture();
    const splitJob = await api.createEvotorPosPayment(split.input);
    await api.nextEvotorTerminalPayment(split.deviceId);
    const [splitPayment] = await sql`select payment_id from evotor_terminal_payment_intents
      where id=${splitJob.intentId}`;
    const splitUuid = randomUUID();
    await api.saveEvotorLocalReceipt({deviceId:split.deviceId,intentId:splitJob.intentId,
      orderId:splitJob.orderId,paymentId:splitPayment.payment_id,localReceiptUuid:splitUuid,
      paymentSystemId:testPaymentSystemId,
      openedAt:new Date().toISOString()});
    const [splitStore] = await sql`select evotor_store_id from evotor_stores where id=${split.cloudStoreId}`;
    const [splitDevice] = await sql`select evotor_device_id from evotor_devices where id=${split.cloudDeviceId}`;
    const splitDocument = JSON.parse(readFileSync('tests/fixtures/evotor-sell-multi-group.synthetic.json','utf8'));
    splitDocument.id = randomUUID();
    splitDocument.store_id = splitStore.evotor_store_id;
    splitDocument.device_id = splitDevice.evotor_device_id;
    for (const group of splitDocument.body.pos_print_results) {
      group.fn_serial_number = `${fiscalStorageNumber}_${group.fn_serial_number}`;
    }
    const parsedSplit = parseCloudReceipt(splitDocument);
    assert.equal(parsedSplit.fiscalGroups.length,2);
    assert.equal(parsedSplit.fiscalDocumentNumber,null,'no arbitrary first group in scalar field');
    await api.recordEvotorTerminalPaymentResult({deviceId:split.deviceId,intentId:splitJob.intentId,
      status:'paid',receiptReference:splitUuid,paymentEvidence:paymentEvidence(splitUuid),fiscal:{storageNumber:parsedSplit.fiscalGroups[1].fiscalStorageNumber,
        documentNumber:parsedSplit.fiscalGroups[1].fiscalDocumentNumber,
        sign:parsedSplit.fiscalGroups[1].fiscalSign,fiscalizedAt:new Date().toISOString(),total:100,documentType:'SELL'}});
    await api.persistSnapshot({connectionId:connection.id,eventId:randomUUID(),syncType:'manual',
      stores:[{id:splitDocument.store_id,name:'Synthetic cloud store'}],
      devices:[{id:splitDocument.device_id,store_id:splitDocument.store_id}],
      employees:[],productsByStore:new Map(),
      documentsByStore:new Map([[splitDocument.store_id,[splitDocument]]]),windowsByStore:new Map()});
    const [splitReceipt] = await sql`select id from evotor_receipts
      where connection_id=${connection.id} and external_receipt_id=${splitDocument.id}`;
    assert.equal(await sql.begin(tx=>api.reconcileEvotorReceipt(tx,splitReceipt.id)),true,
      'second fiscal print group must be selected by exact identity');
    assert.equal(await sql.begin(tx=>api.reconcileEvotorReceipt(tx,splitReceipt.id)),true,
      'reimport cannot duplicate a sale');
    assert.deepEqual(await state(splitJob),{payment_status:'paid',fiscal_status:'issued',is_operational:true,
      payments:1,intents:1,kds:1,sales:1,inventory:0});
    const [splitGroups] = await sql`select count(*)::int as count from evotor_receipt_fiscal_groups
      where receipt_id=${splitReceipt.id}`;
    assert.equal(splitGroups.count,2,'all fiscal print groups remain stored');

    const pendingUnknown = await fixture();
    const unknownJob = await api.createEvotorPosPayment(pendingUnknown.input);
    await api.nextEvotorTerminalPayment(pendingUnknown.deviceId);
    const [unknownPayment] = await sql`select payment_id from evotor_terminal_payment_intents
      where id=${unknownJob.intentId}`;
    await api.saveEvotorLocalReceipt({deviceId:pendingUnknown.deviceId,intentId:unknownJob.intentId,
      orderId:unknownJob.orderId,paymentId:unknownPayment.payment_id,localReceiptUuid:randomUUID(),
      paymentSystemId:testPaymentSystemId,
      openedAt:new Date().toISOString()});
    await api.recordEvotorTerminalPaymentResult({deviceId:pendingUnknown.deviceId,
      intentId:unknownJob.intentId,status:'unknown'});
    assert.equal(await api.resolveUnknownEvotorPosPayment({intentId:unknownJob.intentId,
      staffId:null,resolution:'cancelled'}),false,'dispatched UNKNOWN cannot unlock another charge');
    await assert.rejects(api.createEvotorPosPayment({...pendingUnknown.input,idempotencyKey:randomUUID()}),
      /Касса занята/);

    const race = await fixture();
    const attempts = await Promise.allSettled([api.createEvotorPosPayment(race.input),
      api.createEvotorPosPayment({ ...race.input,idempotencyKey:randomUUID() })]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(attempts.filter(r=>r.status==='rejected').length,1);

    const queued = await fixture(); const q = await api.createEvotorPosPayment(queued.input);
    await sql`update evotor_terminal_payment_intents set updated_at=now()-interval '6 minutes' where id=${q.intentId}`;
    assert.equal((await api.getEvotorPosPaymentStatus(q.intentId)).status,'unknown');
    assert.equal(await api.nextEvotorTerminalPayment(queued.deviceId),null,'expired queued command must not be dispatched');
    assert.equal(await api.resolveUnknownEvotorPosPayment({ intentId:q.intentId,staffId:null,resolution:'paid' }),false);
    assert.equal(await api.resolveUnknownEvotorPosPayment({ intentId:q.intentId,staffId:null,resolution:'cancelled' }),true);
    assert.equal((await state(q)).kds,0);

    for (const status of ['failed','cancelled']) {
      const f = await fixture(); const job = await api.createEvotorPosPayment(f.input);
      await api.nextEvotorTerminalPayment(f.deviceId);
      await api.recordEvotorTerminalPaymentResult({ deviceId:f.deviceId,intentId:job.intentId,status,safeBeforePayment:true });
      assert.equal((await state(job)).is_operational,false);
      assert.equal((await api.getEvotorPosPaymentStatus(job.intentId)).status,status);
    }
    const fiscal = await fixture(); const job = await api.createEvotorPosPayment(fiscal.input);
    await api.nextEvotorTerminalPayment(fiscal.deviceId);
    await api.recordEvotorTerminalPaymentResult({ deviceId:fiscal.deviceId,intentId:job.intentId,status:'paid' });
    assert.equal((await api.getEvotorPosPaymentStatus(job.intentId)).status,'unknown');
    assert.equal((await state(job)).kds,0,'payment without fiscal proof remains blocked');
    await api.recordEvotorTerminalPaymentResult({ deviceId:fiscal.deviceId,intentId:job.intentId,status:'failed' });
    assert.equal((await api.getEvotorPosPaymentStatus(job.intentId)).status,'unknown');
    assert.equal(await api.resolveUnknownEvotorPosPayment({ intentId:job.intentId,staffId:null,resolution:'paid',receiptReference:'synthetic-recovered' }),false);
    assert.equal((await state(job)).kds,0);
    const off = service(sql,false);
    await assert.rejects(off.createEvotorPosPayment((await fixture()).input),/отключена/);
    assert.equal(await off.nextEvotorTerminalPayment(race.deviceId),null);
    assert.equal((await off.recordEvotorTerminalPaymentResult(callback)).status,'paid','in-flight results remain accepted when disabled');
  } finally { await sql.end(); }
});
