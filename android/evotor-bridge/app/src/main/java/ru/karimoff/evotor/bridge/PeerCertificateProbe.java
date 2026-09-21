package ru.karimoff.evotor.bridge;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/** Captures public peer certificates only. Always rejects TLS, never sends application data. */
final class PeerCertificateProbe {
    static String inspect() {
        StringBuilder report = new StringBuilder("TLS peer (UNVERIFIED)\nUTC: ");
        SimpleDateFormat date = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT);
        date.setTimeZone(TimeZone.getTimeZone("UTC"));
        report.append(date.format(new Date())).append('\n');
        RejectingRecorder recorder = new RejectingRecorder();
        try (Socket tcp = new Socket()) {
            tcp.connect(new InetSocketAddress(BridgeHttps.BRIDGE_HOST, 443), 4000);
            tcp.setSoTimeout(4000);
            report.append("IP: ").append(tcp.getInetAddress().getHostAddress()).append('\n');
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, new TrustManager[] {recorder}, null);
            ServerNameSocketFactory sockets = new ServerNameSocketFactory(
                context.getSocketFactory(), BridgeHttps.BRIDGE_HOST
            );
            try (SSLSocket tls = (SSLSocket) sockets
                .createSocket(tcp, BridgeHttps.BRIDGE_HOST, 443, true)) {
                tls.setSoTimeout(4000);
                tls.startHandshake();
                throw new IllegalStateException("Diagnostic handshake unexpectedly accepted");
            }
        } catch (Exception error) {
            if (recorder.chain.length == 0) {
                report.append("No peer certificate: ").append(error.getClass().getSimpleName()).append('\n');
            }
        }
        report.append("Certificates: ").append(recorder.chain.length).append('\n');
        for (int index = 0; index < Math.min(recorder.chain.length, 4); index++) {
            X509Certificate cert = recorder.chain[index];
            report.append(index + 1).append(". ").append(bounded(cert.getSubjectX500Principal().getName()))
                .append("\nIssuer: ").append(bounded(cert.getIssuerX500Principal().getName()))
                .append("\nValid: ").append(date.format(cert.getNotBefore()))
                .append(" / ").append(date.format(cert.getNotAfter())).append('\n');
            try {
                byte[] hash = MessageDigest.getInstance("SHA-256").digest(cert.getEncoded());
                report.append("SHA256: ");
                for (byte value : hash) report.append(String.format(Locale.ROOT, "%02X", value & 0xff));
                report.append('\n');
            } catch (Exception error) {
                report.append("Fingerprint unavailable\n");
            }
        }
        return report.toString();
    }

    private static String bounded(String value) {
        return value.replace('\n', ' ').replace('\r', ' ').substring(0, Math.min(value.length(), 160));
    }

    static final class RejectingRecorder implements X509TrustManager {
        private X509Certificate[] chain = new X509Certificate[0];

        @Override
        public void checkServerTrusted(X509Certificate[] certificates, String authType)
            throws CertificateException {
            chain = certificates == null ? new X509Certificate[0] : certificates.clone();
            throw new CertificateException("Diagnostic probe: TLS always rejected before HTTP");
        }

        @Override
        public void checkClientTrusted(X509Certificate[] certificates, String authType)
            throws CertificateException {
            throw new CertificateException("Client authentication is not supported");
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }
}
