package ru.karimoff.evotor.bridge;

import java.io.InputStream;
import java.net.URL;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

final class BridgeHttps {
    static final String BRIDGE_HOST = "karimoff.site";
    private final SSLContext context;
    private final ServerNameSocketFactory socketFactory;
    private final String trustDiagnostics;

    BridgeHttps(InputStream rootCertificate) throws Exception {
        KeyStore anchors = KeyStore.getInstance(KeyStore.getDefaultType());
        anchors.load(null, null);
        TrustManagerFactory platform = TrustManagerFactory.getInstance(
            TrustManagerFactory.getDefaultAlgorithm()
        );
        platform.init((KeyStore) null);
        int index = 0;
        for (TrustManager manager : platform.getTrustManagers()) {
            if (manager instanceof X509TrustManager) {
                for (X509Certificate certificate : ((X509TrustManager) manager).getAcceptedIssuers()) {
                    anchors.setCertificateEntry("system-" + index++, certificate);
                }
            }
        }
        X509Certificate root = (X509Certificate) CertificateFactory.getInstance("X.509")
            .generateCertificate(rootCertificate);
        root.checkValidity();
        root.verify(root.getPublicKey());
        if (root.getBasicConstraints() < 0) throw new IllegalArgumentException("Expected a CA");
        anchors.setCertificateEntry("lets-encrypt-root-ye", root);

        // Standard chain validation with explicit anchors, never a permissive TrustManager.
        TrustManagerFactory factory = TrustManagerFactory.getInstance(
            TrustManagerFactory.getDefaultAlgorithm()
        );
        factory.init(anchors);
        boolean rootRegistered = false;
        String managerName = "none";
        for (TrustManager manager : factory.getTrustManagers()) {
            if (manager instanceof X509TrustManager) {
                managerName = manager.getClass().getName();
                for (X509Certificate accepted : ((X509TrustManager) manager).getAcceptedIssuers()) {
                    if (root.equals(accepted)) rootRegistered = true;
                }
            }
        }
        context = SSLContext.getInstance("TLS");
        context.init(null, factory.getTrustManagers(), null);
        socketFactory = new ServerNameSocketFactory(context.getSocketFactory(), BRIDGE_HOST);
        trustDiagnostics = "TLS provider: " + context.getProvider().getName()
            + "\nTrust manager: " + managerName + "\nRoot YE registered: " + rootRegistered;
    }

    String trustDiagnostics() {
        return trustDiagnostics;
    }

    HttpsURLConnection open(String endpoint) throws Exception {
        URL url = new URL(endpoint);
        if (!"https".equals(url.getProtocol()) || !BRIDGE_HOST.equals(url.getHost())
            || (url.getPort() != -1 && url.getPort() != 443) || url.getUserInfo() != null) {
            throw new IllegalArgumentException("Unexpected bridge origin");
        }
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setSSLSocketFactory(socketFactory);
        // Preserve hostname verification; never forward tokens via redirects.
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(4000);
        connection.setReadTimeout(4000);
        return connection;
    }
}
