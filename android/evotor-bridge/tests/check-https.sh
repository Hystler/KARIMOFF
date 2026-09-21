#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
java_bin="${JAVA_HOME:?Set JAVA_HOME}/bin"
"$java_bin/keytool" -genkeypair -alias fixture -keyalg RSA -keysize 2048 \
    -dname CN=wrong-host.invalid -ext SAN=dns:wrong-host.invalid -ext BC=ca:true -validity 1 \
    -storetype PKCS12 -keystore "$temp/untrusted.p12" -storepass test-only -noprompt
"$java_bin/javac" -d "$temp/classes" \
    app/src/main/java/ru/karimoff/evotor/bridge/BridgeHttps.java \
    app/src/main/java/ru/karimoff/evotor/bridge/ServerNameSocketFactory.java \
    app/src/main/java/ru/karimoff/evotor/bridge/PeerCertificateProbe.java tests/BridgeHttpsCheck.java
"$java_bin/java" -cp "$temp/classes" ru.karimoff.evotor.bridge.BridgeHttpsCheck \
    app/src/main/res/raw/lets_encrypt_root_ye.pem "$temp/untrusted.p12"
