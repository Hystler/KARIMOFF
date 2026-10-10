package ru.karimoff.evotor.bridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import ru.evotor.framework.receipt.Receipt;
import ru.evotor.framework.receipt.ReceiptApi;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class BridgePollingService extends Service {
    static final String PREFERENCES = "karimoff_bridge";
    static final String TOKEN_KEY = "device_token";
    static final String PENDING_PAYMENT_RESULT_KEY = "pending_payment_result";
    static final String ACTIVE_RECEIPT_KEY = "active_receipt_identity";
    static final String PENDING_PAYMENT_JOB_KEY = "pending_payment_job";
    static final String BACKGROUND_SERVICE_STATUS_KEY = "background_service_status";

    static final String ACTION_STATE_CHANGED = "ru.karimoff.evotor.bridge.SERVICE_STATE_CHANGED";
    static final String ACTION_PAYMENT_JOB_AVAILABLE = "ru.karimoff.evotor.bridge.PAYMENT_JOB_AVAILABLE";

    static final String STATUS_STARTING = "starting";
    static final String STATUS_CONNECTED = "connected";
    static final String STATUS_RECONNECTING = "reconnecting";
    static final String STATUS_PAYMENT_WAITING = "payment_waiting";
    static final String STATUS_OPERATION_PENDING = "operation_pending";
    static final String STATUS_OPEN_RECEIPT = "open_receipt";
    static final String STATUS_PAIRING_REQUIRED = "pairing_required";
    static final String STATUS_ERROR = "error";

    private static final String CHANNEL_ID = "karimoff_pos_bridge";
    private static final int NOTIFICATION_ID = 2301;
    private static final long POLL_INTERVAL_MS = 2500L;
    private static final long MAX_RETRY_DELAY_MS = 30000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final Runnable pollRunnable = this::poll;
    private volatile boolean stopped;
    private boolean requestInFlight;
    private boolean claimedJobPersistenceFailed;
    private long retryDelayMs = POLL_INTERVAL_MS;
    private BridgeHttps bridgeHttps;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForegroundCompat(buildNotification(STATUS_STARTING));
        publishStatus(STATUS_STARTING);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        stopped = false;
        startForegroundCompat(buildNotification(readStatus()));
        if (deviceToken().isEmpty()) {
            publishStatus(STATUS_PAIRING_REQUIRED);
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        if (!requestInFlight) {
            handler.removeCallbacks(pollRunnable);
            handler.post(pollRunnable);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopped = true;
        handler.removeCallbacksAndMessages(null);
        networkExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void poll() {
        if (stopped) return;
        if (claimedJobPersistenceFailed) {
            publishStatus(STATUS_ERROR);
            return;
        }
        if (requestInFlight) {
            handler.postDelayed(pollRunnable, 1000L);
            return;
        }
        String token = deviceToken();
        if (token.isEmpty()) {
            publishStatus(STATUS_PAIRING_REQUIRED);
            stopSelf();
            return;
        }

        SharedPreferences preferences = preferences();
        String activeReceipt = preferences.getString(ACTIVE_RECEIPT_KEY, "").trim();
        String pendingResult = preferences.getString(PENDING_PAYMENT_RESULT_KEY, "").trim();
        if (!activeReceipt.isEmpty() || !pendingResult.isEmpty()) {
            boolean jobCleared = clearHandedOffJob(activeReceipt);
            if (jobCleared && pendingResult.isEmpty() && hasFinalServerResult(activeReceipt)
                && preferences.edit().remove(ACTIVE_RECEIPT_KEY).commit()) {
                publishStatus(STATUS_CONNECTED);
                handler.postDelayed(pollRunnable, 1000L);
                return;
            }
            publishStatus(STATUS_OPERATION_PENDING);
            handler.postDelayed(pollRunnable, POLL_INTERVAL_MS);
            return;
        }

        try {
            if (ReceiptApi.getReceipt(this, Receipt.Type.SELL) != null) {
                publishStatus(STATUS_OPEN_RECEIPT);
                handler.postDelayed(pollRunnable, POLL_INTERVAL_MS);
                return;
            }
        } catch (Throwable error) {
            scheduleRetry();
            return;
        }

        String savedJob = preferences.getString(PENDING_PAYMENT_JOB_KEY, "").trim();
        if (!savedJob.isEmpty()) {
            publishStatus(STATUS_PAYMENT_WAITING);
            sendBroadcast(new Intent(ACTION_PAYMENT_JOB_AVAILABLE).setPackage(getPackageName()));
            handler.postDelayed(pollRunnable, POLL_INTERVAL_MS);
            return;
        }

        if (!hasNetwork()) {
            scheduleRetry();
            return;
        }

        requestInFlight = true;
        networkExecutor.execute(() -> {
            JSONObject job = null;
            Throwable failure = null;
            try {
                JSONObject response = requestJson(
                    getString(R.string.bridge_api_base) + "/payments/next", token
                );
                if (!response.isNull("job")) job = response.getJSONObject("job");
            } catch (Throwable error) {
                failure = error;
            }
            JSONObject receivedJob = job;
            Throwable requestFailure = failure;
            handler.post(() -> finishPoll(receivedJob, requestFailure));
        });
    }

    private void finishPoll(JSONObject job, Throwable failure) {
        requestInFlight = false;
        if (stopped) return;
        if (failure != null) {
            if (isAuthenticationFailure(failure)) {
                scheduleRetry(STATUS_PAIRING_REQUIRED);
            } else {
                scheduleRetry(STATUS_RECONNECTING);
            }
            return;
        }

        retryDelayMs = POLL_INTERVAL_MS;
        if (job == null) {
            publishStatus(STATUS_CONNECTED);
            handler.postDelayed(pollRunnable, POLL_INTERVAL_MS);
            return;
        }

        JSONObject envelope = new JSONObject();
        try {
            envelope.put("job", job);
            boolean saved = preferences().edit()
                .putString(PENDING_PAYMENT_JOB_KEY, envelope.toString())
                .commit();
            if (!saved) {
                claimedJobPersistenceFailed = true;
                publishStatus(STATUS_ERROR);
                // The server claimed this intent; do not ask it to claim another one.
                return;
            }
            publishStatus(STATUS_PAYMENT_WAITING);
            sendBroadcast(new Intent(ACTION_PAYMENT_JOB_AVAILABLE).setPackage(getPackageName()));
            handler.postDelayed(pollRunnable, POLL_INTERVAL_MS);
        } catch (Throwable error) {
            Log.e("KARIMOFFBridge", "Could not store the claimed payment job", error);
            claimedJobPersistenceFailed = true;
            publishStatus(STATUS_ERROR);
        }
    }

    private void scheduleRetry() {
        scheduleRetry(STATUS_RECONNECTING);
    }

    private void scheduleRetry(String status) {
        publishStatus(status);
        handler.removeCallbacks(pollRunnable);
        handler.postDelayed(pollRunnable, retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    }

    private boolean isAuthenticationFailure(Throwable error) {
        String message = error == null ? "" : error.getMessage();
        return "HTTP 401".equals(message) || "HTTP 403".equals(message);
    }

    private boolean clearHandedOffJob(String activeReceipt) {
        String pendingJob = preferences().getString(PENDING_PAYMENT_JOB_KEY, "").trim();
        if (pendingJob.isEmpty()) return true;
        if (activeReceipt.isEmpty()) return false;
        try {
            String activeIntentId = new JSONObject(activeReceipt).optString("intentId", "");
            String pendingIntentId = new JSONObject(pendingJob).getJSONObject("job").optString("id", "");
            if (!activeIntentId.isEmpty() && activeIntentId.equals(pendingIntentId)) {
                return preferences().edit().remove(PENDING_PAYMENT_JOB_KEY).commit();
            }
            return false;
        } catch (Throwable error) {
            Log.w("KARIMOFFBridge", "Could not reconcile saved payment task", error);
            return false;
        }
    }

    private boolean hasFinalServerResult(String activeReceipt) {
        try {
            String status = new JSONObject(activeReceipt).optString("serverFinalStatus", "");
            return "paid".equals(status) || "cancelled".equals(status) || "failed".equals(status);
        } catch (Throwable ignored) {
            return false;
        }
    }

    private boolean hasNetwork() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        if (manager == null) return true;
        Network network = manager.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private JSONObject requestJson(String endpoint, String token) throws Exception {
        if (bridgeHttps == null) bridgeHttps = new BridgeHttps();
        HttpURLConnection connection = bridgeHttps.open(endpoint);
        try {
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("X-Karimoff-Terminal-Token", token);
            int responseCode = connection.getResponseCode();
            if (responseCode != 200) {
                throw new IllegalStateException("HTTP " + responseCode);
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

    private void publishStatus(String status) {
        preferences().edit().putString(BACKGROUND_SERVICE_STATUS_KEY, status).apply();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(status));
        sendBroadcast(new Intent(ACTION_STATE_CHANGED).setPackage(getPackageName())
            .putExtra(BACKGROUND_SERVICE_STATUS_KEY, status));
    }

    private String readStatus() {
        return preferences().getString(BACKGROUND_SERVICE_STATUS_KEY, STATUS_STARTING);
    }

    private SharedPreferences preferences() {
        return getSharedPreferences(PREFERENCES, MODE_PRIVATE);
    }

    private String deviceToken() {
        return preferences().getString(TOKEN_KEY, "").trim();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, getString(R.string.background_notification_channel), NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.background_notification_channel_description));
        channel.setShowBadge(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String status) {
        Intent openIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(getString(R.string.background_notification_title))
            .setContentText(notificationText(status))
            .setContentIntent(contentIntent)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .build();
    }

    private String notificationText(String status) {
        switch (status) {
            case STATUS_CONNECTED:
                return getString(R.string.background_notification_connected);
            case STATUS_RECONNECTING:
                return getString(R.string.background_notification_reconnecting);
            case STATUS_PAYMENT_WAITING:
                return getString(R.string.background_notification_payment_waiting);
            case STATUS_OPERATION_PENDING:
                return getString(R.string.background_notification_operation_pending);
            case STATUS_OPEN_RECEIPT:
                return getString(R.string.background_notification_open_receipt);
            case STATUS_PAIRING_REQUIRED:
                return getString(R.string.background_notification_pairing_required);
            case STATUS_ERROR:
                return getString(R.string.background_notification_error);
            default:
                return getString(R.string.background_notification_starting);
        }
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }
}
