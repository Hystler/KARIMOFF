package ru.karimoff.evotor.bridge;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.math.BigDecimal;
import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.util.UUID;
import javax.net.ssl.HttpsURLConnection;

import kotlin.Pair;
import ru.evotor.devices.drivers.IPaySystemDriverService;
import ru.evotor.framework.component.PaymentPerformer;
import ru.evotor.framework.component.PaymentPerformerApi;
import ru.evotor.framework.core.IntegrationManagerFuture;
import ru.evotor.framework.core.action.command.open_receipt_command.OpenSellReceiptCommand;
import ru.evotor.framework.core.action.event.receipt.changes.position.PositionAdd;
import ru.evotor.framework.navigation.NavigationApi;
import ru.evotor.framework.receipt.Measure;
import ru.evotor.framework.receipt.Position;
import ru.evotor.framework.receipt.Receipt;
import ru.evotor.framework.receipt.ReceiptApi;
import ru.evotor.framework.receipt.FiscalReceipt;
import ru.evotor.framework.payment.PaymentType;
import ru.evotor.framework.payment.PaymentAccount;
import ru.evotor.framework.payment.PaymentSystem;
import ru.evotor.framework.payment.PaymentSystemApi;
import ru.evotor.framework.receipt.formation.api.SellApi;
import ru.evotor.framework.receipt.formation.api.move_receipt_to_payment_stage.MoveCurrentReceiptDraftToPaymentStageCallback;
import ru.evotor.framework.receipt.formation.api.move_receipt_to_payment_stage.MoveCurrentReceiptDraftToPaymentStageException;

