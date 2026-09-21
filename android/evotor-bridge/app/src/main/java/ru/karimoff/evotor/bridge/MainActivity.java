package ru.karimoff.evotor.bridge;

import android.app.Activity;
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
import android.os.IBinder;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.util.List;
import java.util.Locale;
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
import ru.evotor.framework.payment.PaymentAccount;
import ru.evotor.framework.payment.PaymentSystem;
import ru.evotor.framework.payment.PaymentSystemApi;

public final class MainActivity extends Activity {
    private static final String PAY_SYSTEM_ACTION = "ru.evotor.devices.drivers.PaySystemService";
    private static final String EVOTOR_PAY_SYSTEM_PACKAGE = "ru.evotor.drivers.kozenpaysystem";
    private static final String ORDER_PREVIEW_EXTRA = "order_preview";
    private static final String PREFERENCES = "karimoff_bridge";
    private static final String TOKEN_KEY = "device_token";
    private static final String DEVICE_KEY = "device_key";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private LinearLayout diagnosticContainer;
    private LinearLayout previewContainer;
    private TextView resultView;
    private TextView orderPreviewView;
    private Button refreshButton;
    private Button receivePreviewButton;
    private Button pairButton;
    private EditText pairingCodeInput;
    private TextView pairingStatusView;
    private ServiceConnection paySystemConnection;
    private boolean paySystemBound;
    private BridgeHttps bridgeHttps;

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
        pairButton = findViewById(R.id.pair_button);
        pairingCodeInput = findViewById(R.id.pairing_code);
        pairingStatusView = findViewById(R.id.pairing_status);
        refreshButton.setOnClickListener(view -> runDiagnostics());
        receivePreviewButton.setOnClickListener(view -> receiveOrderPreview());
        pairButton.setOnClickListener(view -> pairTerminal());
        findViewById(R.id.diagnostics_button).setOnClickListener(view -> showDiagnostics());
        updatePairingUi();

        if (!showOrderPreview(getIntent())) {
            runDiagnostics();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        showOrderPreview(intent);
    }

    @Override
    protected void onDestroy() {
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
            try (InputStream certificate = getResources().openRawResource(R.raw.lets_encrypt_root_ye)) {
                bridgeHttps = new BridgeHttps(certificate);
            }
        }
        return bridgeHttps.open(endpoint);
    }

    private String checkBridgeConnection() {
        HttpsURLConnection connection = null;
        try {
            connection = openBridgeConnection(getString(R.string.bridge_api_base) + "/health");
            connection.setRequestMethod("GET");
            int status = connection.getResponseCode();
            return getString(R.string.bridge_connection_ok, appVersion(), status);
        } catch (Exception error) {
            return getString(R.string.bridge_connection_failed, appVersion(), errorMessage(error))
                + "\n" + (bridgeHttps == null ? "TLS context unavailable" : bridgeHttps.trustDiagnostics())
                + "\n\n" + PeerCertificateProbe.inspect();
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
