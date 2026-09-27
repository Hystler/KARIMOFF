package ru.karimoff.evotor.bridge;

import java.io.InputStream;
import java.net.Socket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SNIMatcher;
import javax.net.ssl.SNIServerName;

// Standalone integration check: only GET health and TLS handshakes, no pairing or payment requests.
public final class BridgeHttpsCheck {
    private static final String BRIDGE_HOST = "karimoff.site";

    public static void main(String[] args) throws Exception {
        BridgeHttps client;
        try (InputStream root = Files.newInputStream(Path.of(args[0]));
             InputStream evotorRoot = Files.newInputStream(Path.of(args[1]))) {
            client = new BridgeHttps(root, evotorRoot);
        }
        if (!client.trustDiagnostics().contains("Root YE registered: true")
            || !client.trustDiagnostics().contains("Evotor RootCA registered: true")) {
            throw new AssertionError("Bundled CAs not installed in trust manager");
        }
        BridgeHttps platformClient = new BridgeHttps();
        HttpsURLConnection platformConnection = platformClient.open(
            "https://" + BRIDGE_HOST + "/api/terminal/health"
        );
        try {
            if (platformConnection.getSSLSocketFactory() != HttpsURLConnection.getDefaultSSLSocketFactory()
                || platformConnection.getHostnameVerifier() != HttpsURLConnection.getDefaultHostnameVerifier()) {
                throw new AssertionError("Platform HTTPS verification was replaced");
            }
            platformConnection.setRequestMethod("GET");
            if (platformConnection.getResponseCode() != 200) throw new AssertionError("Platform health failed");
            System.out.println("PASS: platform HTTPS GET health with default factory and hostname verifier");
        } finally {
            platformConnection.disconnect();
        }
        for (String url : new String[] {
            "http://" + BRIDGE_HOST, "https://other.example", "https://" + BRIDGE_HOST + ":444",
            "https://" + BRIDGE_HOST + ".evil.example", "https://user@" + BRIDGE_HOST
        }) {
            try {
                platformClient.open(url);
                throw new AssertionError("Unsafe origin accepted: " + url);
            } catch (IllegalArgumentException expected) { }
        }
        HttpsURLConnection connection = client.open("https://" + BRIDGE_HOST + "/api/terminal/health");
        try {
            if (connection.getInstanceFollowRedirects()) throw new AssertionError("Redirects enabled");
            connection.setRequestMethod("GET");
            int status = connection.getResponseCode();
            if (status != 200) throw new AssertionError("Unexpected health HTTP " + status);
            System.out.println("PASS: production HTTPS GET health, HTTP 200; origin restrictions");
        } finally {
            connection.disconnect();
        }
        KeyStore fixture = KeyStore.getInstance("PKCS12");
        try (InputStream input = Files.newInputStream(Path.of(args[2]))) {
            fixture.load(input, "test-only".toCharArray());
        }
        KeyManagerFactory keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keys.init(fixture, "test-only".toCharArray());
        SSLContext serverContext = SSLContext.getInstance("TLS");
        serverContext.init(keys.getKeyManagers(), null, null);
        BridgeHttps trustedFixture = new BridgeHttps(new java.io.ByteArrayInputStream(
            fixture.getCertificate("fixture").getEncoded()
        ));
        PeerCertificateProbe.RejectingRecorder recorder = new PeerCertificateProbe.RejectingRecorder();
        try {
            recorder.checkServerTrusted(new java.security.cert.X509Certificate[] {
                (java.security.cert.X509Certificate) fixture.getCertificate("fixture")
            }, "RSA");
            throw new AssertionError("Diagnostic probe accepted a certificate");
        } catch (java.security.cert.CertificateException expected) { }
        String probe = PeerCertificateProbe.inspect();
        if (!probe.contains("SHA256: ") || probe.contains("Certificates: 0")) {
            throw new AssertionError("Public peer metadata missing: " + probe);
        }
        System.out.println("PASS: diagnostic probe rejects TLS and captures public peer metadata");
        System.out.println(probe);
        for (BridgeHttps testedClient : new BridgeHttps[] {client, trustedFixture}) {
            try (SSLServerSocket server = (SSLServerSocket) serverContext.getServerSocketFactory()
                .createServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
                server.setSoTimeout(5000);
                AtomicBoolean correctSni = new AtomicBoolean();
                SSLParameters serverParameters = server.getSSLParameters();
                serverParameters.setSNIMatchers(java.util.Collections.singleton(new SNIMatcher(0) {
                    @Override
                    public boolean matches(SNIServerName name) {
                        boolean matches = name instanceof javax.net.ssl.SNIHostName
                            && BRIDGE_HOST.equals(
                                ((javax.net.ssl.SNIHostName) name).getAsciiName()
                            );
                        correctSni.set(matches);
                        return matches;
                    }
                }));
                server.setSSLParameters(serverParameters);
                CompletableFuture<Void> served = CompletableFuture.runAsync(() -> {
                    try (SSLSocket peer = (SSLSocket) server.accept()) {
                        peer.setSoTimeout(4000);
                        peer.startHandshake();
                    } catch (java.io.IOException expected) { }
                });
                try (Socket tcp = new Socket(java.net.InetAddress.getLoopbackAddress(), server.getLocalPort());
                     SSLSocket tls = (SSLSocket) testedClient.open("https://" + BRIDGE_HOST)
                         .getSSLSocketFactory()
                         .createSocket(tcp, BRIDGE_HOST, server.getLocalPort(), true)) {
                    tls.setSoTimeout(4000);
                    if (testedClient == trustedFixture) {
                        SSLParameters parameters = tls.getSSLParameters();
                        parameters.setEndpointIdentificationAlgorithm("HTTPS");
                        tls.setSSLParameters(parameters);
                    }
                    try {
                        tls.startHandshake();
                        throw new AssertionError("Invalid server certificate accepted");
                    } catch (SSLException expected) {
                        requireCertificateFailure(expected);
                        System.out.println(testedClient == trustedFixture
                            ? "PASS: trusted certificate with incorrect hostname rejected"
                            : "PASS: untrusted certificate rejected");
                    }
                }
                served.get(6, TimeUnit.SECONDS);
                if (!correctSni.get()) throw new AssertionError(BRIDGE_HOST + " SNI was not sent");
            }
        }
        System.out.println("PASS: every TLS socket explicitly sends " + BRIDGE_HOST + " SNI");

        KeyStore proxyFixture = KeyStore.getInstance("PKCS12");
        try (InputStream input = Files.newInputStream(Path.of(args[3]))) {
            proxyFixture.load(input, "test-only".toCharArray());
        }
        KeyManagerFactory proxyKeys = KeyManagerFactory.getInstance(
            KeyManagerFactory.getDefaultAlgorithm()
        );
        proxyKeys.init(proxyFixture, "test-only".toCharArray());
        SSLContext proxyServerContext = SSLContext.getInstance("TLS");
        proxyServerContext.init(proxyKeys.getKeyManagers(), null, null);
        BridgeHttps pinnedFixture = BridgeHttps.pinnedEvotorProxy(BridgeHttps.sha256(
            (java.security.cert.X509Certificate) proxyFixture.getCertificate("fixture")
        ));

        try (SSLServerSocket server = (SSLServerSocket) proxyServerContext.getServerSocketFactory()
            .createServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            server.setSoTimeout(5000);
            CompletableFuture<Void> served = CompletableFuture.runAsync(() -> {
                try (SSLSocket peer = (SSLSocket) server.accept()) {
                    peer.setSoTimeout(4000);
                    peer.startHandshake();
                } catch (java.io.IOException error) {
                    throw new RuntimeException(error);
                }
            });
            try (Socket tcp = new Socket(java.net.InetAddress.getLoopbackAddress(), server.getLocalPort());
                 SSLSocket tls = (SSLSocket) pinnedFixture.open("https://" + BRIDGE_HOST)
                     .getSSLSocketFactory()
                     .createSocket(tcp, BRIDGE_HOST, server.getLocalPort(), true)) {
                tls.setSoTimeout(4000);
                tls.startHandshake();
                HttpsURLConnection pinnedConnection = pinnedFixture.open("https://" + BRIDGE_HOST);
                if (!pinnedConnection.getHostnameVerifier().verify(BRIDGE_HOST, tls.getSession())) {
                    throw new AssertionError("Pinned proxy hostname rejected");
                }
                if (pinnedConnection.getHostnameVerifier().verify("wrong.invalid", tls.getSession())) {
                    throw new AssertionError("Pinned proxy accepted a wrong hostname");
                }
            }
            served.get(6, TimeUnit.SECONDS);
        }
        System.out.println("PASS: exact self-signed proxy certificate pin accepted only for " + BRIDGE_HOST);
    }

    private static void requireCertificateFailure(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof java.security.cert.CertificateException) return;
        }
        throw new AssertionError("Expected certificate rejection, not a transport failure", failure);
    }
}
