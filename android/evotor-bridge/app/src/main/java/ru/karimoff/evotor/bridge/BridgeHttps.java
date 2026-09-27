package ru.karimoff.evotor.bridge;

import java.io.InputStream;
import java.net.URL;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.CertificateFactory;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

final class BridgeHttps {
    static final String BRIDGE_HOST = "karimoff.site";
    private static final String ROOT_YE_SHA256 =
        "E14FFCAD5B0025731006CAA43A121A22D8E9700F4FB9CF852F02A708AA5D5666";
    private static final String EVOTOR_ROOT_SHA256 =
        "6B92EFD383746C955C42924E85BD84C2B3D11AB26BCDE2FDB2FC2C7D657FB2DF";
    private static final String EVOTOR_PROXY_SHA256 =
        "66956E38A0DE40538063F47FBB9EBEA089381118A348BB76C129F92446804606";
    private final SSLContext context;
    private final ServerNameSocketFactory socketFactory;
    private final HostnameVerifier hostnameVerifier;
    private final String trustDiagnostics;

    BridgeHttps() throws Exception {
        context = SSLContext.getDefault();
        socketFactory = null;
        hostnameVerifier = null;
        trustDiagnostics = "TLS mode: platform HTTPS + Network Security Config"
            + "\nTLS provider: " + context.getProvider().getName();
    }

    // Explicit sockets are retained only for a credential-free diagnostic comparison.
    BridgeHttps(InputStream... rootCertificates) throws Exception {
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
        for (int rootIndex = 0; rootIndex < rootCertificates.length; rootIndex++) {
            X509Certificate root = (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(rootCertificates[rootIndex]);
            root.checkValidity();
            root.verify(root.getPublicKey());
            if (root.getBasicConstraints() < 0) throw new IllegalArgumentException("Expected a CA");
            anchors.setCertificateEntry("bundled-root-" + rootIndex, root);
        }

        // Standard chain validation with explicit anchors, never a permissive TrustManager.
        TrustManagerFactory factory = TrustManagerFactory.getInstance(
            TrustManagerFactory.getDefaultAlgorithm()
        );
        factory.init(anchors);
        boolean rootRegistered = false;
        boolean evotorRootRegistered = false;
        String managerName = "none";
        for (TrustManager manager : factory.getTrustManagers()) {
            if (manager instanceof X509TrustManager) {
                managerName = manager.getClass().getName();
                for (X509Certificate accepted : ((X509TrustManager) manager).getAcceptedIssuers()) {
                    String fingerprint = sha256(accepted);
                    if (ROOT_YE_SHA256.equals(fingerprint)) rootRegistered = true;
                    if (EVOTOR_ROOT_SHA256.equals(fingerprint)) evotorRootRegistered = true;
                }
            }
        }
        context = SSLContext.getInstance("TLS");
        context.init(null, factory.getTrustManagers(), null);
        socketFactory = new ServerNameSocketFactory(context.getSocketFactory(), BRIDGE_HOST);
        hostnameVerifier = null;
        trustDiagnostics = "TLS provider: " + context.getProvider().getName()
            + "\nTrust manager: " + managerName
            + "\nRoot YE registered: " + rootRegistered
            + "\nEvotor RootCA registered: " + evotorRootRegistered;
    }

    static BridgeHttps pinnedEvotorProxy() throws Exception {
        return pinnedEvotorProxy(EVOTOR_PROXY_SHA256);
    }

    static BridgeHttps pinnedEvotorProxy(String expectedFingerprint) throws Exception {
        return new BridgeHttps(normalizeFingerprint(expectedFingerprint), true);
    }

    private BridgeHttps(String expectedFingerprint, boolean pinnedProxy) throws Exception {
        if (!pinnedProxy || expectedFingerprint.length() != 64) {
            throw new IllegalArgumentException("Invalid proxy certificate pin");
        }
        PinnedProxyTrustManager trustManager = new PinnedProxyTrustManager(expectedFingerprint);
        context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[] {trustManager}, null);
        socketFactory = new ServerNameSocketFactory(context.getSocketFactory(), BRIDGE_HOST, false);
        hostnameVerifier = (hostname, session) -> BRIDGE_HOST.equalsIgnoreCase(hostname)
            && peerMatches(session, expectedFingerprint);
        trustDiagnostics = "TLS mode: pinned Evotor proxy certificate"
            + "\nTLS provider: " + context.getProvider().getName()
            + "\nProxy pin: " + expectedFingerprint;
    }

    static String sha256(X509Certificate certificate) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
        StringBuilder value = new StringBuilder(digest.length * 2);
        for (byte item : digest) value.append(String.format("%02X", item));
        return value.toString();
    }

    private static String normalizeFingerprint(String value) {
        return value == null ? "" : value.replace(":", "").replace(" ", "").toUpperCase();
    }

    private static boolean peerMatches(SSLSession session, String expectedFingerprint) {
        try {
            java.security.cert.Certificate[] peers = session.getPeerCertificates();
            return peers.length > 0 && peers[0] instanceof X509Certificate
                && expectedFingerprint.equals(sha256((X509Certificate) peers[0]));
        } catch (Exception error) {
            return false;
        }
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
        if (socketFactory != null) connection.setSSLSocketFactory(socketFactory);
        if (hostnameVerifier != null) connection.setHostnameVerifier(hostnameVerifier);
        // Preserve hostname verification; never forward tokens via redirects.
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(4000);
        connection.setReadTimeout(4000);
        return connection;
    }

    private static final class PinnedProxyTrustManager implements X509TrustManager {
        private final String expectedFingerprint;

        PinnedProxyTrustManager(String expectedFingerprint) {
            this.expectedFingerprint = expectedFingerprint;
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType)
            throws CertificateException {
            if (chain == null || chain.length != 1) {
                throw new CertificateException("Unexpected proxy certificate chain");
            }
            X509Certificate leaf = chain[0];
            try {
                leaf.checkValidity();
                if (!"CN=karimoff.site".equals(leaf.getSubjectX500Principal().getName())) {
                    throw new CertificateException("Unexpected proxy certificate subject");
                }
                if (!leaf.getSubjectX500Principal().equals(leaf.getIssuerX500Principal())) {
                    throw new CertificateException("Proxy certificate is not self-issued");
                }
                leaf.verify(leaf.getPublicKey());
                if (!expectedFingerprint.equals(sha256(leaf))) {
                    throw new CertificateException("Proxy certificate pin mismatch");
                }
            } catch (CertificateException error) {
                throw error;
            } catch (Exception error) {
                throw new CertificateException("Proxy certificate verification failed", error);
            }
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType)
            throws CertificateException {
            throw new CertificateException("Client certificates are not supported");
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }
}