public final class MainActivity extends Activity {
    private static String utcIso(long timestamp) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(timestamp));
    }

    private static final String PAY_SYSTEM_ACTION = "ru.evotor.devices.drivers.PaySystemService";
    private static final String EVOTOR_PAY_SYSTEM_PACKAGE = "ru.evotor.drivers.kozenpaysystem";
    private static final String ORDER_PREVIEW_EXTRA = "order_preview";
    private static final String PREFERENCES = "karimoff_bridge";
    private static final String TOKEN_KEY = "device_token";
    private static final String DEVICE_KEY = "device_key";
    private static final String PENDING_PAYMENT_RESULT_KEY = "pending_payment_result";
    private static final String ACTIVE_RECEIPT_KEY = "active_receipt_identity";
    private int fiscalReadAttempts;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler paymentPollHandler = new Handler(Looper.getMainLooper());
    private final Runnable paymentPollRunnable = this::pollTerminalPaymentQueue;
    private LinearLayout diagnosticContainer;
    private LinearLayout previewContainer;
    private TextView resultView;
    private TextView orderPreviewView;
    private Button refreshButton;
    private Button receivePreviewButton;
    private Button paymentTestButton;
    private Button pairButton;
    private EditText pairingCodeInput;
    private TextView pairingStatusView;
    private ServiceConnection paySystemConnection;
    private boolean paySystemBound;
    private BridgeHttps bridgeHttps;
    private boolean paymentPollingEnabled;
    private boolean paymentRequestInFlight;
    private boolean paymentFlowBusy;
    private boolean paymentResultRequestInFlight;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        diagnosticContainer = findViewById(R.id.diagnostic_container);
        previewContainer = findViewById(R.id.preview_container);
        resultView = findViewById(R.id.diagnostic_result);
        orderPreviewView = findViewById(R.id.order_preview);
        refreshButton = findViewById(R.id.refresh_button);
        receivePreviewButton = findViewById(R.id.receive_preview_button);
        paymentTestButton = findViewById(R.id.payment_test_button);
        pairButton = findViewById(R.id.pair_button);
        pairingCodeInput = findViewById(R.id.pairing_code);
        pairingStatusView = findViewById(R.id.pairing_status);
        refreshButton.setOnClickListener(view -> runDiagnostics());
        receivePreviewButton.setOnClickListener(view -> receiveOrderPreview());
        paymentTestButton.setOnClickListener(view -> confirmPaymentScreenTest());
        pairButton.setOnClickListener(view -> pairTerminal());
        findViewById(R.id.diagnostics_button).setOnClickListener(view -> showDiagnostics());
        updatePairingUi();

        if (!showOrderPreview(getIntent())) {
            runDiagnostics();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        fiscalReadAttempts = 0;
        paymentPollingEnabled = true;
        retryPendingPaymentResult();
        schedulePaymentPoll(1500);
    }

    @Override
    protected void onPause() {
        paymentPollingEnabled = false;
        paymentPollHandler.removeCallbacks(paymentPollRunnable);
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        showOrderPreview(intent);
    }

    @Override
    protected void onDestroy() {
        paymentPollingEnabled = false;
        paymentPollHandler.removeCallbacks(paymentPollRunnable);
        unbindPaySystem();
        executor.shutdownNow();
        super.onDestroy();
    }

    private void runDiagnostics() {
        showDiagnostics();
        unbindPaySystem();
        refreshButton.setEnabled(false);
        resultView.setText(R.string.diagnostic_loading);

        executor.execute(() -> {
            String report = buildReport();
            String serverStatus = checkBridgeConnection();
            String fullReport = "Bridge " + appVersion() + "\n" + serverStatus + "\n\n" + report;
            runOnUiThread(() -> {
                probeBankTerminals(fullReport);
                pairingStatusView.setText(serverStatus + "\n" + getString(
                    deviceToken().isEmpty() ? R.string.pairing_required : R.string.pairing_ready
                ));
            });
        });
    }

    private HttpsURLConnection openBridgeConnection(String endpoint) throws Exception {
        if (bridgeHttps == null) {
            bridgeHttps = new BridgeHttps();
        }
        return bridgeHttps.open(endpoint);
    }

    private String checkBridgeConnection() {
        StringBuilder result = new StringBuilder("ANDROID HTTPS\n");
        boolean platformHealthy = false;
        boolean proxyHealthy = false;
        try {
            BridgeHttps platformClient = new BridgeHttps();
            result.append(checkBridgeHealth(platformClient));
            bridgeHttps = platformClient;
            platformHealthy = true;
        } catch (Exception error) {
            result.append(getString(R.string.bridge_connection_failed, appVersion(), errorMessage(error)));
        }
        result.append("\n\nPINNED EVOTOR PROXY\n");
        try {
            BridgeHttps proxyClient = BridgeHttps.pinnedEvotorProxy();
            result.append(checkBridgeHealth(proxyClient));
            if (!platformHealthy) bridgeHttps = proxyClient;
            proxyHealthy = true;
        } catch (Exception error) {
            result.append(errorMessage(error));
        }
        if (!platformHealthy && !proxyHealthy) {
            bridgeHttps = null;
            result.append("\n\n").append(PeerCertificateProbe.inspect());
        }
        // This report contains only health status and public TLS metadata, never pairing data.
        Log.i("KarimoffBridge", result.toString());
        return result.toString();
    }

    private String checkBridgeHealth(BridgeHttps client) throws Exception {
        HttpsURLConnection connection = null;
        try {
            connection = client.open(getString(R.string.bridge_api_base) + "/health");
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status != 200) throw new IllegalStateException("Health HTTP " + status);
            JSONObject health = new JSONObject(readResponse(connection.getInputStream(), 4096));
            if (!health.optBoolean("ok") || !health.optBoolean("bridgeEnabled")
                || !"read-only".equals(health.optString("mode"))) {
                throw new IllegalStateException("Unexpected bridge health response");
            }
            java.security.cert.X509Certificate peer = (java.security.cert.X509Certificate)
                connection.getServerCertificates()[0];
            return getString(R.string.bridge_connection_ok, appVersion(), status)
                + "\nAPI: read-only\n" + client.trustDiagnostics()
                + "\nVerified issuer: " + peer.getIssuerX500Principal().getName();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void showDiagnostics() {
        previewContainer.setVisibility(View.GONE);
        diagnosticContainer.setVisibility(View.VISIBLE);
    }

    private void receiveOrderPreview() {
        String token = deviceToken();
        if (token.isEmpty()) {
            resultView.setText(R.string.pairing_required);
            return;
        }
        receivePreviewButton.setEnabled(false);
        receivePreviewButton.setText(R.string.preview_loading);
        executor.execute(() -> {
            try {
                JSONObject envelope = requestJson(
                    "GET",
                    getString(R.string.bridge_api_base) + "/orders/next",
                    token,
                    null
                );
                if (envelope.isNull("job")) {
                    runOnUiThread(() -> {
                        resultView.setText(R.string.preview_queue_empty);
                        resetPreviewButton();
                    });
                    return;
                }
                JSONObject job = envelope.getJSONObject("job");
                String jobId = job.getString("id");
                String formatted = formatOrderPreview(job.getJSONObject("payload"));
                runOnUiThread(() -> {
                    orderPreviewView.setText(formatted);
                    diagnosticContainer.setVisibility(View.GONE);
                    previewContainer.setVisibility(View.VISIBLE);
                    resetPreviewButton();
                });
                acknowledgePreview(jobId, token);
            } catch (Throwable error) {
                runOnUiThread(() -> {
                    resultView.setText(R.string.preview_network_error);
                    resetPreviewButton();
                });
            }
        });
    }

    private void schedulePaymentPoll(long delayMs) {
        if (!paymentPollingEnabled || deviceToken().isEmpty()) return;
        paymentPollHandler.removeCallbacks(paymentPollRunnable);
        paymentPollHandler.postDelayed(paymentPollRunnable, delayMs);
    }

    private void pollTerminalPaymentQueue() {
        if (!paymentPollingEnabled || deviceToken().isEmpty()) return;
        if (!getSharedPreferences(PREFERENCES, MODE_PRIVATE)
            .getString(PENDING_PAYMENT_RESULT_KEY, "").trim().isEmpty()) {
            retryPendingPaymentResult();
            schedulePaymentPoll(3000);
            return;
        }
        if (!activeReceipt().isEmpty()) {
            retryFiscalIdentity();
            schedulePaymentPoll(5000);
            return;
        }
        if (paymentFlowBusy || paymentRequestInFlight) {
            schedulePaymentPoll(3000);
            return;
        }

        paymentRequestInFlight = true;
        String token = deviceToken();
        executor.execute(() -> {
            JSONObject job = null;
            String problem = null;
            try {
                if (ReceiptApi.getReceipt(this, Receipt.Type.SELL) != null) {
                    problem = getString(R.string.payment_waiting_open_receipt);
                } else {
                    JSONObject envelope = requestJson(
                        "GET",
                        getString(R.string.bridge_api_base) + "/payments/next",
                        token,
                        null
                    );
                    if (!envelope.isNull("job")) job = envelope.getJSONObject("job");
                }
            } catch (Throwable error) {
                problem = getString(R.string.payment_poll_error, errorMessage(error));
            }
            JSONObject foundJob = job;
            String finalProblem = problem;
            runOnUiThread(() -> {
                paymentRequestInFlight = false;
                if (!paymentPollingEnabled) return;
                if (foundJob != null) {
                    paymentFlowBusy = true;
                    handleTerminalPaymentJob(foundJob, token);
                } else {
                    if (finalProblem != null) resultView.setText(finalProblem);
                    schedulePaymentPoll(finalProblem == null ? 2500 : 5000);
                }
            });
        });
    }

    private void handleTerminalPaymentJob(JSONObject job, String token) {
        String intentId = job.optString("id", "");
        JSONObject payload = job.optJSONObject("payload");
        if (intentId.isEmpty() || payload == null) {
            queuePaymentResult(intentId, "unknown", null,
                getString(R.string.payment_invalid_job), false);
            return;
        }
        String displayNumber = payload.optString("displayNumber", "");
        resultView.setText(getString(R.string.payment_preparing, displayNumber));
        executor.execute(() -> {
            List<PaymentPerformer> electronicPerformers = new ArrayList<>();
            String problem = null;
            try {
                List<PaymentPerformer> performers = PaymentPerformerApi.INSTANCE
                    .getAllPaymentPerformers(getPackageManager());
                if (performers != null) {
                    for (PaymentPerformer performer : performers) {
                        PaymentSystem system = performer.getPaymentSystem();
                        if (system != null && system.getPaymentType() == PaymentType.ELECTRON) {
                            electronicPerformers.add(performer);
                        }
                    }
                }
            } catch (Throwable error) {
                problem = errorMessage(error);
            }
            List<PaymentPerformer> foundPerformers = electronicPerformers;
            String finalProblem = problem;
            runOnUiThread(() -> {
                if (finalProblem != null) {
                    queuePaymentResult(intentId, "cancelled", null,
                        getString(R.string.payment_no_card_method, finalProblem), true);
                    return;
                }
                if (foundPerformers.isEmpty()) {
                    queuePaymentResult(intentId, "cancelled", null,
                        getString(R.string.payment_no_card_method, "карточный способ оплаты не найден"), true);
                    return;
                }
                choosePaymentPerformer(job, token, foundPerformers);
            });
        });
    }

    private void choosePaymentPerformer(
        JSONObject job,
        String token,
        List<PaymentPerformer> performers
    ) {
        JSONObject payload = job.optJSONObject("payload");
        String intentId = job.optString("id", "");
        String orderNumber = payload == null ? "" : payload.optString("displayNumber", "");
        if (performers.size() == 1) {
            startTerminalOrderPayment(job, token, performers.get(0));
            return;
        }
        String[] labels = new String[performers.size()];
        for (int index = 0; index < performers.size(); index++) {
            PaymentPerformer performer = performers.get(index);
            PaymentSystem system = performer.getPaymentSystem();
            labels[index] = system == null ? safe(performer.getAppName()) : safe(system.getUserDescription());
        }
        new AlertDialog.Builder(this)
            .setTitle(getString(R.string.payment_choose_card_method, orderNumber))
            .setItems(labels, (dialog, which) -> startTerminalOrderPayment(job, token, performers.get(which)))
            .setNegativeButton(android.R.string.cancel, (dialog, which) -> queuePaymentResult(
                intentId, "cancelled", null, getString(R.string.payment_selection_cancelled), true
            ))
            .setOnCancelListener(dialog -> queuePaymentResult(
                intentId, "cancelled", null, getString(R.string.payment_selection_cancelled), true
            ))
            .show();
    }

    private void startTerminalOrderPayment(
        JSONObject job,
        String token,
        PaymentPerformer performer
    ) {
        String intentId = job.optString("id", "");
        executor.execute(() -> {
            boolean existingReceipt;
            try {
                existingReceipt = ReceiptApi.getReceipt(this, Receipt.Type.SELL) != null;
            } catch (Throwable error) {
                runOnUiThread(() -> queuePaymentResult(
                    intentId, "unknown", null,
                    getString(R.string.payment_existing_receipt_check_failed, errorMessage(error)), false
                ));
                return;
            }
            if (existingReceipt) {
                runOnUiThread(() -> queuePaymentResult(
                    intentId, "cancelled", null, getString(R.string.payment_existing_receipt), true
                ));
                return;
            }
            runOnUiThread(() -> openReceiptAndStartPayment(job, token, performer));
        });
    }

    private void openReceiptAndStartPayment(
        JSONObject job,
        String token,
        PaymentPerformer performer
    ) {
        String intentId = job.optString("id", "");
        JSONObject payload = job.optJSONObject("payload");
        String orderNumber = payload == null ? "" : payload.optString("displayNumber", "");
        try {
            if (payload == null) throw new IllegalArgumentException(getString(R.string.payment_invalid_job));
            JSONArray items = payload.getJSONArray("items");
            if (items.length() == 0) throw new IllegalArgumentException(getString(R.string.payment_empty_order));
            List<PositionAdd> positions = new ArrayList<>();
            for (int index = 0; index < items.length(); index++) {
                JSONObject item = items.getJSONObject(index);
                String name = item.getString("name").trim();
                int quantity = item.getInt("quantity");
                BigDecimal unitPrice = new BigDecimal(item.getString("unitPrice"));
                if (name.isEmpty() || quantity < 1 || unitPrice.signum() <= 0) {
                    throw new IllegalArgumentException(getString(R.string.payment_invalid_item));
                }
                Position position = Position.Builder.newInstance(
                    UUID.randomUUID().toString(),
                    null,
                    name,
                    new Measure("шт", 0, 0),
                    unitPrice,
                    BigDecimal.valueOf(quantity)
                ).build();
                positions.add(new PositionAdd(position));
            }

            OpenSellReceiptCommand command = new OpenSellReceiptCommand(positions, null);
            resultView.setText(getString(R.string.payment_opening_receipt, orderNumber));
            command.process(this, future -> {
                String problem = null;
                try {
                    IntegrationManagerFuture.Result result = future.getResult();
                    if (result.getType() != IntegrationManagerFuture.Result.Type.OK) {
                        problem = getString(R.string.payment_open_receipt_failed);
                    }
                } catch (Throwable error) {
                    problem = errorMessage(error);
                }
                String finalProblem = problem;
                runOnUiThread(() -> {
                    if (finalProblem != null) {
                        boolean receiptStillOpen;
                        try {
                            receiptStillOpen = ReceiptApi.getReceipt(this, Receipt.Type.SELL) != null;
                        } catch (Throwable ignored) {
                            receiptStillOpen = true;
                        }
                        queuePaymentResult(
                            intentId,
                            receiptStillOpen ? "unknown" : "cancelled",
                            null,
                            getString(R.string.payment_open_receipt_error, finalProblem),
                            !receiptStillOpen
                        );
                        return;
                    }
                    saveReceiptBeforePayment(job, token, performer);
                });
            });
        } catch (Throwable error) {
            boolean receiptStillOpen;
            try {
                receiptStillOpen = ReceiptApi.getReceipt(this, Receipt.Type.SELL) != null;
            } catch (Throwable ignored) {
                receiptStillOpen = true;
            }
            queuePaymentResult(intentId, receiptStillOpen ? "unknown" : "cancelled", null,
                getString(R.string.payment_prepare_error, errorMessage(error)), !receiptStillOpen);
        }
    }

    private String activeReceipt() {
        return getSharedPreferences(PREFERENCES, MODE_PRIVATE)
            .getString(ACTIVE_RECEIPT_KEY, "").trim();
    }

    private void saveReceiptBeforePayment(JSONObject job, String token, PaymentPerformer performer) {
        String intentId = job.optString("id", "");
        JSONObject payload = job.optJSONObject("payload");
        try {
            Receipt receipt = ReceiptApi.getReceipt(this, Receipt.Type.SELL);
            if (receipt == null || receipt.getHeader() == null || receipt.getHeader().getUuid() == null
                || payload == null) throw new IllegalStateException("Не удалось получить UUID открытого чека");
            String uuid = receipt.getHeader().getUuid().toString();
            JSONObject identity = new JSONObject();
            identity.put("intentId", intentId);
            identity.put("bridgeTaskId", intentId);
            identity.put("orderId", payload.getString("orderId"));
            identity.put("paymentId", payload.getString("paymentId"));
            identity.put("localReceiptUuid", uuid);
            identity.put("deviceKey", deviceKey());
            identity.put("openedAt", utcIso(System.currentTimeMillis()));
            identity.put("paymentConfirmed", false);
            if (!getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                .putString(ACTIVE_RECEIPT_KEY, identity.toString()).commit()) {
                throw new IllegalStateException("UUID чека не удалось сохранить на кассе");
            }
            executor.execute(() -> {
                try {
                    JSONObject body = new JSONObject();
                    body.put("orderId", identity.getString("orderId"));
                    body.put("paymentId", identity.getString("paymentId"));
                    body.put("localReceiptUuid", uuid);
                    body.put("openedAt", identity.getString("openedAt"));
                    JSONObject response = requestJson("POST", getString(R.string.bridge_api_base)
                        + "/payments/" + intentId + "/receipt", token, body);
                    if (!response.optBoolean("ok")) throw new IllegalStateException("Сервер не сохранил UUID чека");
                    runOnUiThread(() -> moveReceiptToCardPayment(job, token, performer));
                } catch (Throwable error) {
                    runOnUiThread(() -> queuePaymentResult(intentId, "failed", null,
                        "Оплата не запускалась: UUID чека не сохранён сервером. " + errorMessage(error), true));
                }
            });
        } catch (Throwable error) {
            queuePaymentResult(intentId, "failed", null,
                "Оплата не запускалась: " + errorMessage(error), true);
        }
    }

    private void moveReceiptToCardPayment(
        JSONObject job,
        String token,
        PaymentPerformer performer
    ) {
        String intentId = job.optString("id", "");
        JSONObject payload = job.optJSONObject("payload");
        String orderNumber = payload == null ? "" : payload.optString("displayNumber", "");
        resultView.setText(getString(R.string.payment_starting, orderNumber));
        try {
            SellApi.INSTANCE.moveCurrentReceiptDraftToPaymentStage(
                this,
                performer,
                new MoveCurrentReceiptDraftToPaymentStageCallback() {
                    @Override
                    public void onSuccess() {
                        String savedUuid = null;
                        try {
                            JSONObject identity = new JSONObject(activeReceipt());
                            savedUuid = identity.getString("localReceiptUuid");
                            identity.put("paymentConfirmed", true);
                            if (!getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                                .putString(ACTIVE_RECEIPT_KEY, identity.toString()).commit()) {
                                throw new IllegalStateException("Не удалось сохранить результат оплаты");
                            }
                            queuePaymentResult(intentId, "paid", identity.getString("localReceiptUuid"),
                                "Оплата прошла, ожидаем фискальные реквизиты", false);
                        } catch (Throwable error) {
                            queuePaymentResult(intentId, savedUuid == null ? "unknown" : "paid", savedUuid,
                                "Оплата подтверждена, локальный результат требует восстановления: "
                                    + errorMessage(error), false);
                        }
                    }

                    @Override
                    public void onError(MoveCurrentReceiptDraftToPaymentStageException error) {
                        queuePaymentResult(intentId, "unknown", null,
                            getString(R.string.payment_terminal_error, errorMessage(error)), false);
                    }
                }
            );
        } catch (Throwable error) {
            queuePaymentResult(intentId, "unknown", null,
                getString(R.string.payment_terminal_error, errorMessage(error)), false);
        }
    }

    private void retryFiscalIdentity() {
        if (fiscalReadAttempts >= 12) {
            resultView.setText("Оплата прошла; фискальные реквизиты пока не найдены. Проверьте чек на кассе. Повторная оплата запрещена.");
            return;
        }
        JSONObject identity;
        try {
            identity = new JSONObject(activeReceipt());
            if (!identity.optBoolean("paymentConfirmed")) return;
        } catch (Throwable ignored) { return; }
        fiscalReadAttempts++;
        executor.execute(() -> {
            try {
                String uuid = identity.getString("localReceiptUuid");
                Receipt closed = ReceiptApi.getReceipt(this, uuid);
                if (closed == null || closed.getHeader() == null || closed.getHeader().getUuid() == null
                    || !uuid.equals(closed.getHeader().getUuid().toString())
                    || closed.getHeader().getType() != Receipt.Type.SELL) return;
                ru.evotor.query.Cursor<FiscalReceipt> cursor = ReceiptApi.getFiscalReceipts(this, uuid);
                if (cursor == null) return;
                List<FiscalReceipt> documents;
                try { documents = cursor.toList(); } finally { cursor.close(); }
                if (documents.size() != 1) return;
                FiscalReceipt fiscal = documents.get(0);
                if (fiscal.getFiscalStorageNumber() == null
                    || fiscal.getFiscalStorageNumber().trim().isEmpty()
                    || fiscal.getDocumentNumber() <= 0
                    || fiscal.getFiscalIdentifier() == null
                    || fiscal.getFiscalIdentifier().trim().isEmpty()
                    || fiscal.getCreationDate() == null) return;
                JSONObject fiscalJson = new JSONObject();
                fiscalJson.put("storageNumber", fiscal.getFiscalStorageNumber());
                fiscalJson.put("documentNumber", String.valueOf(fiscal.getDocumentNumber()));
                fiscalJson.put("sign", fiscal.getFiscalIdentifier());
                fiscalJson.put("fiscalizedAt", utcIso(fiscal.getCreationDate().getTime()));
                fiscalJson.put("documentType", "SELL");
                if (closed.getHeader().getNumber() != null)
                    fiscalJson.put("receiptNumber", closed.getHeader().getNumber());
                BigDecimal paidTotal = BigDecimal.ZERO;
                String paymentIdentifier = null;
                for (ru.evotor.framework.receipt.Payment payment : closed.getPayments()) {
                    paidTotal = paidTotal.add(payment.getValue());
                    if (payment.getIdentifier() != null && !payment.getIdentifier().trim().isEmpty())
                        paymentIdentifier = payment.getIdentifier();
                }
                if (paidTotal.signum() > 0) fiscalJson.put("total", paidTotal);
                if (paymentIdentifier != null) fiscalJson.put("paymentIdentifier", paymentIdentifier);
                runOnUiThread(() -> queuePaymentResult(identity.optString("intentId"), "paid", uuid,
                    "Фискальные реквизиты получены", false, fiscalJson));
            } catch (Throwable error) {
                runOnUiThread(() -> resultView.setText("Оплата прошла; ожидаем фискальный чек: "
                    + errorMessage(error)));
            }
        });
    }

    private void queuePaymentResult(
        String intentId,
        String status,
        String receiptReference,
        String details,
        boolean safeBeforePayment
    ) {
        queuePaymentResult(intentId, status, receiptReference, details, safeBeforePayment, null);
    }

    private void queuePaymentResult(
        String intentId, String status, String receiptReference, String details,
        boolean safeBeforePayment, JSONObject fiscal
    ) {
        if (intentId == null || intentId.trim().isEmpty()) {
            paymentFlowBusy = false;
            resultView.setText(getString(R.string.payment_invalid_job));
            schedulePaymentPoll(5000);
            return;
        }
        try {
            JSONObject body = new JSONObject();
            body.put("status", status);
            body.put("details", details);
            body.put("safeBeforePayment", safeBeforePayment);
            if (receiptReference != null) body.put("receiptReference", receiptReference);
            if (fiscal != null) body.put("fiscal", fiscal);
            JSONObject saved = new JSONObject();
            saved.put("intentId", intentId);
            saved.put("body", body);
            getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                .edit()
                .putString(PENDING_PAYMENT_RESULT_KEY, saved.toString())
                .apply();
            retryPendingPaymentResult();
        } catch (Throwable error) {
            resultView.setText(getString(R.string.payment_result_save_failed, errorMessage(error)));
        }
    }

    private void retryPendingPaymentResult() {
        if (paymentResultRequestInFlight) return;
        String saved = getSharedPreferences(PREFERENCES, MODE_PRIVATE)
            .getString(PENDING_PAYMENT_RESULT_KEY, "").trim();
        if (saved.isEmpty()) return;
        paymentResultRequestInFlight = true;
        executor.execute(() -> {
            boolean accepted = false;
            String status = "unknown";
            String problem = null;
            try {
                JSONObject pending = new JSONObject(saved);
                String intentId = pending.getString("intentId");
                JSONObject body = pending.getJSONObject("body");
                JSONObject response = requestJson(
                    "POST",
                    getString(R.string.bridge_api_base) + "/payments/" + intentId + "/result",
                    deviceToken(),
                    body
                );
                accepted = response.optBoolean("ok");
                status = response.optString("status", body.optString("status", "unknown"));
            } catch (Throwable error) {
                problem = errorMessage(error);
            }
            boolean resultAccepted = accepted;
            String finalStatus = status;
            String finalProblem = problem;
            runOnUiThread(() -> {
                paymentResultRequestInFlight = false;
                if (resultAccepted) {
                    String current = getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                        .getString(PENDING_PAYMENT_RESULT_KEY, "");
                    if (saved.equals(current)) {
                        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                            .remove(PENDING_PAYMENT_RESULT_KEY)
                            .apply();
                    }
                    paymentFlowBusy = false;
                    if ("paid".equals(finalStatus) || "cancelled".equals(finalStatus)
                        || "failed".equals(finalStatus)) {
                        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                            .remove(ACTIVE_RECEIPT_KEY).commit();
                    }
                    if ("paid".equals(finalStatus)) {
                        resultView.setText(R.string.payment_server_confirmed);
                    } else if ("fiscal_pending".equals(finalStatus)) {
                        resultView.setText("Оплата прошла, ожидаем подтверждение фискального чека. Повторная оплата запрещена.");
                    } else if ("unknown".equals(finalStatus)) {
                        resultView.setText(R.string.payment_server_unknown);
                    } else {
                        resultView.setText(R.string.payment_server_cancelled);
                    }
                    schedulePaymentPoll(2500);
                } else {
                    resultView.setText(getString(R.string.payment_result_network_error,
                        finalProblem == null ? "сервер не принял результат" : finalProblem));
                    schedulePaymentPoll(3000);
                }
            });
        });
    }

    private void pairTerminal() {
        String code = pairingCodeInput.getText().toString().replace(" ", "").trim();
        if (!code.matches("\\d{8}")) {
            pairingStatusView.setText(R.string.pairing_failed);
            return;
        }
        pairButton.setEnabled(false);
        pairButton.setText(R.string.pairing_loading);
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("code", code);
                body.put("deviceKey", deviceKey());
                body.put("label", "Эвотор " + safe(Build.MODEL));
                body.put("appVersion", appVersion());
                JSONObject response = requestJson(
                    "POST",
                    getString(R.string.bridge_api_base) + "/pair",
                    null,
                    body
                );
                String token = response.getString("token");
                getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                    .edit()
                    .putString(TOKEN_KEY, token)
                    .apply();
                runOnUiThread(() -> {
                    pairingCodeInput.setText("");
                    updatePairingUi();
                    schedulePaymentPoll(500);
                });
            } catch (Throwable error) {
                runOnUiThread(() -> {
                    pairingStatusView.setText(getString(
                        R.string.pairing_failed_detail,
                        errorMessage(error)
                    ));
                    pairButton.setEnabled(true);
                    pairButton.setText(R.string.pair_terminal);
                });
            }
        });
    }

    private void confirmPaymentScreenTest() {
        new AlertDialog.Builder(this)
            .setTitle(R.string.payment_test_confirm_title)
            .setMessage(R.string.payment_test_confirm_message)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.payment_test_confirm_action, (dialog, which) -> openPaymentScreenTest())
            .show();
    }

    private void openPaymentScreenTest() {
        paymentTestButton.setEnabled(false);
        resultView.setText(R.string.payment_test_loading);

        executor.execute(() -> {
            try {
                Receipt currentReceipt = ReceiptApi.getReceipt(this, Receipt.Type.SELL);
                if (currentReceipt != null) {
                    throw new IllegalStateException(getString(R.string.payment_test_receipt_exists));
                }

                List<PaymentPerformer> performers = PaymentPerformerApi.INSTANCE
                    .getAllPaymentPerformers(getPackageManager());
                if (performers == null || performers.isEmpty()) {
                    throw new IllegalStateException(getString(R.string.payment_test_no_performers));
                }

                Position testPosition = Position.Builder.newInstance(
                    UUID.randomUUID().toString(),
                    null,
                    getString(R.string.payment_test_item),
                    new Measure("шт", 0, 0),
                    new BigDecimal("1.00"),
                    BigDecimal.ONE
                ).build();
                OpenSellReceiptCommand command = new OpenSellReceiptCommand(
                    Collections.singletonList(new PositionAdd(testPosition)),
                    null
                );

                runOnUiThread(() -> command.process(this, future -> {
                    String errorMessage = null;
                    try {
                        IntegrationManagerFuture.Result result = future.getResult();
                        if (result.getType() != IntegrationManagerFuture.Result.Type.OK) {
                            errorMessage = getString(R.string.payment_test_open_failed);
                        }
                    } catch (Throwable error) {
                        errorMessage = errorMessage(error);
                    }

                    String finalErrorMessage = errorMessage;
                    runOnUiThread(() -> {
                        paymentTestButton.setEnabled(true);
                        if (finalErrorMessage != null) {
                            resultView.setText(getString(R.string.payment_test_failed, finalErrorMessage));
                            return;
                        }
                        resultView.setText(R.string.payment_test_opening);
                        try {
                            startActivity(NavigationApi.createIntentForSellReceiptPayment(false, this));
                        } catch (Throwable error) {
                            resultView.setText(getString(R.string.payment_test_failed, errorMessage(error)));
                        }
                    });
                }));
            } catch (Throwable error) {
                runOnUiThread(() -> {
                    resultView.setText(getString(R.string.payment_test_failed, errorMessage(error)));
                    paymentTestButton.setEnabled(true);
                });
            }
        });
    }

    private JSONObject requestJson(
        String method,
        String endpoint,
        String token,
        JSONObject body
    ) throws Exception {
        HttpURLConnection connection = openBridgeConnection(endpoint);
        try {
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            if (token != null) {
                connection.setRequestProperty("X-Karimoff-Terminal-Token", token);
            }
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] requestBody = body.toString().getBytes(StandardCharsets.UTF_8);
                if (requestBody.length > 16 * 1024) throw new IllegalArgumentException("Request too large");
                try (java.io.OutputStream output = connection.getOutputStream()) {
                    output.write(requestBody);
                }
            }
            int responseCode = connection.getResponseCode();
            if (responseCode != 200) {
                String responseBody = readResponse(connection.getErrorStream(), 4096);
                throw new IllegalStateException(
                    "HTTP " + responseCode + (responseBody.isEmpty() ? "" : ": " + responseBody)
                );
            }
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int total = 0;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > 64 * 1024) throw new IllegalArgumentException("Response too large");
                    output.write(buffer, 0, read);
                }
                return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
            }
        } finally {
            connection.disconnect();
        }
    }

    private void acknowledgePreview(String jobId, String token) {
        try {
            requestJson(
                "POST",
                getString(R.string.bridge_api_base) + "/orders/" + jobId + "/ack",
                token,
                new JSONObject()
            );
        } catch (Throwable ignored) {
            // A failed acknowledgement does not hide a successfully received preview.
        }
    }

    private void updatePairingUi() {
        boolean paired = !deviceToken().isEmpty();
        pairingStatusView.setText(paired ? R.string.pairing_ready : R.string.pairing_required);
        pairingCodeInput.setVisibility(paired ? View.GONE : View.VISIBLE);
        pairButton.setVisibility(paired ? View.GONE : View.VISIBLE);
        pairButton.setEnabled(true);
        pairButton.setText(R.string.pair_terminal);
        receivePreviewButton.setEnabled(paired);
    }

    private String deviceToken() {
        SharedPreferences preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE);
        return preferences.getString(TOKEN_KEY, "").trim();
    }

    private String deviceKey() {
        String androidId = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
        if (androidId != null && androidId.matches("[A-Za-z0-9._:-]{8,120}")) {
            return "android:" + androidId;
        }

        SharedPreferences preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE);
        String stored = preferences.getString(DEVICE_KEY, "").trim();
        if (!stored.isEmpty()) return stored;

        String generated = "android:" + UUID.randomUUID();
        preferences.edit().putString(DEVICE_KEY, generated).apply();
        return generated;
    }

    private String appVersion() {
        try {
            return safe(getPackageManager().getPackageInfo(getPackageName(), 0).versionName);
        } catch (PackageManager.NameNotFoundException error) {
            return "unknown";
        }
    }

    private void resetPreviewButton() {
        receivePreviewButton.setText(R.string.receive_preview);
        receivePreviewButton.setEnabled(true);
    }

    private boolean showOrderPreview(Intent intent) {
        String encoded = intent == null ? null : intent.getStringExtra(ORDER_PREVIEW_EXTRA);
        if (encoded == null || encoded.trim().isEmpty()) return false;

        try {
            byte[] raw = Base64.decode(encoded, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            JSONObject order = new JSONObject(new String(raw, StandardCharsets.UTF_8));
            orderPreviewView.setText(formatOrderPreview(order));
        } catch (Throwable error) {
            orderPreviewView.setText("Заказ отклонён: некорректные тестовые данные.");
        }
        unbindPaySystem();
        diagnosticContainer.setVisibility(View.GONE);
        previewContainer.setVisibility(View.VISIBLE);
        return true;
    }

    private String formatOrderPreview(JSONObject order) throws Exception {
        if (order.optInt("schemaVersion", 0) != 1) {
            throw new IllegalArgumentException("Unsupported schema");
        }
        String displayNumber = requiredText(order, "displayNumber", 40);
        JSONArray items = order.getJSONArray("items");
        if (items.length() < 1 || items.length() > 50) {
            throw new IllegalArgumentException("Invalid items");
        }

        NumberFormat money = NumberFormat.getCurrencyInstance(new Locale("ru", "RU"));
        StringBuilder preview = new StringBuilder();
        preview.append("Заказ ").append(displayNumber).append("\n\n");
        for (int index = 0; index < items.length(); index++) {
            JSONObject item = items.getJSONObject(index);
            String name = requiredText(item, "name", 160);
            int quantity = item.getInt("quantity");
            double lineTotal = item.getDouble("lineTotal");
            if (quantity < 1 || quantity > 100 || lineTotal < 0 || !Double.isFinite(lineTotal)) {
                throw new IllegalArgumentException("Invalid item values");
            }
            preview.append(quantity).append(" × ").append(name)
                .append("\n   ").append(money.format(lineTotal)).append('\n');
        }

        double total = order.getDouble("total");
        if (total < 0 || !Double.isFinite(total)) {
            throw new IllegalArgumentException("Invalid total");
        }
        preview.append("\nИтого: ").append(money.format(total));
        String comment = optionalText(order, "comment", 300);
        if (!comment.isEmpty()) preview.append("\n\nКомментарий: ").append(comment);
        preview.append("\n\nТЕСТ: не готовить, не оплачивать.");
        return preview.toString();
    }

    private static String requiredText(JSONObject object, String key, int maxLength) throws Exception {
        String value = optionalText(object, key, maxLength);
        if (value.isEmpty()) throw new IllegalArgumentException("Missing " + key);
        return value;
    }

    private static String optionalText(JSONObject object, String key, int maxLength) throws Exception {
        String value = object.optString(key, "").trim();
        if (value.length() > maxLength) throw new IllegalArgumentException("Too long " + key);
        return value;
    }

    private String buildReport() {
        StringBuilder report = new StringBuilder();
        report.append("УСТРОЙСТВО\n");
        report.append("Модель: ").append(safe(Build.MODEL)).append('\n');
        report.append("Android: ").append(safe(Build.VERSION.RELEASE))
            .append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
        appendPackageVersion(report, "Evotor POS", "ru.atol.tabletpos");

        report.append("\nУСТАНОВЛЕННЫЕ КОМПОНЕНТЫ\n");
        appendPackageVersion(report, "Эквайринг Сбербанк", "ru.sberbank.uposnative");
        appendPackageVersion(report, "UPOS Init Loader", "ru.sberbank.uposinitloader");
        appendPackageVersion(report, "EvoXcPaySystem", "ru.evotor.drivers.kozenpaysystem");
        appendPackageVersion(report, "KkmDriver", "ru.evotor.drivers.kkm");

        report.append("\nДРАЙВЕРЫ БАНКОВСКИХ ТЕРМИНАЛОВ\n");
        appendServices(report, PAY_SYSTEM_ACTION);

        report.append("\nИСПОЛНИТЕЛИ ПЛАТЕЖЕЙ\n");
        try {
            List<PaymentPerformer> performers = PaymentPerformerApi.INSTANCE
                .getAllPaymentPerformers(getPackageManager());
            report.append("Найдено: ").append(performers.size()).append('\n');
            for (int index = 0; index < performers.size(); index++) {
                appendPerformer(report, index + 1, performers.get(index));
            }
        } catch (Throwable error) {
            appendError(report, error);
        }

        report.append("\nПЛАТЁЖНЫЕ СИСТЕМЫ\n");
        try {
            List<Pair<PaymentSystem, List<PaymentAccount>>> systems =
                PaymentSystemApi.getPaymentSystems(getApplicationContext());
            report.append("Найдено: ").append(systems.size()).append('\n');
            for (int index = 0; index < systems.size(); index++) {
                Pair<PaymentSystem, List<PaymentAccount>> entry = systems.get(index);
                PaymentSystem system = entry.getFirst();
                List<PaymentAccount> accounts = entry.getSecond();
                report.append(index + 1).append(". ")
                    .append(system.getUserDescription()).append('\n');
                report.append("   тип: ").append(system.getPaymentType()).append('\n');
                report.append("   id: ").append(system.getPaymentSystemId()).append('\n');
                report.append("   аккаунтов: ").append(accounts == null ? 0 : accounts.size()).append('\n');
                if (accounts != null) {
                    for (int accountIndex = 0; accountIndex < accounts.size(); accountIndex++) {
                        PaymentAccount account = accounts.get(accountIndex);
                        report.append("   ").append(accountIndex + 1).append(") ")
                            .append(safe(account.getUserDescription())).append('\n');
                        report.append("      accountId: ")
                            .append(safe(account.getAccountId())).append('\n');
                    }
                }
            }
        } catch (Throwable error) {
            appendError(report, error);
        }

        return report.toString();
    }

    private void probeBankTerminals(String baseReport) {
        List<ResolveInfo> services = getPackageManager().queryIntentServices(
            new Intent(PAY_SYSTEM_ACTION),
            PackageManager.GET_META_DATA
        );
        ResolveInfo target = null;
        for (ResolveInfo service : services) {
            if (service.serviceInfo != null
                && EVOTOR_PAY_SYSTEM_PACKAGE.equals(service.serviceInfo.packageName)) {
                target = service;
                break;
            }
        }

        if (target == null) {
            finishReport(baseReport + "\n\nСВЕДЕНИЯ ДРАЙВЕРА\nСервис не найден.");
            return;
        }

        ComponentName component = new ComponentName(
            target.serviceInfo.packageName,
            target.serviceInfo.name
        );
        paySystemConnection = new ServiceConnection() {
            @Override
            public void onServiceConnected(ComponentName name, IBinder binder) {
                IPaySystemDriverService driver = IPaySystemDriverService.Stub.asInterface(binder);
                executor.execute(() -> {
                    String report = appendBankTerminalDetails(baseReport, driver);
                    runOnUiThread(() -> {
                        finishReport(report);
                        unbindPaySystem();
                    });
                });
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                paySystemBound = false;
            }
        };

        Intent intent = new Intent(PAY_SYSTEM_ACTION).setComponent(component);
        paySystemBound = bindService(intent, paySystemConnection, Context.BIND_AUTO_CREATE);
        if (!paySystemBound) {
            finishReport(baseReport + "\n\nСВЕДЕНИЯ ДРАЙВЕРА\nНе удалось подключиться.");
        }
    }

    private String appendBankTerminalDetails(
        String baseReport,
        IPaySystemDriverService driver
    ) {
        StringBuilder report = new StringBuilder(baseReport);
        report.append("\n\nСВЕДЕНИЯ ДРАЙВЕРА (ТОЛЬКО ЧТЕНИЕ)\n");
        for (int instanceId = 0; instanceId < 3; instanceId++) {
            report.append("accountId ").append(instanceId).append(":\n");
            try {
                report.append("   банк: ").append(safe(driver.getBankName(instanceId))).append('\n');
                report.append("   номер терминала: ")
                    .append(driver.getTerminalNumber(instanceId)).append('\n');
            } catch (Throwable error) {
                report.append("   недоступен: ").append(error.getClass().getSimpleName()).append('\n');
            }
        }
        return report.toString();
    }

    private void finishReport(String report) {
        resultView.setText(
            report + "\n\nРЕЖИМ\nТолько чтение. Чек и оплата не запускались."
        );
        refreshButton.setEnabled(true);
    }

    private void unbindPaySystem() {
        if (paySystemBound && paySystemConnection != null) {
            try {
                unbindService(paySystemConnection);
            } catch (IllegalArgumentException ignored) {
                // The service may already have disconnected itself.
            }
        }
        paySystemBound = false;
        paySystemConnection = null;
    }

    private void appendPerformer(StringBuilder report, int number, PaymentPerformer performer) {
        PaymentSystem system = performer.getPaymentSystem();
        String description = system == null ? performer.getAppName() : system.getUserDescription();
        report.append(number).append(". ").append(safe(description)).append('\n');
        if (system != null) {
            report.append("   тип: ").append(system.getPaymentType()).append('\n');
            report.append("   id: ").append(system.getPaymentSystemId()).append('\n');
        }
        report.append("   пакет: ")
            .append(performer.getPackageName() == null ? "встроенный" : performer.getPackageName())
            .append('\n');
        if (performer.getComponentName() != null) {
            report.append("   компонент: ").append(performer.getComponentName()).append('\n');
        }
    }

    private void appendPackageVersion(StringBuilder report, String label, String packageName) {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(packageName, 0);
            report.append(label).append(": ").append(safe(info.versionName)).append('\n');
        } catch (PackageManager.NameNotFoundException error) {
            report.append(label).append(": не найден\n");
        }
    }

    private void appendServices(StringBuilder report, String action) {
        List<ResolveInfo> services = getPackageManager().queryIntentServices(
            new Intent(action),
            PackageManager.GET_META_DATA
        );
        report.append("Найдено: ").append(services.size()).append('\n');
        for (int index = 0; index < services.size(); index++) {
            ServiceInfo service = services.get(index).serviceInfo;
            report.append(index + 1).append(". ")
                .append(safe(service.packageName)).append('\n');
            report.append("   сервис: ").append(safe(service.name)).append('\n');
            if (service.metaData != null) {
                report.append("   производитель: ")
                    .append(safe(service.metaData.getString("vendor_name"))).append('\n');
                report.append("   категории: ")
                    .append(safe(service.metaData.getString("device_categories"))).append('\n');
            }
        }
    }

    private static void appendError(StringBuilder report, Throwable error) {
        report.append("Ошибка чтения: ").append(error.getClass().getSimpleName());
        if (error.getMessage() != null && !error.getMessage().trim().isEmpty()) {
            report.append(" — ").append(error.getMessage().trim());
        }
        report.append('\n');
    }

    private static String safe(String value) {
        return value == null || value.trim().isEmpty() ? "не указано" : value;
    }

    private static String readResponse(InputStream input, int limit) {
        if (input == null) return "";
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) != -1 && total < limit) {
                int allowed = Math.min(read, limit - total);
                output.write(buffer, 0, allowed);
                total += allowed;
            }
            return output.toString(StandardCharsets.UTF_8.name()).trim();
        } catch (Throwable ignored) {
            return "";
        }
    }

    private static String errorMessage(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) return error.getClass().getSimpleName();
        return message.trim();
    }
}
