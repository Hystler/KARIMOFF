package ru.karimoff.evotor.bridge;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.util.Collections;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/** Forces SNI and HTTPS endpoint identification for the single allowed bridge host. */
final class ServerNameSocketFactory extends SSLSocketFactory {
    private final SSLSocketFactory delegate;
    private final String serverName;

    ServerNameSocketFactory(SSLSocketFactory delegate, String serverName) {
        this.delegate = delegate;
        this.serverName = serverName;
    }

    @Override
    public String[] getDefaultCipherSuites() {
        return delegate.getDefaultCipherSuites();
    }

    @Override
    public String[] getSupportedCipherSuites() {
        return delegate.getSupportedCipherSuites();
    }

    @Override
    public Socket createSocket(Socket socket, String host, int port, boolean autoClose)
        throws IOException {
        return configure(delegate.createSocket(socket, serverName, port, autoClose));
    }

    @Override
    public Socket createSocket(String host, int port) throws IOException {
        return configure(delegate.createSocket(serverName, port));
    }

    @Override
    public Socket createSocket(String host, int port, InetAddress localAddress, int localPort)
        throws IOException {
        return configure(delegate.createSocket(serverName, port, localAddress, localPort));
    }

    @Override
    public Socket createSocket(InetAddress host, int port) throws IOException {
        return configure(delegate.createSocket(host, port));
    }

    @Override
    public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort)
        throws IOException {
        return configure(delegate.createSocket(address, port, localAddress, localPort));
    }

    private Socket configure(Socket socket) throws IOException {
        if (!(socket instanceof SSLSocket)) {
            throw new IllegalStateException("Expected an SSL socket");
        }
        SSLSocket tls = (SSLSocket) socket;
        SSLParameters parameters = tls.getSSLParameters();
        try {
            Class<?> serverNameClass = Class.forName("javax.net.ssl.SNIHostName");
            Object name = serverNameClass.getConstructor(String.class).newInstance(serverName);
            SSLParameters.class.getMethod("setServerNames", java.util.List.class)
                .invoke(parameters, Collections.singletonList(name));
            SSLParameters.class.getMethod("setEndpointIdentificationAlgorithm", String.class)
                .invoke(parameters, "HTTPS");
        } catch (ReflectiveOperationException error) {
            try {
                tls.close();
            } catch (IOException ignored) { }
            throw new IOException("Explicit TLS server name is unavailable", error);
        }
        tls.setSSLParameters(parameters);
        return tls;
    }
}
